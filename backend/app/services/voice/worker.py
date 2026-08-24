"""VoiceBot worker entrypoint.

Runs as its own process, separate from the FastAPI API server:

    python -m app.services.voice.worker dev      # local dev, connects to LiveKit
    python -m app.services.voice.worker start     # production

This is how LiveKit Agents workers are designed to run — they register with
a LiveKit server/Cloud instance and receive dispatched voice-session jobs,
which is a different lifecycle than a request/response web server. Sharing
this repo (and its `.env`) with the API server is a deployment convenience;
the two remain independently runnable and restartable.
"""
import asyncio
import json
import logging
import time
from dataclasses import dataclass
from typing import Optional

from livekit.agents import JobContext, WorkerOptions, cli, llm

from app.logging_config import configure_logging
from app.services.voice import rag_client, turn_metrics
from app.services.voice.agent import VoiceAssistant
from app.services.voice.config import VoiceSettings, voice_settings
from app.services.voice.registry import default_registry
from app.services.voice.session_factory import (
    build_agent_session,
    load_turn_detector,
    load_vad,
)

configure_logging(debug=False)
logger = logging.getLogger(__name__)

# Imported for its side effect: the plugin registers itself on import, and only
# registered plugins are fetched by `python -m app.services.voice.worker
# download-files`. Without this the model is missing at runtime and turn
# detection silently falls back to timers — which is exactly the failure that
# is hardest to notice, because calls still work, just worse.
if voice_settings.VOICE_SEMANTIC_TURN_DETECTION:
    try:
        import livekit.plugins.turn_detector  # noqa: F401
    except Exception:
        logger.warning("Turn detector plugin not installed", exc_info=True)

_registry = default_registry()

# Strong references to per-call background tasks. asyncio only holds weak ones,
# so a task that is not kept here can be collected while still running.
ctx_tasks: set = set()


@dataclass
class SessionParams:
    settings: VoiceSettings
    instructions: str
    rag_enabled: bool
    tenant_id: str
    conversation_id: Optional[str]


