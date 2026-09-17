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

from app import repositories
from app.logging_config import configure_logging
from app.services.voice import rag_client, turn_metrics
from app.services.voice.agent import VoiceAssistant
from app.services.voice.config import VoiceSettings, voice_settings
from app.services.voice.domain.interfaces import VoiceDataPacket
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
    conversation_id: Optional[str] = None
    contact_id: Optional[str] = None
    call_id: Optional[str] = None
    # Product QR voice scoping: assigned document ids from dispatch metadata.
    document_ids: Optional[list] = None
    # Product QR voice marker (non-sensitive product id only). Enables the
    # deterministic product-safety classifier for this session's turns.
    product_id: Optional[str] = None


def _params_for_job(ctx: JobContext, server_creds: Optional[dict] = None) -> SessionParams:
    """Parse the token endpoint's agent-dispatch metadata into this
    session's settings + behavior. Falls back to plain defaults (no RAG,
    the default persona, our own keys) on any missing/malformed metadata —
    a bad token payload should degrade to "plain voice bot", not crash the
    job.

    Key precedence per field: dispatch metadata (legacy tokens only — new
    tokens carry no key material) > `server_creds` resolved server-side via
    POST /voice/credentials > process environment defaults.
    """
    raw = getattr(ctx.job, "metadata", "") or ""
    data: dict = {}
    if raw:
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            logger.warning("Ignoring unparseable job metadata")

    server_creds = server_creds or {}
    overrides: dict = {}
    if data.get("groq_api_key"):
        logger.info("Using caller-supplied Groq key for this session")
        overrides["GROQ_API_KEY"] = data["groq_api_key"]
    elif server_creds.get("groq_api_key"):
        overrides["GROQ_API_KEY"] = server_creds["groq_api_key"]
    if data.get("sarvam_api_key"):
        logger.info("Using caller-supplied Sarvam key for this session")
        overrides["SARVAM_API_KEY"] = data["sarvam_api_key"]
    elif server_creds.get("sarvam_api_key"):
        overrides["SARVAM_API_KEY"] = server_creds["sarvam_api_key"]
    if data.get("tts_speaker"):
        logger.info("Using caller-selected TTS voice: %s", data["tts_speaker"])
        overrides["VOICE_TTS_SPEAKER"] = data["tts_speaker"]
    if data.get("llm_model"):
        logger.info("Using caller-selected LLM model: %s", data["llm_model"])
        overrides["VOICE_LLM_MODEL"] = data["llm_model"]
    if data.get("llm_provider"):
        logger.info("Using caller-selected LLM provider: %s", data["llm_provider"])
        overrides["VOICE_LLM_PROVIDER"] = data["llm_provider"]
    elif data.get("llm_model"):
        m = str(data["llm_model"]).lower()
        if m.startswith("mistral"):
            overrides["VOICE_LLM_PROVIDER"] = "mistral"
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
        overrides["CUSTOM_LLM_API_KEY"] = (
            data.get("custom_llm_api_key") or server_creds.get("custom_llm_api_key") or ""
        )

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

    raw_doc_ids = data.get("document_ids")
    document_ids = (
        [d for d in raw_doc_ids if isinstance(d, str) and d]
        if isinstance(raw_doc_ids, list)
        else None
    )

    return SessionParams(
        settings=settings,
        instructions=data.get("instructions") or voice_settings.VOICE_AGENT_INSTRUCTIONS,
        rag_enabled=bool(data.get("rag_enabled")),
        tenant_id=data.get("tenant_id") or "default",
        conversation_id=data.get("conversation_id"),
        contact_id=data.get("contact_id"),
        call_id=data.get("call_id"),
        document_ids=document_ids,
        product_id=data.get("product_id") or None,
    )


