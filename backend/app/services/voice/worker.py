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
from dataclasses import dataclass
from typing import Optional

from livekit.agents import JobContext, WorkerOptions, cli, llm

from app.logging_config import configure_logging
from app.services.voice import rag_client
from app.services.voice.agent import VoiceAssistant
from app.services.voice.config import VoiceSettings, voice_settings
from app.services.voice.registry import default_registry
from app.services.voice.session_factory import build_agent_session

configure_logging(debug=False)
logger = logging.getLogger(__name__)

_registry = default_registry()


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
    if data.get("temperature") is not None:
        logger.info("Using caller-selected temperature: %s", data["temperature"])
        overrides["VOICE_LLM_TEMPERATURE"] = data["temperature"]
    if data.get("max_tokens") is not None:
        # Clamped regardless of what the caller sent — this value comes from
        # the same Settings slider as text chat (up to 4000), but a voice
        # reply that long would be unlistenable and needlessly expensive.
        # Capping keeps voice cheap even if chat's slider is turned way up.
        capped = min(int(data["max_tokens"]), voice_settings.VOICE_LLM_MAX_TOKENS_CAP)
        logger.info("Using caller-selected max tokens: %s (capped to %s)", data["max_tokens"], capped)
        overrides["VOICE_LLM_MAX_TOKENS"] = capped
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
    await ctx.connect()

    params = _params_for_job(ctx)
    chat_ctx = await _seed_chat_context(params)

    session = build_agent_session(params.settings, _registry)

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
    if params.settings.VOICE_GREET_ON_CONNECT:
        greeting_text = params.settings.VOICE_GREETING_TEXT or "Hello! How can I help you today?"
        if not ctx.room.remote_participants:
            wait_event = asyncio.Event()
            ctx.room.on("participant_connected", lambda _p: wait_event.set())
            try:
                await asyncio.wait_for(wait_event.wait(), timeout=6.0)
            except asyncio.TimeoutError:
                pass
        await asyncio.sleep(0.3)
        logger.info("Speaking greeting (TTS only, no LLM): %s", greeting_text)
        try:
            await session.say(greeting_text, allow_interruptions=True)
        except Exception as e:
            logger.warning("Error playing greeting: %s", e)


def main() -> None:
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
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