def _params_for_job(ctx: JobContext) -> SessionParams:
    """Parse the token endpoint's agent-dispatch metadata into this
    session's settings + behavior. Falls back to plain defaults (no RAG,
    the default persona, our own keys) on any missing/malformed metadata —
    a bad token payload should degrade to "plain voice bot", not crash the
    job."""
    raw = getattr(ctx.job, "metadata", "") or ""
    data: dict = {}
    if raw:
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            logger.warning("Ignoring unparseable job metadata")

    overrides: dict = {}
    if data.get("groq_api_key"):
        logger.info("Using caller-supplied Groq key for this session")
        overrides["GROQ_API_KEY"] = data["groq_api_key"]
    if data.get("sarvam_api_key"):
        logger.info("Using caller-supplied Sarvam key for this session")
        overrides["SARVAM_API_KEY"] = data["sarvam_api_key"]
    if data.get("tts_speaker"):
        logger.info("Using caller-selected TTS voice: %s", data["tts_speaker"])
        overrides["VOICE_TTS_SPEAKER"] = data["tts_speaker"]
    if data.get("llm_model"):
        logger.info("Using caller-selected LLM model: %s", data["llm_model"])
        overrides["VOICE_LLM_MODEL"] = data["llm_model"]
        # Route Mistral models to the Mistral provider (free 1B tokens/month)
        # so Groq isn't billed and tight voice caps still apply.
        if isinstance(data["llm_model"], str) and data["llm_model"].startswith("mistral"):
            overrides["VOICE_LLM_PROVIDER"] = "mistral"
        elif isinstance(data["llm_model"], str) and data["llm_model"].startswith("llama"):
            # llama/mistral confusion guard — Groq hosts llama, Mistral hosts mistral
            if overrides.get("VOICE_LLM_PROVIDER") == "mistral":
                # keep mistral if explicitly requested, otherwise groq
                pass
            else:
                overrides["VOICE_LLM_PROVIDER"] = "groq"
    if data.get("stt_language"):
        # The token endpoint has always sent this for business agents; nothing
        # here read it, so an owner who picked a language got auto-detect
        # anyway. Auto-detect is a reasonable default but a worse answer than
        # a known language, which is the whole reason the picker exists.
        logger.info("Using caller-selected STT language: %s", data["stt_language"])
        overrides["VOICE_STT_LANGUAGE"] = data["stt_language"]
    if data.get("custom_llm_base_url"):
        # Caller picked a fully custom OpenAI-compatible model (any provider,
        # own key) — swap the whole LLM provider for this session only.
        logger.info("Using caller-configured custom LLM endpoint: %s", data["custom_llm_base_url"])
        overrides["VOICE_LLM_PROVIDER"] = "custom_openai"
        overrides["CUSTOM_LLM_BASE_URL"] = data["custom_llm_base_url"]
        overrides["CUSTOM_LLM_API_KEY"] = data.get("custom_llm_api_key") or ""
    if "greet_on_connect" in data:
        logger.info("Using caller-selected Greet on Connect: %s", data["greet_on_connect"])
        overrides["VOICE_GREET_ON_CONNECT"] = bool(data["greet_on_connect"])
    if data.get("greeting_text"):
        logger.info("Using caller-selected Greeting Text: %s", data["greeting_text"])
        overrides["VOICE_GREETING_TEXT"] = data["greeting_text"]
    for key, field in (
        ("max_call_seconds", "VOICE_MAX_CALL_SECONDS"),
        ("idle_timeout_seconds", "VOICE_IDLE_TIMEOUT_SECONDS"),
    ):
        if data.get(key) is not None:
            overrides[field] = int(data[key])
    if data.get("temperature") is not None:
        logger.info("Using caller-selected temperature: %s", data["temperature"])
        overrides["VOICE_LLM_TEMPERATURE"] = data["temperature"]
    # Which ceiling applies depends on who owns reply length for this session:
    # us when our delivery rules are on, the owner's own prompt when they are
    # off. Absent (personal workspaces, older tokens) means on, matching the
    # column default.
    styled = data.get("style_rules", True)
    cap = (
        voice_settings.VOICE_LLM_STYLED_MAX_TOKENS_CAP
        if styled
        else voice_settings.VOICE_LLM_MAX_TOKENS_CAP
    )
    if data.get("max_tokens") is not None:
        # Clamped regardless of what the caller sent — this value comes from
        # the same Settings slider as text chat (up to 4000), but a voice
        # reply that long would be unlistenable and needlessly expensive.
        capped = min(int(data["max_tokens"]), cap)
        logger.info("Using caller-selected max tokens: %s (capped to %s)", data["max_tokens"], capped)
        overrides["VOICE_LLM_MAX_TOKENS"] = capped
    elif voice_settings.VOICE_LLM_MAX_TOKENS > cap:
        # Nobody asked for a length, and the default sits above this session's
        # ceiling. Without this the cap would apply only to sessions that named
        # a number, which is the wrong way round — a session that expressed no
        # preference should get the tighter behaviour, not the looser one.
        logger.info("Clamping default max tokens to %s", cap)
        overrides["VOICE_LLM_MAX_TOKENS"] = cap
    settings = voice_settings.model_copy(update=overrides) if overrides else voice_settings

    return SessionParams(
        settings=settings,
        instructions=data.get("instructions") or voice_settings.VOICE_AGENT_INSTRUCTIONS,
        rag_enabled=bool(data.get("rag_enabled")),
        tenant_id=data.get("tenant_id") or "default",
        conversation_id=data.get("conversation_id"),
    )


async def _seed_chat_context(params: SessionParams) -> Optional[llm.ChatContext]:
    """If this call is continuing an existing text conversation, pull its
    history and seed the agent's chat context with it — so voice picks up
    where text chat left off instead of starting cold."""
    if not params.conversation_id:
        return None

    messages = await rag_client.fetch_history(
        params.conversation_id,
        tenant_id=params.tenant_id,
        backend_url=params.settings.VOICE_BACKEND_URL,
        api_key=params.settings.INTERNAL_API_KEY or params.settings.API_KEY,
    )
    if not messages:
        return None

    # Only the tail is relevant to picking a conversation back up — seeding
    # the full history of a long text chat would burn input tokens on every
    # subsequent voice turn for no benefit.
    max_msgs = params.settings.VOICE_HISTORY_MAX_MESSAGES
    if len(messages) > max_msgs:
        messages = messages[-max_msgs:]

    chat_ctx = llm.ChatContext.empty()
    for m in messages:
        role = m.get("role")
        if role not in ("user", "assistant"):
            continue
        content = m.get("content", "")
        if not content:
            continue
        chat_ctx.add_message(role=role, content=content)

    logger.info("Seeded voice session with %d prior messages", len(messages))
    return chat_ctx


