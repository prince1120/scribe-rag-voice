"""Composition root for a voice session — mirrors the existing
module-level singleton-wiring convention in `app/api/routes.py` (resolve
config -> build concrete instances -> hand them to the thing that uses
them), just done per-job instead of once at process start, since each
LiveKit job gets its own `AgentSession`.

This is the ONLY place that turns provider *names* (from `VoiceSettings`)
into concrete provider *instances* (via the registry) and assembles them
into a running `AgentSession`. `agent.py` never sees vendor code; providers/
never see `AgentSession`.
"""
import logging

from livekit.agents import AgentSession
from livekit.plugins import silero

logger = logging.getLogger(__name__)

from app.services.voice.config import VoiceSettings
from app.services.voice.registry import ProviderRegistry


def load_vad(settings: VoiceSettings):
    """Silero VAD, tuned for a shorter end-of-speech window so the agent
    notices you've finished sooner.

    Separate from `build_agent_session` so the worker can load it once at
    process start (`prewarm_fnc`) instead of on each call. It is only ~0.15s,
    but it is 0.15s spent while a caller waits to hear anything, and this is
    the seam the framework provides for exactly that.
    """
    return silero.VAD.load(min_silence_duration=settings.VOICE_VAD_MIN_SILENCE)


def load_turn_detector():
    """The semantic end-of-turn model, or None if unavailable.

    Decides whether the caller finished a *thought*, not whether they paused
    for N milliseconds. That distinction is the whole problem with timer-based
    endpointing: "मतलब सर में दर्द है।" is a complete pause and an incomplete
    sentence, and no delay value can tell those apart. With this, an incomplete
    thought keeps listening and a complete one is answered immediately — so the
    ambiguity slack in max_delay can come down rather than up.

    Uses the local `turn_detector` plugin rather than
    `livekit.agents.inference.TurnDetector`, despite the latter being its
    stated replacement: the replacement is a hosted service that makes an HTTP
    call per turn. Running on-device costs tens of milliseconds and no network
    at all, which matters here — this deployment has been measured taking
    multiple seconds for a trivial round trip.

    Returns None rather than raising when the model or its files are missing,
    so a bad install degrades to the previous timer behaviour instead of taking
    voice down entirely.
    """
    try:
        # Deprecation warning is expected and deliberate — see above.
        from livekit.plugins.turn_detector.multilingual import MultilingualModel

        return MultilingualModel()
    except Exception:
        logger.warning(
            "Semantic turn detector unavailable — falling back to timer-based "
            "endpointing. Run `python -m app.services.voice.worker "
            "download-files` if this is unexpected.",
            exc_info=True,
        )
        return None


def build_agent_session(
    settings: VoiceSettings,
    registry: ProviderRegistry,
    *,
    vad=None,
    turn_detection=None,
) -> AgentSession:
    stt_factory = registry.get_stt(settings.VOICE_STT_PROVIDER)
    tts_factory = registry.get_tts(settings.VOICE_TTS_PROVIDER)
    llm_factory = registry.get_llm(settings.VOICE_LLM_PROVIDER)

    return AgentSession(
        stt=stt_factory(settings),
        llm=llm_factory(settings),
        tts=tts_factory(settings),
        # Prewarmed when the worker supplies one; loaded here otherwise so this
        # stays independently callable (tests, and any future caller that is
        # not the worker process).
        vad=vad if vad is not None else load_vad(settings),
        # Omitted entirely when unavailable so the framework keeps its default
        # (VAD + endpointing timers) rather than being handed a None it would
        # have to interpret.
        **({"turn_detection": turn_detection} if turn_detection is not None else {}),
        # Turn handling. Every value here is a trade between responding fast
        # and responding *once*, correctly — and the settings this replaced
        # were tuned entirely for the first, which produced calls where the
        # agent spoke over itself and repeated whole sentences.
        #
        # endpointing: how long to wait after you stop before taking the turn.
        #   Dead air on every single turn, so it dominates perceived latency.
        #
        # preemptive_generation: run the LLM before the turn is formally
        #   confirmed, so the first token is ready the moment it is. Kept on —
        #   it is most of the latency win and it is safe, because nothing is
        #   spoken until the turn is confirmed.
        #
        #   preemptive_tts additionally starts *synthesising* before
        #   confirmation. That is where safety ends: the framework will attempt
        #   a generation up to `max_retries` (3) times per turn as the
        #   transcript changes, and with TTS already running, a superseded
        #   attempt can reach the speaker. In practice that is two different
        #   answers to the same question, back to back. Off by default now; the
        #   env var still exists for anyone who wants to trade correctness for
        #   the last ~200ms.
        #
        # interruption: mode="vad" cuts the agent the instant Silero hears
        #   *any* sound, with no idea whether it was speech meant to interrupt.
        #   Combined with min_duration=0.2 that meant a cough, a breath, or the
        #   caller saying "okay" stopped the agent mid-sentence — and then
        #   resume_false_interruption replayed the sentence from the start,
        #   which is the repetition users hear. "adaptive" classifies
        #   overlapping speech first, so a backchannel is ignored and a real
        #   interruption still cuts through. It costs a little barge-in
        #   latency and buys back the agent not talking over itself.
        turn_handling={
            "endpointing": {
                # "dynamic" rather than "fixed": the wait adapts to how this
                # particular caller actually speaks, via a moving average of
                # their pauses, instead of applying one number to everyone. A
                # fixed delay has to be tuned for the slowest speaker or it
                # cuts them off, which then makes it feel sluggish for the
                # fastest — the split turns that started this were a fixed
                # 0.35s meeting someone who pauses mid-sentence to think.
                #
                # This is not as good as the semantic model, which reads the
                # *sentence* rather than the rhythm. It is what is available
                # without a 2.26 GB inference process, and unlike the model it
                # costs nothing at all.
                "mode": settings.VOICE_ENDPOINTING_MODE,
                "min_delay": settings.VOICE_ENDPOINTING_MIN_DELAY,
                "max_delay": settings.VOICE_ENDPOINTING_MAX_DELAY,
            },
            "preemptive_generation": {
                "enabled": True,
                "preemptive_tts": settings.VOICE_PREEMPTIVE_TTS,
            },
            "interruption": {
                "enabled": True,
                "mode": settings.VOICE_INTERRUPTION_MODE,
                "min_words": settings.VOICE_INTERRUPTION_MIN_WORDS,
                "min_duration": settings.VOICE_INTERRUPTION_MIN_DURATION,
                "resume_false_interruption": settings.VOICE_RESUME_FALSE_INTERRUPTION,
            },
        },
    )
