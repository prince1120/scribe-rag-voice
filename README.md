# Scribe — RAG + Voice Assistant

A self-hosted, NotebookLM-style system for talking to your own documents — by text or by voice — built on FastAPI, Next.js, Qdrant, Groq, and LiveKit Agents.

Upload documents, ask questions, get answers grounded in your sources with clickable citations — or start a live voice call with the same assistant. Anyone can also try it without you sharing your API keys: visitors paste their own Groq + Sarvam keys and get a fully isolated session.

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [How it works](#how-it-works)
  - [Document ingestion](#1-document-ingestion)
  - [Retrieval (hybrid search + rerank)](#2-retrieval-hybrid-search--rerank)
  - [Text chat](#3-text-chat)
  - [Bring-your-own model (any OpenAI-compatible API)](#4-bring-your-own-model-any-openai-compatible-api)
  - [Voice assistant](#5-voice-assistant)
  - [Multi-tenancy / demo mode](#6-multi-tenancy--demo-mode)
  - [Conversation memory](#7-conversation-memory)
  - [Document editor](#8-document-editor)
- [Project structure](#project-structure)
- [Environment variables](#environment-variables)
- [Running it](#running-it)
- [Testing](#testing)
- [API reference (short version)](#api-reference-short-version)
- [Troubleshooting](#troubleshooting)

---

## What it does

- **Multi-format document ingestion**: PDF, DOCX, PPTX, XLSX, CSV, TXT, MD, HTML, and images (PNG/JPG/WEBP/BMP/TIFF/GIF) — including OCR for scanned PDFs and photos, no Tesseract install required.
- **Hybrid retrieval**: dense embeddings + BM25 sparse search, fused with Reciprocal Rank Fusion, then cross-encoder reranked — before an LLM ever sees the question.
- **Streaming chat** with inline, clickable `[N.M]` citations back to the exact source chunk.
- **Voice mode**: a real-time voice call with the same assistant (LiveKit Agents + Sarvam STT/TTS), with persona/RAG toggles, a voice picker with instant previews, and live transcript.
- **Bring your own model**: add any OpenAI-compatible endpoint (Mistral, OpenRouter, a self-hosted server, ...) from the UI — just a base URL, API key, and model id — and use it for both chat and voice.
- **No-signup demo mode**: visitors paste their own Groq + Sarvam keys and get an isolated, capped session — never touches your own server keys.
- **In-place document editing**: edit an ingested document's text and have it regenerate the original file format.

## Architecture

```
┌──────────────────────────────┐
│   Next.js Frontend (3000)    │   Chat UI, document manager, voice call UI,
│                               │   settings (models/keys), streaming proxy
└───────────────┬───────────────┘
                │ /api/v1/* (proxied, streams SSE)
┌───────────────┴───────────────┐
│   FastAPI Backend (8000)      │   Ingestion, hybrid retrieval + rerank,
│                               │   chat streaming, tenancy, voice token issuance
└───┬───────────┬───────────┬───┘
    │           │           │
┌───┴───┐  ┌────┴────┐  ┌───┴────┐
│Qdrant │  │  Redis  │  │ SQLite │   Chunks+vectors | live convo cache | durable
│(6333) │  │ (6379)  │  │(rag.db)│   doc/conversation metadata
└───────┘  └─────────┘  └────────┘

┌──────────────────────────────────────────────────────────┐
│   Voice Worker (separate long-lived process, port 8081)   │
│   LiveKit Agents job → Sarvam STT → LLM (Groq or a        │
│   custom OpenAI-compatible endpoint) → Sarvam TTS         │
└───────────────────────────┬────────────────────────────────┘
                             │ registers with
                    ┌────────┴────────┐
                    │  LiveKit Cloud   │  (or self-hosted LiveKit server)
                    │  or self-hosted  │
                    └──────────────────┘
```

The voice worker is architecturally separate from the API server — it's a long-lived process that registers itself with LiveKit and waits for dispatched call jobs, which is a different lifecycle from a request/response web server. The backend now **auto-starts it** for you (see [Voice assistant](#5-voice-assistant)), so day-to-day you don't need to think about this split — it matters mainly if you deploy the two independently (see `docker-compose.yml`).

## How it works

### 1. Document ingestion

`backend/app/services/document_processor.py` dispatches by file extension:

| Type | How text is extracted |
|---|---|
| PDF | Per-page text via PyPDF2; if a page's text is too sparse (scanned/image PDF), it's rasterized with `pypdfium2` and OCR'd instead |
| DOCX / PPTX | python-docx / python-pptx, paragraph/slide-by-slide |
| XLSX / CSV | pandas, sheet/row-based |
| Images (PNG/JPG/...) | Always OCR'd |
| TXT / MD / HTML | Read directly |

**OCR** (`vision_ocr.py`) doesn't use a system Tesseract binary — it sends the image to Groq's vision model (`GROQ_VISION_MODEL`, a Llama-4-Scout vision model) with a strict "output raw text only" prompt. Images that have no readable text still get indexed as a placeholder chunk so they stay discoverable.

**Chunking** prefers *semantic* chunking over fixed windows: text is split into sentences, embedded, and split at points where consecutive sentences' embeddings diverge sharply (cosine-distance percentile method) — so chunks break at topic boundaries instead of mid-thought. It falls back to fixed-size overlapping word windows (`CHUNK_SIZE`/`CHUNK_OVERLAP`) if there's too little text to chunk semantically.

### 2. Retrieval (hybrid search + rerank)

Every query runs through three stages before the LLM sees it (`backend/app/services/`):

1. **Dense + sparse encoding concurrently** — `embedding_service.py` (sentence-transformers, `all-MiniLM-L6-v2` by default) for semantic similarity, and `sparse_encoder.py` (fastembed BM25) for exact keyword matching.
2. **Hybrid search in Qdrant** (`vector_store.py`) — both vector types are queried in parallel and fused with hand-rolled **Reciprocal Rank Fusion** (RRF, k=60), so a chunk that ranks well on *either* signal surfaces, not just the one the dense model favors. One shared Qdrant collection holds every tenant's chunks, isolated by a payload filter on `tenant_id` (not separate collections).
3. **Cross-encoder rerank** (`reranker.py`, FlashRank/ONNX, no PyTorch needed) narrows the over-fetched candidates down to the final top-k actually sent to the LLM.

Citations use hierarchical `doc.chunk` ids (e.g. `[1.2]`) assigned per first-seen document order, so the UI can point back to exactly which chunk of which document backs a claim.

### 3. Text chat

`POST /api/v1/query/stream` streams Server-Sent Events compatible with the Vercel AI SDK. The system prompt adapts to what's actually in play (text-only / images-only / text+images) and enforces strict citation rules so the model can't invent a source id that wasn't retrieved. A separate non-streaming `/query` exists for simple integrations.

### 4. Bring-your-own model (any OpenAI-compatible API)

From **Settings → Active LLM Model → "Add a model"**, add a name, base URL, API key, and model id for *any* OpenAI-compatible chat-completions endpoint — Mistral, OpenRouter, Together, a self-hosted vLLM server, whatever. It's stored only in your browser (`localStorage`), never on the server.

Once added and selected, it's used for **both** chat and voice:

- **Chat**: the request carries `X-Custom-LLM-Base-URL` / `X-Custom-LLM-Key` headers; the backend swaps in `openai.OpenAI(base_url=..., api_key=...)` in place of the Groq client (`rag_pipeline.py::_client_for`) — Groq's SDK is itself a fork of OpenAI's, so nothing else in the pipeline needs to know which one it's talking to.
- **Voice**: the same base URL/key ride along in the LiveKit job-dispatch metadata to the worker, which builds a `custom_openai` provider (`services/voice/providers/openai_compatible_llm.py`, using `livekit-plugins-openai`'s `LLM` with a custom `base_url`) for just that call — STT/TTS stay on Sarvam.

Known gap: a custom model + attached images falls back to Groq's vision model for that turn (custom vision endpoints aren't wired up yet).

### 5. Voice assistant

Built on [LiveKit Agents](https://docs.livekit.io/agents/) (`backend/app/services/voice/`):

```
client → POST /voice/token (issues a LiveKit room token + agent-dispatch metadata)
       → joins the LiveKit room
       → LiveKit dispatches the call as a job to the registered worker
       → worker.entrypoint() → session_factory.build_agent_session(...)
       → AgentSession(stt=Sarvam, llm=Groq or custom, tts=Sarvam, vad=Silero)
```

- **Providers are pluggable** via a small registry (`registry.py`) — adding a new STT/TTS/LLM vendor is "write one factory function, register one line," no changes to the session assembly or agent behavior code.
- **Turn-taking** (barge-in, endpointing, preemptive generation) is tuned in `session_factory.py` to feel like a real assistant rather than a walkie-talkie.
- **`lk.agent.state`** (listening/thinking/speaking) is published automatically by the LiveKit Agents framework and drives the call UI's orb color/animation in real time — no extra plumbing needed on either side.
- **Voice preview**: each voice in the picker has a ▶ button that synthesizes a short sample via Sarvam's REST TTS endpoint directly (`POST /voice/preview`) — no call needed, just to hear it before picking.
- **Personas / RAG toggle**: when RAG is off, pick a canned persona (Assistant/Motivational/Casual/Friend) or write a fully custom system prompt; when RAG is on, the agent answers from your documents via the same retrieval pipeline as text chat (`agent.py`'s `on_user_turn_completed` hook calls `/voice/retrieve` each turn).
- **History continuity**: starting a voice call from an existing text conversation seeds the agent's chat context with that conversation's prior turns (`/voice/history`).

**The worker auto-starts.** It used to require a second terminal (`python -m app.services.voice.worker start`) running at all times, which was the single biggest source of "voice is broken" — if that terminal wasn't open, calls would silently time out. Now:

- The backend launches it automatically on its own startup (`app/main.py`'s lifespan), as a background task so it never delays the API server coming up.
- `POST /voice/token` (fired the instant you click "Start conversation") *also* checks and launches it if it's somehow not running — a safety net independent of backend startup.
- It's spawned detached from the API server process, specifically so `uvicorn --reload` restarts (which happen constantly during development) don't kill and relaunch it every time you save a file. Every check is a real HTTP health probe (livekit-agents' built-in health endpoint, `VOICE_WORKER_HEALTH_PORT`, default 8081) — never an in-memory flag — so this stays correct across restarts.
- Each call is its own isolated job/session that starts and ends with Start/End Call as normal; only the worker *process* now shares the backend's lifetime instead of a single call's.
- Logs land in `backend/voice_worker.log` if you need to check on it.

For a real deployment, `docker-compose.yml` runs the worker as its own supervised service (`restart: unless-stopped` + healthcheck) instead of relying on the API server to babysit it — see [Running it](#running-it).

### 6. Multi-tenancy / demo mode

Anyone can try the app without an account by pasting their own Groq + Sarvam API keys — their usage is billed to *their* key, not yours. `tenant_service.py` derives a stable tenant id by hashing `groq_key + sarvam_key + a browser-generated client id`, so:

- Two different demo visitors who happen to paste the same Groq key from different browsers still land in separate tenants.
- The same visitor's documents/conversations persist across reloads (same browser → same derived tenant).
- Demo sessions get a fixed, smaller `top_k` and a document-count cap (`DEMO_MAX_DOCUMENTS`, `DEMO_TOP_K`) regardless of what the client requests — enforced server-side, not just hidden in the UI.

Your own (non-demo) usage stays on the `"default"` tenant using the server's own `.env` keys.

### 7. Conversation memory

Two different stores, for two different jobs:

- **Redis** (`conversation_service.py`) holds the *live* rolling context fed to the LLM for the current back-and-forth — fast, short-lived, and falls back transparently to an in-process dict if Redis isn't reachable (nothing breaks without it, you just lose durability across restarts).
- **SQLite via SQLAlchemy** (`repositories.py`) is the *durable* record — every message, with citations, for the conversation list and history UI. Actual chunk text and vectors live in Qdrant, not here; this is metadata only.

### 8. Document editor

`content_editor.py` lets you edit an ingested document's extracted text and regenerates the original file format from your edit (DOCX/PPTX/XLSX/PDF/TXT/MD/HTML/CSV). This is deliberately lossy for binary formats — it trades original fonts/images/layout for a simple, dependency-light editor rather than embedding a full office-document engine.

## Project structure

```
.
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app, lifespan (starts voice worker), middleware
│   │   ├── config.py                # Settings (env vars) for the API server
│   │   ├── auth.py                  # X-API-Key dependency
│   │   ├── rate_limit.py            # slowapi limiter (per-IP)
│   │   ├── database.py              # SQLAlchemy async engine/session
│   │   ├── repositories.py          # Document/conversation/message persistence
│   │   ├── utils.py                 # filename sanitizing, citation numbering, demo tenant id
│   │   ├── api/
│   │   │   ├── routes.py            # documents, query/query-stream, conversations, health
│   │   │   └── voice_routes.py      # /voice/token, /health, /preview, /retrieve, /history
│   │   ├── models/schemas.py        # Pydantic request/response models
│   │   └── services/
│   │       ├── document_processor.py, vision_ocr.py
│   │       ├── embedding_service.py, sparse_encoder.py, vector_store.py, reranker.py
│   │       ├── rag_pipeline.py      # prompt building + Groq/custom LLM calls
│   │       ├── conversation_service.py
│   │       ├── content_editor.py
│   │       ├── tenant_service.py
│   │       └── voice/               # see "Voice assistant" above
│   │           ├── worker.py, worker_supervisor.py, agent.py, session_factory.py
│   │           ├── registry.py, config.py, rag_client.py
│   │           └── providers/       # groq_llm.py, openai_compatible_llm.py, sarvam_stt.py, sarvam_tts.py
│   ├── tests/                       # pytest — see Testing below
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── page.tsx                 # main chat UI, documents, settings, demo gate
│   │   ├── VoiceCall.tsx            # voice call modal
│   │   ├── Toast.tsx, Logo.tsx
│   │   └── api/v1/[...path]/route.ts  # streaming proxy to the backend
│   └── package.json
├── docker-compose.yml                # qdrant, redis, backend, voice-worker, frontend
├── start_backend.ps1 / start_frontend.ps1
└── .github/workflows/ci.yml          # backend pytest + frontend lint/build
```

## Environment variables

Full, commented list lives in [`backend/.env.example`](backend/.env.example) (copy to `backend/.env`) and [`frontend/.env.example`](frontend/.env.example). Highlights:

| Variable | Required for | Notes |
|---|---|---|
| `GROQ_API_KEY` | Chat, default voice LLM, OCR | Free tier: console.groq.com |
| `QDRANT_HOST` / `QDRANT_PORT` | Everything | `docker-compose up qdrant` or Qdrant Cloud |
| `API_KEY` | Production | Empty = auth disabled (dev only, logs a warning) |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Voice | Free project: cloud.livekit.io. Leave empty to disable voice entirely |
| `SARVAM_API_KEY` | Voice | dashboard.sarvam.ai |
| `REDIS_HOST` | Optional | Falls back to in-memory automatically |
| `DATABASE_URL` | Everything | Defaults to local SQLite, no setup needed |

The frontend's `.env` only needs `BACKEND_ORIGIN` (and `BACKEND_API_KEY` if you set `API_KEY` on the backend) — everything else (model choice, custom-model keys, demo Groq/Sarvam keys) is entered in the UI and stored in the browser.

## Running it

**Local dev (two terminals):**
```powershell
.\start_backend.ps1     # installs deps, runs uvicorn --reload on :8000 (also auto-starts the voice worker)
.\start_frontend.ps1    # npm install + next dev on :3000
```
Qdrant/Redis need to be reachable — either `docker compose up qdrant redis` or a cloud instance (see `.env.example`).

**Docker Compose (full stack, production-shaped):**
```bash
docker compose up -d --build
```
Brings up Qdrant, Redis, the API server, the voice worker (as its own supervised, health-checked, auto-restarting service), and the frontend. This is the setup that actually matches the "worker keeps running independently" design — locally, the API-server-managed auto-start is a dev convenience, not a substitute for this.

## Testing

```bash
cd backend
pytest
```
Covers: content editor round-tripping, document chunking (fixed + semantic), RAG prompt/citation building, filename/citation utils, hybrid-search RRF fusion ranking, and the voice provider registry. CI (`.github/workflows/ci.yml`) runs this plus `npm run lint && npm run build` on the frontend for every push/PR to `main`.

## API reference (short version)

Full interactive docs at `http://localhost:8000/docs` once the backend is running. Main endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/documents/upload`, `/documents/paste` | Ingest a file or pasted text |
| `POST /api/v1/query/stream` | Streaming chat (SSE) |
| `GET /api/v1/conversations` | Conversation history list |
| `POST /api/v1/voice/token` | Issue a LiveKit room token (starts the call) |
| `GET /api/v1/voice/voices`, `/voice/personas` | Options for the voice picker |
| `POST /api/v1/voice/preview` | Synthesize a short voice sample |
| `GET /api/v1/health` | Liveness/readiness (Qdrant, LLM client, DB, Redis) |

## Troubleshooting

- **Voice call times out / "assistant isn't responding"**: check `backend/voice_worker.log` — the worker auto-starts, but a missing `LIVEKIT_URL`/`SARVAM_API_KEY` will make it fail to register.
- **"could not establish signal connection" in the browser**: this is a network-layer failure connecting to LiveKit, not the app — most commonly a broken IPv6 route on your machine/network (LiveKit Cloud resolves to IPv6 first). Try disabling IPv6 on your active adapter, or verify with `curl -6 https://<your-livekit-host>` vs `curl -4`.
- **Groq rate limit errors**: free tier has per-minute token limits — wait a bit or upgrade at console.groq.com.
- **Qdrant connection errors**: `docker ps` to confirm it's running, or check `QDRANT_HOST`/`QDRANT_API_KEY` for a Cloud instance.