async def entrypoint(ctx: JobContext) -> None:
    # Everything from here to the first spoken word is time the caller spends
    # watching a "Connecting…" spinner, so each phase is timed. Connect latency
    # is the one part of a voice product that gets exactly one chance: a caller
    # who hears nothing for ten seconds has already decided it is broken.
    t0 = time.monotonic()

    def _elapsed() -> float:
        return time.monotonic() - t0

    await ctx.connect()
    logger.info("[CONNECT %s] room joined at %.2fs", ctx.room.name, _elapsed())

    params = _params_for_job(ctx)

    # History fetch and session construction are independent, and the history
    # fetch is a network round trip to the API server (which then queries the
    # database). Serialising them put that whole round trip in front of the
    # caller for no reason — the session does not need the history to be built,
    # only to be started.
    history_task = asyncio.create_task(_seed_chat_context(params))
    session = build_agent_session(
        params.settings,
        _registry,
        vad=ctx.proc.userdata.get("vad"),
        # Constructed per job rather than prewarmed: the plugin requires a
        # running job context. It is only a handle onto the process-wide
        # inference executor, and the model file itself is already on disk, so
        # this is cheap — the timing log below is there to keep us honest
        # about that.
        turn_detection=(
            load_turn_detector()
            if params.settings.VOICE_SEMANTIC_TURN_DETECTION
            else None
        ),
    )
    # Before start(), so the very first turn of the call is measured too.
    turn_metrics.attach(session, room_name=ctx.room.name)
    chat_ctx = await history_task
    logger.info("[CONNECT %s] session built at %.2fs", ctx.room.name, _elapsed())

    logger.info(
        "Voice session starting (room=%s, rag=%s, tenant=%s, history_seeded=%s, stt=%s, tts=%s, llm=%s)",
        ctx.room.name,
        params.rag_enabled,
        params.tenant_id,
        bool(chat_ctx),
        params.settings.VOICE_STT_PROVIDER,
        params.settings.VOICE_TTS_PROVIDER,
        params.settings.VOICE_LLM_PROVIDER,
    )

    # Start first so the session's room audio output is wired up — session.say()
    # below would otherwise race against start() and silently drop the greeting.
    await session.start(
        agent=VoiceAssistant(
            params.settings,
            instructions=params.instructions,
            rag_enabled=params.rag_enabled,
            tenant_id=params.tenant_id,
            chat_ctx=chat_ctx,
        ),
        room=ctx.room,
    )

    # Greet by *speaking the greeting text directly* (session.say → TTS only),
    # NOT session.generate_reply (which would burn an LLM call just to say
    # hello). Wait for the user to actually be in the room so they hear it.
    logger.info("[CONNECT %s] session started at %.2fs", ctx.room.name, _elapsed())

    _enforce_call_ceilings(session, params, ctx.room.name)

    if params.settings.VOICE_GREET_ON_CONNECT:
        greeting_text = params.settings.VOICE_GREETING_TEXT or "Hello! How can I help you today?"
        if not ctx.room.remote_participants:
            wait_event = asyncio.Event()
            ctx.room.on("participant_connected", lambda _p: wait_event.set())
            try:
                await asyncio.wait_for(wait_event.wait(), timeout=6.0)
            except asyncio.TimeoutError:
                pass
        logger.info("[CONNECT %s] caller present at %.2fs", ctx.room.name, _elapsed())
        # The fixed 0.3s sleep that used to sit here was guarding against the
        # audio track not being subscribed yet — but it paid the cost on every
        # single call to cover a case that only sometimes happens, and it is
        # 0.3s of silence at the exact moment a caller is deciding whether the
        # thing works. session.start() has already wired the room output.
        try:
            await session.say(greeting_text, allow_interruptions=True)
            logger.info(
                "[CONNECT %s] greeting spoken at %.2fs — TOTAL TIME TO FIRST AUDIO",
                ctx.room.name, _elapsed(),
            )
        except Exception as e:
            logger.warning("Error playing greeting: %s", e)


