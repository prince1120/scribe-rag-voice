# Real-Time Voice Agent Engine (Sub-800ms Architecture)

Enterprise real-time conversational voice AI engine built on [LiveKit Agents](https://docs.livekit.io/agents/), utilizing Groq / Mistral for streaming LLM inference, Sarvam AI for multilingual streaming STT and expressive TTS, and Silero VAD for voice activity detection.

The architecture is engineered to match big-tech conversational standards (Vapi, Retell AI, OpenAI Realtime) with **sub-800ms total voice-to-voice latency**, **instant <50ms hardware barge-in**, **dynamic syntactic end-of-thought prediction**, and **fast clause-based TTS streaming**.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Client (WebRTC / Next.js)                          │
│   • 48kHz Studio Mic Capture (AEC, AGC, Noise Suppression)                  │
│   • Instant Audio Sink Zero-Lag Mute & Reset (<50ms on DataChannel Packet)   │
└──────────────┬──────────────────────────────────────────────▲───────────────┘
               │ Audio Up                                     │ Audio Down +
               │ (WebRTC)                                     │ DataChannel
               ▼                                              │
┌─────────────────────────────────────────────────────────────┴───────────────┐
│                    Voice Worker Engine (LiveKit Agents)                     │
│                                                                             │
│  1. Silero VAD ──> Commit ──> Dispatches DataChannel 'user_speech_committed'│
│                                (Cuts off client audio playback instantly)   │
│                                                                             │
│  2. Sarvam Streaming STT ──> Real-time Transcripts                          │
│                                                                             │
│  3. Syntactic EOT Predictor                                                 │
│     • Terminal punctuation (? . ! ।) ──> Fast endpoint (220ms - 450ms)      │
│     • Conjunctions / Hesitations ──────> Generous hold (600ms - 850ms)      │
│                                                                             │
│  4. Streaming LLM (Groq / Mistral) ──> Token by Token                       │
│                                                                             │
│  5. Fast Clause TTS Chunker (speech_clean.py)                               │
│     • First clause at >=24 chars on boundaries (, ; : -) [TTFB <300ms]      │
│     • Subsequent clauses at >=48 chars for natural prosody                  │
│     • Cleans markdown, asterisks, bullet noise, emojis                      │
│                                                                             │
│  6. Sarvam Expressive Streaming TTS ──> WebRTC Audio Track Out              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5 Pillars of the High-Performance Pipeline

### 1. Instant Hardware Barge-In (<50ms Cutoff)
- **Problem**: When a user interrupts the bot, WebRTC audio buffers in browser `<audio>` elements continue playing for 300–800ms even after server cancellation.
- **Solution**: The voice worker hooks into `user_speech_committed` and immediately broadcasts an out-of-band JSON packet across the WebRTC DataChannel:
  ```json
  {"type": "user_speech_committed", "timestamp": 1725700000.123}
  ```
- All client audio sinks (`VoiceCall.tsx`, `CallScreen.tsx`, `AgentVoiceTest.tsx`) capture this packet and instantly pause and reset `<audio>` elements (`audio.currentTime = 0; audio.pause()`). Audio output ceases in under 50ms.

### 2. Non-Replaying Adaptive Interruption
- Configured with `mode="adaptive"`, `min_words=1`, `min_duration=0.20`, and `resume_false_interruption=False`.
- The assistant immediately stops generating and does not clumsily repeat or replay cut-off sentences.

### 3. Dynamic Syntactic End-of-Thought (EOT) Predictor
- Traditional systems use fixed VAD silence delays (e.g. 800ms), causing sluggish conversational flow.
- The EOT predictor inspects token transcripts dynamically:
  - If user ends with terminal marks (`?`, `.`, `!`, `।`), the system triggers an ultra-fast turn endpointing (`min_delay=0.22s`, `max_delay=0.45s`).
  - If user pauses on continuations or hesitation markers (`and`, `or`, `because`, `aur`, `lekin`, `ki`, `toh`), it extends the delay (`min_delay=0.60s`, `max_delay=0.85s`) to prevent mid-sentence cutting off.
  - Otherwise it maintains balanced defaults (`min_delay=0.28s`, `max_delay=0.70s`).

### 4. Sliding-Window Fast Clause TTS Chunker
- Text-to-Speech synthesis starts on the very first grammatical clause (`VOICE_TTS_FIRST_CHUNK_MIN_CHARS=24`) as soon as punctuation (`[,;:—-]`) is reached.
- Eliminates the 800ms+ full-sentence wait, delivering initial audio playback in **under 300ms** after LLM start.
- Subsequent chunks buffer to >=48 characters to preserve natural phrasing and intonation.
- Filters LLM markdown artifacts (`*bold*`, `# headers`, emojis) before sending to TTS.

### 5. Studio-Grade 48kHz Audio Capture
- Client WebRTC constraints enforce:
  ```ts
  sampleRate: 48000,
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
  ```
- Ensures pristine audio clarity for Sarvam STT.

---

## Code Structure & SOLID Architecture

```
backend/app/services/voice/
├── domain/
│   └── interfaces.py       # Contracts: STTFactory, TTSFactory, LLMFactory, VoiceDataPacket
├── providers/
│   ├── groq_llm.py         # Groq provider factory
│   ├── mistral_llm.py      # Mistral provider factory
│   ├── custom_llm.py       # OpenAI-compatible custom provider factory
│   ├── sarvam_stt.py       # Sarvam STT provider factory
│   └── sarvam_tts.py       # Sarvam TTS provider factory
├── config.py               # Pydantic BaseSettings with fine-grained latency controls
├── speech_clean.py         # Fast clause chunker and emoji/markdown cleaner
├── turn_metrics.py         # Per-turn latency & timing tracker
├── rag_client.py           # RAG retrieval client for voice assistant
├── filler.py               # Conversational fillers generator
├── registry.py             # Dependency Injection registry
├── agent.py                # Assistant behavior & chunked TTS streaming pipeline
├── session_factory.py      # Composition root for AgentSession & VAD tuning
├── worker.py               # LiveKit Agents entrypoint & dynamic EOT predictor
├── worker_reload.py        # Hot-reloading watcher for development
└── worker_supervisor.py    # Auto-spawning supervisor with self-healing port clearance
```

---

## Single-Command Backend Execution

The entire backend (FastAPI API server + supervised LiveKit Voice Worker) runs from **one command**.

### Option A: Cross-Platform Python (Recommended)
From the project root:
```bash
python run_backend.py
```
This automatically:
1. Detects and activates the local `venv`.
2. Checks / starts Redis and Qdrant in Docker Desktop if needed.
3. Automatically terminates any stale processes squatting the voice worker port (`8081`).
4. Boots FastAPI (Uvicorn with auto-reload), which launches and manages the LiveKit Voice Worker.

### Option B: PowerShell (Windows)
From the project root:
```powershell
.\start_backend.ps1
```

---

## Configuration & Tuning Parameters

All settings are configured via `backend/.env` using standard Pydantic validation:

| Setting | Default | Purpose |
|---|---|---|
| `LIVEKIT_URL` | - | LiveKit Cloud / Server WebRTC endpoint |
| `LIVEKIT_API_KEY` | - | LiveKit API Key |
| `LIVEKIT_API_SECRET` | - | LiveKit API Secret |
| `SARVAM_API_KEY` | - | Sarvam AI STT & TTS key |
| `GROQ_API_KEY` | - | Groq LLM API key |
| `VOICE_ENDPOINTING_MIN_DELAY` | `0.28` | Default minimum VAD pause before turn commit (sec) |
| `VOICE_ENDPOINTING_MAX_DELAY` | `0.70` | Default maximum VAD pause before turn commit (sec) |
| `VOICE_INTERRUPT_MIN_WORDS` | `1` | Minimum words needed to validate interruption |
| `VOICE_INTERRUPT_MIN_DURATION` | `0.20` | Minimum vocal duration to validate interruption (sec) |
| `VOICE_TTS_FIRST_CHUNK_MIN_CHARS` | `24` | Min characters to emit first clause to TTS (sub-300ms TTFB) |
| `VOICE_TTS_SUBSEQUENT_CHUNK_MIN_CHARS` | `48` | Min characters for subsequent clauses (prosody balance) |
| `VOICE_TTS_CHUNK_MAX_CHARS` | `200` | Max character ceiling before hard flush |
| `VOICE_WORKER_HEALTH_URL` | `http://127.0.0.1:8081` | Voice worker health probe endpoint |
