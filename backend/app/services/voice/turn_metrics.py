"""Per-turn latency logging.

Latency in a voice call is a sum, not a number: the caller stops talking, then
we wait to be sure they're done, transcribe, maybe fetch documents, wait for
the first LLM token, wait for the first audio frame. Any one of those can be
the thing that makes a call feel slow, and they are not guessable from the
outside — tuning without measuring means moving the endpointing delay because
it is the easiest knob, when the actual cost was a document lookup.

The framework already times every stage and hangs the result off the assistant
`ChatMessage`. This turns that into one line per turn so the breakdown is in
the worker log next to the session it belongs to.

`metrics_collected` is deprecated in this version of livekit-agents; the
supported route is `ChatMessage.metrics` via `conversation_item_added`, which
is what this uses.
"""
import logging

logger = logging.getLogger(__name__)

# A turn slower than this is worth finding in the logs later. Roughly the point
# where a caller starts to wonder whether the line dropped.
SLOW_TURN_S = 2.0


def _fmt(seconds) -> str:
    """Milliseconds, or a dash when the stage didn't report.

    A stage can legitimately be absent — no document lookup ran, playback
    latency is meaningless without an avatar worker — and printing 0 for those
    would read as "instant" rather than "not applicable".
    """
    if seconds is None:
        return "-"
    return f"{seconds * 1000:.0f}ms"


def attach(session, *, room_name: str) -> None:
    """Log a latency breakdown for every assistant turn in this session.

    Wrapped in a blanket try/except: this is diagnostics, and a change to the
    metrics shape in a future livekit-agents release must never be able to take
    down a live call to report on one.
    """

    @session.on("conversation_item_added")
    def _on_item(event) -> None:  # pragma: no cover - needs a live session
        try:
            item = event.item
            # Assistant turns carry the latency stages. User turns carry only
            # transcription timings, which are already included in the
            # assistant turn's end-to-end number.
            if getattr(item, "role", None) != "assistant":
                return
            m = getattr(item, "metrics", None) or {}
            if not m:
                return

            e2e = m.get("e2e_latency")
            # How long the agent actually talked for. Not a latency stage, but
            # the direct read on whether the brevity rules are holding — a turn
            # that speaks for thirty seconds is the quality complaint and the
            # latency complaint at the same time, and no stage timing shows it.
            started = m.get("started_speaking_at")
            stopped = m.get("stopped_speaking_at")
            spoken = (stopped - started) if (started and stopped) else None

            logger.info(
                "[TURN %s] e2e=%s | eot=%s stt=%s hook=%s llm_ttft=%s tts_ttfb=%s"
                " | model=%s%s",
                room_name,
                _fmt(e2e),
                _fmt(m.get("end_of_turn_delay")),
                _fmt(m.get("transcription_delay")),
                # Our own RAG fetch lives in on_user_turn_completed, so this
                # stage is the document lookup's real cost per turn — the
                # number to look at before touching retrieval settings.
                _fmt(m.get("on_user_turn_completed_delay")),
                _fmt(m.get("llm_node_ttft")),
                _fmt(m.get("tts_node_ttfb")),
                (m.get("llm_metadata") or {}).get("model_name", "?"),
                f" | spoken={spoken:.1f}s" if spoken else "",
            )

            if e2e and e2e > SLOW_TURN_S:
                logger.warning(
                    "[TURN %s] slow turn: %s to first audio", room_name, _fmt(e2e)
                )
        except Exception:
            logger.debug("Could not log turn metrics", exc_info=True)