def _enforce_call_ceilings(session, params: SessionParams, room_name: str) -> None:
    """End a call that has run too long, or gone quiet and stayed quiet.

    A call bills the owner's provider keys for as long as it is open, so an
    unbounded call is an unbounded cost — and the two ways that happens are a
    caller who never hangs up and a caller who connects and walks away. Neither
    is caught by any per-turn limit, because neither involves any turns.

    Both ceilings are off by default and set per session from the token
    endpoint, which is where the difference between "someone the owner sent a
    link to" and "a stranger from the public directory" is known.
    """
    max_seconds = params.settings.VOICE_MAX_CALL_SECONDS
    idle_seconds = params.settings.VOICE_IDLE_TIMEOUT_SECONDS
    if max_seconds <= 0 and idle_seconds <= 0:
        return

    last_activity = time.monotonic()

    @session.on("conversation_item_added")
    def _touch(_event) -> None:  # pragma: no cover - needs a live session
        nonlocal last_activity
        last_activity = time.monotonic()

    async def _watch() -> None:
        started = time.monotonic()
        nudged = False
        while True:
            await asyncio.sleep(2.0)
            now = time.monotonic()
            if max_seconds > 0 and now - started >= max_seconds:
                logger.info(
                    "[LIMIT %s] ending call: reached the %ds ceiling",
                    room_name, max_seconds,
                )
                break
            if idle_seconds > 0 and now - last_activity >= idle_seconds:
                if not nudged:
                    # First stage: check in before giving up. A caller who
                    # stepped away may still be there — muted, thinking, or
                    # holding the phone wrong. add_to_chat_ctx=False so the
                    # nudge itself does not count as activity and restart
                    # this very timer.
                    nudged = True
                    logger.info(
                        "[LIMIT %s] %ds silent — asking if the caller is there",
                        room_name, idle_seconds,
                    )
                    try:
                        await session.say(
                            "Are you there? I'm still on the line.",
                            allow_interruptions=True,
                            add_to_chat_ctx=False,
                        )
                    except Exception:
                        logger.debug("Could not speak the nudge", exc_info=True)
                    # Ten seconds to answer. Any turn from the caller touches
                    # last_activity via _touch, which ends this grace window.
                    deadline = time.monotonic() + 10.0
                    answered = False
                    while time.monotonic() < deadline:
                        await asyncio.sleep(1.0)
                        if time.monotonic() - last_activity < 2.0:
                            answered = True
                            break
                    if answered:
                        nudged = False
                        continue
                    logger.info(
                        "[LIMIT %s] ending call: no answer within 10s of the nudge",
                        room_name,
                    )
                break
        try:
            # Said before hanging up: a call that simply goes dead reads as a
            # dropped connection, and the caller redials — which costs more than
            # the call that was just ended.
            await session.say(
                "I didn't get anything from your side, so I'm going to end the "
                "call. Thanks for calling, goodbye.",
                allow_interruptions=False,
            )
        except Exception:
            logger.debug("Could not speak the closing line", exc_info=True)
        await session.aclose()

    task = asyncio.create_task(_watch())
    # Held so the task is not garbage collected mid-call, and cancelled with the
    # job rather than outliving it.
    ctx_tasks.add(task)
    task.add_done_callback(ctx_tasks.discard)


def prewarm(proc) -> None:
    """Run once per job process, before any call is dispatched to it.

    Anything loaded here is off the critical path of the first call that lands
    on this process. Keep it to things that are the same for every session —
    per-job configuration is not known yet.
    """
    proc.userdata["vad"] = load_vad(voice_settings)
    logger.info("Prewarmed Silero VAD")


def main() -> None:
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=voice_settings.VOICE_AGENT_NAME,
            ws_url=voice_settings.LIVEKIT_URL or None,
            api_key=voice_settings.LIVEKIT_API_KEY or None,
            api_secret=voice_settings.LIVEKIT_API_SECRET or None,
            # Explicit (rather than relying on the framework's dev/prod
            # default) so the port is stable across `dev` and `start` and
            # matches what GET /voice/health and docker-compose's healthcheck
            # both expect to find.
            port=voice_settings.VOICE_WORKER_HEALTH_PORT,
        )
    )


if __name__ == "__main__":
    main()