async def _resolve_voice_credentials(params: SessionParams) -> dict:
    """Stored provider keys for this call via the internal credentials
    endpoint. Bounded (5s) and fail-open to {} — the caller then falls back
    to environment defaults, or the entrypoint ends the call loudly when
    nothing usable exists. Values are never logged."""
    try:
        return await rag_client.fetch_credentials(
            params.tenant_id,
            backend_url=params.settings.VOICE_BACKEND_URL,
            api_key=params.settings.INTERNAL_API_KEY or params.settings.API_KEY,
        )
    except Exception as exc:
        logger.warning("Voice credential fetch failed (%s)", type(exc).__name__)
        return {}


def _voice_provider_keys_available(settings: VoiceSettings) -> bool:
    """Whether the active voice pipeline can authenticate: the selected LLM
    provider has a key and Sarvam (STT+TTS) has one. Mirrors the provider
    factories' own requirements (groq_llm, mistral_llm with its Groq
    fallback, openai_compatible_llm, sarvam_stt/tts)."""
    provider = (settings.VOICE_LLM_PROVIDER or "groq").lower()
    if provider == "custom_openai":
        llm_ok = bool(settings.CUSTOM_LLM_BASE_URL and settings.CUSTOM_LLM_API_KEY)
    elif provider == "mistral":
        llm_ok = bool(settings.MISTRAL_API_KEY or settings.GROQ_API_KEY)
    else:
        llm_ok = bool(settings.GROQ_API_KEY)
    return bool(llm_ok and settings.SARVAM_API_KEY)


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

    # Stored provider keys are resolved server-side (never from dispatch
    # metadata, which carries no key material). Bounded and fail-open: on
    # failure the environment defaults still apply below.
    server_creds = await _resolve_voice_credentials(params)
    if server_creds:
        params = _params_for_job(ctx, server_creds=server_creds)

    if not _voice_provider_keys_available(params.settings):
        # Fail loud, not silent: without provider keys the session build
        # below would raise and leave the caller in a dead room until the
        # idle watchdog fires. End the room at once instead so the client
        # sees Call Ended rather than endless connecting.
        logger.warning(
            "[CREDENTIALS %s] voice provider keys unavailable for tenant; "
            "ending call without a silent room",
            ctx.room.name,
        )
        try:
            if ctx.room and hasattr(ctx.room, "disconnect"):
                await ctx.room.disconnect()
        except Exception:
            pass
        return

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
    turn_metrics.attach(session, room_name=ctx.room.name, room=ctx.room)
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
    assistant = VoiceAssistant(
        params.settings,
        instructions=params.instructions,
        rag_enabled=params.rag_enabled,
        tenant_id=params.tenant_id,
        chat_ctx=chat_ctx,
        document_ids=params.document_ids,
        product_voice=params.product_id is not None,
    )
    assistant.room = ctx.room
    assistant._contact_id = params.contact_id
    assistant._call_id = params.call_id
    # Capture only this call's committed turns, excluding seeded chat history.
    call_turns = []
    @session.on("conversation_item_added")
    def _capture_turn(event):
        item = event.item
        role = getattr(item, "role", None)
        content = getattr(item, "text_content", "") or ""
        if role in ("user", "assistant") and content.strip() and len(call_turns) < 500:
            call_turns.append({"role": role, "content": content.strip()[:12000]})
    await session.start(
        agent=assistant,
        room=ctx.room,
    )

    # An exhausted/temporarily unavailable LLM used to fail silently after
    # the provider retries. The client then showed "Still thinking" forever
    # even though the WebRTC connection itself was healthy. Keep the call
    # alive, notify the browser, and use TTS directly for a short recovery
    # line (no second LLM request required).
    last_llm_failure_notice = 0.0

    @session.on("error")
    def _on_session_error(event):
        nonlocal last_llm_failure_notice
        error = getattr(event, "error", event)
        error_type = str(getattr(error, "type", "")).lower()
        error_text = str(error).lower()
        if "llm" not in error_type and not any(marker in error_text for marker in ("rate limit", "429", "completion", "language model")):
            return
        now = time.monotonic()
        if now - last_llm_failure_notice < 12:
            return
        last_llm_failure_notice = now
        reason = "rate_limited" if any(marker in error_text for marker in ("rate limit", "429", "quota", "tpm")) else "provider_busy"
        logger.warning("[LLM %s] Reply generation unavailable (%s): %s", ctx.room.name, reason, error)

        async def _notify_caller():
            try:
                await ctx.room.local_participant.publish_data(
                    VoiceDataPacket.agent_unavailable(reason), reliable=True
                )
            except Exception:
                logger.debug("[LLM %s] Could not publish recovery notice", ctx.room.name, exc_info=True)
            try:
                await session.say(
                    "I’m temporarily unable to respond. Please try again in a moment.",
                    allow_interruptions=True,
                    add_to_chat_ctx=False,
                )
            except Exception:
                logger.debug("[LLM %s] Could not speak recovery notice", ctx.room.name, exc_info=True)

        asyncio.create_task(_notify_caller())

    _last_interim_text = ""

    # Broadcast an immediate interrupt packet to the client via WebRTC DataChannel
    # the exact millisecond the user interrupts active agent speech, so the browser
    # can flush and mute its audio hardware sink immediately (<30ms) without waiting
    # for WebRTC track buffer draining.
    def _send_interrupt_signal(*_):
        nonlocal _last_interim_text
        if getattr(session, "current_speech", None) is not None:
            from app.services.voice.speech_clean import is_backchannel
            if _last_interim_text and is_backchannel(_last_interim_text):
                logger.info("[BACKCHANNEL %s] Suppressing interruption for backchannel '%s'", ctx.room.name, _last_interim_text)
                return

            if ctx.room and hasattr(ctx.room, "local_participant") and ctx.room.local_participant:
                try:
                    asyncio.create_task(
                        ctx.room.local_participant.publish_data(
                            VoiceDataPacket.INTERRUPT,
                            reliable=True,
                        )
                    )
                    logger.info("[INTERRUPT %s] Dispatched instant hardware audio-flush signal to client", ctx.room.name)
                except Exception:
                    pass

    # Dynamic Syntactic End-Of-Thought (EOT) Predictor:
    # Analyzes trailing tokens of user speech. If sentence has terminal punctuation (? . ! ।),
    # shortens the wait to 0.18s for instant natural responsiveness. This is
    # the same basic "smart endpointing" idea used by Vapi/Retell: not one
    # aggressive global silence timer, but a fast path only when the words
    # indicate a completed thought.
    # If sentence ends with a hesitation conjunction (and, or, because, aur, lekin, ya),
    # extends wait to 0.65s so thoughtful speakers aren't cut off.
    _CONJUNCTION_SUFFIXES = (
        " and", " or", " but", " because", " so",
        " aur", " ya", " lekin", " ki", " toh", " matlab",
    )

    def _on_transcribed(ev):
        nonlocal _last_interim_text
        try:
            text = getattr(ev, "transcript", None) or getattr(ev, "text", "") or ""
            text = text.strip()
            if not text:
                return
            _last_interim_text = text

            from app.services.voice.speech_clean import is_backchannel, is_stt_hallucination

            if is_stt_hallucination(text):
                logger.debug("[STT FILTER %s] Discarded hallucinated transcript: %s", ctx.room.name, text)
                return

            # If agent is speaking and user gave a short backchannel ("yeah", "okay", "hmm", "haan"):
            # Suppress interruption and continue assistant speech
            if getattr(session, "current_speech", None) is not None and is_backchannel(text):
                logger.info("[BACKCHANNEL %s] User acknowledged with '%s' while agent was speaking; continuing speech", ctx.room.name, text)
                return

            if text.endswith(("?", "!", ".", "।")):
                session.update_options(endpointing_opts={"min_delay": 0.18, "max_delay": 0.36})
            elif any(text.lower().endswith(conj) for conj in _CONJUNCTION_SUFFIXES):
                session.update_options(endpointing_opts={"min_delay": 0.55, "max_delay": 0.75})
            else:
                session.update_options(
                    endpointing_opts={
                        "min_delay": params.settings.VOICE_ENDPOINTING_MIN_DELAY,
                        "max_delay": params.settings.VOICE_ENDPOINTING_MAX_DELAY,
                    }
                )
        except Exception:
            pass

    try:
        session.on("user_started_speaking", _send_interrupt_signal)
        session.on("interrupted", _send_interrupt_signal)
        session.on("user_input_transcribed", _on_transcribed)
    except Exception:
        pass

    # Greet by *speaking the greeting text directly* (session.say → TTS only),
    # NOT session.generate_reply (which would burn an LLM call just to say
    # hello). Wait for the user to actually be in the room so they hear it.
    logger.info("[CONNECT %s] session started at %.2fs", ctx.room.name, _elapsed())

    # Server-side guaranteed transcript recorder: triggers when the user closes the
    # browser, loses connection, or when the agent ends the call, so conversations
    # are never lost even if the client disconnects abruptly.
    persist_lock = asyncio.Lock()
    saved_session = False
    async def _persist_transcript_on_worker(*_, completed=True):
        nonlocal saved_session
        if not params.call_id:
            return
        try:
            async with persist_lock:
                if saved_session:
                    return
                from app.repositories.business import save_call
                await save_call(params.call_id, params.tenant_id, params.contact_id,
                    list(call_turns), max(0, int(time.monotonic() - t0)),
                    source="worker", completed=completed)
                saved_session = completed
        except Exception:
            logger.warning("[RECORD %s] Could not auto-save voice transcript", ctx.room.name, exc_info=True)

    async def _checkpoint_loop():
        while True:
            await asyncio.sleep(15)
            await _persist_transcript_on_worker(completed=False)

    checkpoint_task = asyncio.create_task(_checkpoint_loop())
    async def _stop_checkpoints(*_):
        checkpoint_task.cancel()
        try:
            await checkpoint_task
        except asyncio.CancelledError:
            pass

    ctx.add_shutdown_callback(_stop_checkpoints)
    ctx.add_shutdown_callback(_persist_transcript_on_worker)
    ctx.room.on("disconnected", lambda *_: asyncio.create_task(_persist_transcript_on_worker()))

    ceilings_task = _enforce_call_ceilings(session, params, ctx.room)
    async def _cancel_ceilings(*_):
        if ceilings_task and not ceilings_task.done():
            ceilings_task.cancel()
    ctx.add_shutdown_callback(_cancel_ceilings)
    ctx.room.on("disconnected", lambda *_: asyncio.create_task(_cancel_ceilings()))

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


