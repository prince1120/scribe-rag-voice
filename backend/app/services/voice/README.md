# VoiceBot

Real-time voice AI agent built on [LiveKit Agents](https://docs.livekit.io/agents/),
with Groq as the LLM and Sarvam AI for STT/TTS.

## Architecture

```
config.py            Self-contained settings for the worker process (own .env read)
domain/interfaces.py  The abstraction seam: STTFactory / TTSFactory / LLMFactory
                       type aliases. agent.py and session_factory.py depend on
                       these, never on a vendor package directly.
providers/            One factory function per (vendor, capability) pair.
                       Each turns VoiceSettings into a LiveKit-native
                       stt.STT / tts.TTS / llm.LLM instance.
registry.py            The DI container. Maps provider *name* -> factory.
                       session_factory.py resolves names from config through
                       this registry — it never imports a vendor package.
agent.py               The assistant's behavior (instructions/persona).
                       Imports only livekit.agents.Agent — no vendor code.
session_factory.py     Composition root: settings + registry -> AgentSession.
                       The only place that turns provider *names* into
                       concrete *instances*.
worker.py               Runnable entrypoint: python -m app.services.voice.worker
```

Data flow for one voice session:

```
client -> POST /api/v1/voice/token (app/api/voice_routes.py)
       -> joins LiveKit room with that token
       -> LiveKit dispatches the job to this worker
       -> worker.entrypoint(ctx) -> session_factory.build_agent_session(...)
       -> AgentSession(stt=Sarvam, llm=Groq, tts=Sarvam, vad=Silero)
       -> session.start(agent=VoiceAssistant(...), room=ctx.room)
```

## Why it's split this way (SOLID, concretely)

- **Open/Closed**: adding a provider never touches existing files. Example —
  adding Deepgram STT:
  1. `providers/deepgram_stt.py`:
     ```python
     def build_deepgram_stt(settings: VoiceSettings) -> stt.STT:
         return deepgram.STT(api_key=settings.DEEPGRAM_API_KEY)
     ```
  2. `registry.py`, inside `default_registry()`:
     ```python
     registry.register_stt("deepgram", build_deepgram_stt)
     ```
  3. Set `VOICE_STT_PROVIDER=deepgram` in `.env`.
  Nothing in `agent.py` or `session_factory.py` changes.
- **Dependency Inversion**: `agent.py` depends only on `livekit.agents.Agent`.
  It has no idea Sarvam or Groq exist.
- **Single Responsibility**: config parsing, provider construction, provider
  *selection*, session assembly, and agent behavior are five separate files.
- **No redundant abstraction**: LiveKit's own `stt.STT` / `tts.TTS` / `llm.LLM`
  base classes are the real extension points `AgentSession` expects — the
  registry sits on top of those as the actual provider-selection layer,
  rather than inventing a parallel interface the framework doesn't need.

## Required environment variables

| Variable | Used by | Notes |
|---|---|---|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | worker + `/voice/token` | From your LiveKit Cloud project or self-hosted server |
| `SARVAM_API_KEY` | Sarvam STT/TTS providers | |
| `GROQ_API_KEY` | Groq LLM provider | |
| `VOICE_STT_PROVIDER`, `VOICE_TTS_PROVIDER`, `VOICE_LLM_PROVIDER` | registry | Default `sarvam`/`sarvam`/`groq` |
| `VOICE_STT_LANGUAGE`, `VOICE_TTS_LANGUAGE`, `VOICE_TTS_SPEAKER` | Sarvam providers | BCP-47 codes, e.g. `en-IN`, `hi-IN` |
| `VOICE_LLM_MODEL` | Groq provider | Default `llama-3.3-70b-versatile` |
| `VOICE_AGENT_NAME`, `VOICE_AGENT_INSTRUCTIONS` | agent/worker | |

## Running

```bash
# API server (issues room tokens)
uvicorn app.main:app --reload

# Voice worker (separate process — connects to LiveKit, handles dispatched jobs)
python -m app.services.voice.worker dev
```

Test end-to-end with [LiveKit's Agents Playground](https://agents-playground.livekit.io/)
pointed at your `LIVEKIT_URL`, or by calling `POST /api/v1/voice/token` and
connecting a LiveKit client SDK with the returned token.

## Interruption / barge-in

Handled natively by `AgentSession` — Silero VAD (wired explicitly in
`session_factory.py`) detects user speech and interrupts agent TTS playback
automatically. No custom logic needed; see `turn_handling` on `AgentSession`
if you need to tune sensitivity later.

## Conversation memory

`AgentSession`/`Agent` keep chat context for the lifetime of a call natively.
Persisting context *across* calls (e.g. reusing
`app.services.conversation_service.ConversationService`) is a clear
extension point, not implemented in v1.