def _enforce_call_ceilings(session, params: SessionParams, room_or_name) -> Optional[asyncio.Task]:
    """End a call that has run too long, or gone quiet and stayed quiet.

    A call bills the owner's provider keys for as long as it is open, so an
    unbounded call is an unbounded cost — and the two ways that happens are a
    caller who never hangs up and a caller who connects and walks away. Neither
    is caught by any per-turn limit, because neither involves any turns.

    If 45s of continuous silence occurs after speech finishes, the agent
    speaks a check-in reminder. If no answer is received in the next 8s, it
    speaks a closing message, sends an end_call signal to the client, and
    gracefully disconnects the room.
    """
    max_seconds = params.settings.VOICE_MAX_CALL_SECONDS
    idle_seconds = params.settings.VOICE_IDLE_TIMEOUT_SECONDS
    if max_seconds <= 0 and idle_seconds <= 0:
        return None

    room = room_or_name if hasattr(room_or_name, "name") else None
    room_name = getattr(room_or_name, "name", str(room_or_name))

    last_activity = time.monotonic()

    def _touch(*_args) -> None:  # pragma: no cover - needs a live session
        nonlocal last_activity
        last_activity = time.monotonic()

    # Track activity on conversation item additions and speech completions
    try:
        session.on("conversation_item_added", _touch)
        session.on("user_speech_committed", _touch)
        session.on("agent_speech_committed", _touch)
        session.on("user_input_transcribed", _touch)
        session.on("user_started_speaking", _touch)
        session.on("agent_started_speaking", _touch)
    except Exception:
        pass

    def _caller_still_present() -> bool:
        if room is None:
            return False
        if hasattr(room, "isconnected") and not room.isconnected():
            return False
        if hasattr(room, "remote_participants") and len(room.remote_participants) == 0:
            return False
        return True

    async def _watch() -> None:
        started = time.monotonic()
        nudged = False
        while True:
            await asyncio.sleep(0.5)
            if not _caller_still_present():
                logger.debug("[LIMIT %s] Caller left or room disconnected — stopping idle watcher", room_name)
                return

            # If the assistant or user is currently speaking, keep resetting the idle timer
            if getattr(session, "current_speech", None) is not None:
                last_activity = time.monotonic()

            now = time.monotonic()
            if max_seconds > 0 and now - started >= max_seconds:
                logger.info(
                    "[LIMIT %s] ending call: reached the %ds ceiling",
                    room_name, max_seconds,
                )
                break

            if idle_seconds > 0 and now - last_activity >= idle_seconds:
                if not nudged:
                    if not _caller_still_present():
                        return
                    # 1. First stage: check in after idle_seconds of continuous silence
                    nudged = True
                    logger.info(
                        "[LIMIT %s] %ds silent — asking if caller is there",
                        room_name, idle_seconds,
                    )
                    try:
                        speech_handle = await session.say(
                            "Are you there? I'm still on the line.",
                            allow_interruptions=True,
                            add_to_chat_ctx=False,
                        )
                        if speech_handle is not None:
                            try:
                                await speech_handle
                            except Exception:
                                pass
                    except Exception:
                        logger.debug("Could not speak the nudge", exc_info=True)

                    # Timestamp immediately after the nudge finishes speaking
                    nudge_finished_at = time.monotonic()
                    last_activity = nudge_finished_at

                    # 2. 8s grace window: wait for user to speak or respond
                    deadline = nudge_finished_at + 8.0
                    answered = False
                    while time.monotonic() < deadline:
                        await asyncio.sleep(0.3)
                        if not _caller_still_present():
                            return
                        # If user started speaking or any activity registered
                        if getattr(session, "current_speech", None) is not None or last_activity > nudge_finished_at:
                            answered = True
                            break

                    if answered:
                        # User spoke within 8s! Reset state completely so future silences trigger again
                        logger.info("[LIMIT %s] Caller responded after nudge — resetting idle timer", room_name)
                        nudged = False
                        last_activity = time.monotonic()
                        continue

                    # 3. If caller did not reply within 8s, conclude and hang up
                    logger.info(
                        "[LIMIT %s] ending call: no answer within 8s of the nudge",
                        room_name,
                    )
                break

        if not _caller_still_present():
            return

        try:
            # Spoken before hanging up
            speech_handle = await session.say(
                "I didn't hear anything from your side, so I'm going to end the "
                "call. Goodbye.",
                allow_interruptions=False,
            )
            if speech_handle is not None:
                try:
                    await speech_handle
                except Exception:
                    pass
        except Exception:
            logger.debug("Could not speak the closing line", exc_info=True)

        # Allow the last goodbye audio packet to flush across WebRTC
        await asyncio.sleep(1.0)

        # Signal the client browser to immediately transition to Call Ended screen
        try:
            if room and hasattr(room, "local_participant") and room.local_participant:
                await room.local_participant.publish_data(VoiceDataPacket.CALL_ENDED_IDLE)
        except Exception:
            pass

        try:
            if room and hasattr(room, "disconnect"):
                await room.disconnect()
        except Exception:
            pass

        try:
            await session.aclose()
        except Exception:
            pass

    task = asyncio.create_task(_watch())
    # Held so the task is not garbage collected mid-call, and cancelled with the
    # job rather than outliving it.
    ctx_tasks.add(task)
    task.add_done_callback(ctx_tasks.discard)
    return task


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
