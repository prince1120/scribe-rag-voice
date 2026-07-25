# Scribe — Production Hardening Plan

**Status:** in progress. **Last updated:** 2026-07-25.

This document is a **handoff spec**. It is written so that any engineer or AI assistant can pick up the work cold, without the conversation that produced it. Read it top to bottom before changing code.

---

## 0. Context you need first

### What the product is

Scribe lets a user upload documents and then ask questions about them **two ways**: by typing in a chat, or by holding a live spoken conversation with a voice agent. Every answer carries `[N.M]` citations pointing at the exact document and chunk the claim came from.

### What the owner decided

The owner has **no budget** and is **not pursuing monetization right now**. The goal is narrow and explicit:

> Make the existing application run correctly and safely in production, at zero cost.

**Therefore, do NOT:**
- Add billing, Stripe, plans, or usage-based pricing.
- Pivot the product to a vertical, or reposition it.
- Introduce any paid service or infrastructure.
- Rewrite working subsystems for elegance alone.

**Decisions already made:**
| Decision | Choice | Rationale |
|---|---|---|
| Access control | Single passcode gate + signed HttpOnly session cookie | Free, no DB tables, no OAuth; closes the security hole without building accounts |
| Database | Supabase Postgres | Free tier; free hosts wipe local disk, so SQLite loses all data on redeploy |
| File storage | Supabase Storage | Same free project (1 GB); container disk is ephemeral |
| Demo mode | Keep it | Visitors paste their own Groq/Sarvam keys; costs the owner nothing |

### Existing quality — do not "fix" these

These parts are good. Leave them alone unless a task below explicitly says otherwise.

- **Retrieval pipeline.** Semantic chunking (embedding-divergence split), hybrid dense + BM25 retrieval fused with Reciprocal Rank Fusion, then cross-encoder rerank. Better than typical RAG.
- **Citation integrity.** The server computes the allowed citation IDs and passes an explicit allowlist into the prompt, so the model cannot invent a source. See `rag_pipeline.py::_build_context`.
- **Voice architecture.** Provider registry + session factory keep vendor SDKs out of agent behavior code. Adding a vendor is one factory function.
- **Observability basics.** JSON logging with a request-ID contextvar, per-component health checks, latency instrumentation.

### Baseline health

`cd backend && pytest` → **62 passed**. This must stay green after every task below.

---

## 1. Architecture as it stands

```
Browser
  └── Next.js (:3000)
        ├── app/page.tsx          ← 3,695-line single component (known liability)
        ├── app/VoiceCall.tsx     ← voice call modal
        └── app/api/v1/[...path]/route.ts   ← streaming proxy, injects BACKEND_API_KEY
              │
              ▼
      FastAPI (:8000)
        ├── api/routes.py         ← documents, query, query/stream, conversations
        ├── api/voice_routes.py   ← LiveKit token, retrieve, history, preview
        └── services/             ← retrieval, RAG, ingestion, tenancy
              │
     ┌────────┼──────────┬─────────────┐
     ▼        ▼          ▼             ▼
  Qdrant   Redis     Postgres     uploads/ on disk
 (vectors) (cache)  (metadata)    (ephemeral!)

  Voice worker (:8081) — separate long-lived LiveKit Agents process
```

---

## 2. The four problems, in priority order

### PROBLEM 1 — Anyone can read and delete all documents  🔴 CRITICAL

**Status:** ✅ DONE — verified against a running server; all attack paths return 401.

**The bug.** Tenancy is chosen by the client. `frontend/app/page.tsx:595` hardcodes `const [tenantId] = useState("default")` and sends it as a plain request parameter. The backend trusts it (`backend/app/api/routes.py:68` `_effective_tenant`).

Separately, the Next proxy (`frontend/app/api/v1/[...path]/route.ts:41`) injects `BACKEND_API_KEY` server-side on every request. The proxy is public and unauthenticated. So the backend's `API_KEY` check is satisfied for **any anonymous internet request**.

**Combined result** — with only the public URL, anyone can run:

```bash
curl "https://your-app/api/v1/documents?tenant_id=default"              # list every document
curl "https://your-app/api/v1/documents/<id>/file?tenant_id=default"    # download any of them
curl -X DELETE "https://your-app/api/v1/documents/<id>?tenant_id=default"  # delete them
curl "https://your-app/api/v1/conversations?tenant_id=default"          # read every chat
```

…and burn the owner's Groq and LiveKit quota. CORS does not help; it only constrains browsers, not `curl`.

**The fix.** The server must own identity. The client must never state who it is.

1. **`backend/app/session.py`** (new). Sign session payloads with HMAC-SHA256 using stdlib `hmac`/`hashlib` — do not add a dependency. Payload: `{"kind": "owner", "iat": <ts>}`. Encode base64url, append signature, verify with `hmac.compare_digest`. Enforce TTL from `iat`.
2. **`backend/app/config.py`** — add:
   - `APP_ACCESS_PASSCODE: str = ""` — empty disables the gate (local dev only; log a loud warning exactly like the existing `API_KEY` warning in `main.py:78`).
   - `SESSION_SECRET: str = ""` — **must** be set whenever `APP_ACCESS_PASSCODE` is set; fail startup if not.
   - `SESSION_TTL_DAYS: int = 30`
   - `TRUST_PROXY_HEADERS: bool = False`
3. **`backend/app/api/session_routes.py`** (new) — `POST /api/v1/session/login` takes `{passcode}`, compares with `hmac.compare_digest` (constant-time; never `==`), sets cookie `scribe_session` with `HttpOnly`, `SameSite=Lax`, `Secure` when not `DEBUG`, `Path=/`. Also `POST /session/logout` and `GET /session` (returns whether authenticated). **Rate-limit login attempts** — this endpoint is the whole security boundary.
4. **Identity dependency** replacing `_effective_tenant`. Resolution order, with no client input:
   - Valid session cookie → tenant `"default"` (the owner's existing tenant — keep this string so current data stays reachable).
   - No cookie but `X-User-Groq-Key` present → demo tenant, derived server-side by `tenant_service.derive_tenant_id` (already correct — it hashes a secret only the visitor holds).
   - Neither → **HTTP 401**.
5. **Delete `tenant_id` from every request model and query signature** — `routes.py`, `voice_routes.py`, and `models/schemas.py`. This is the actual fix; steps 1–4 are the machinery. Grep for `tenant_id` and confirm no remaining *inbound* use.
6. **`utils.py::derive_demo_tenant_id`** is dead code duplicating `tenant_service.derive_tenant_id`. Delete it and its test.
7. **Frontend** — the proxy must relay `Set-Cookie`. `new Headers()` collapses duplicate `Set-Cookie` values, so use `upstreamResponse.headers.getSetCookie()` and `append` each one. Add a passcode screen shown on 401. Remove every `tenant_id` from requests. Ensure `credentials: "include"` on fetches.

**Verification.** All four `curl` commands above must return `401`. The app must still work in a browser after entering the passcode. Demo mode must still work with pasted keys. `pytest` green, plus new tests: forged cookie rejected, expired cookie rejected, wrong passcode rejected, missing credentials → 401.

---

### PROBLEM 2 — All data is destroyed on every redeploy  🔴 CRITICAL

**Status:** ✅ MOSTLY DONE — connected to Supabase Postgres 17.6, tables created, pooler settings applied. Alembic migrations still outstanding (see step 4). The owner chose to start with an empty database rather than migrate the old SQLite rows.

**The bug.** `DATABASE_URL` defaults to `sqlite+aiosqlite:///./rag.db` — a file on the container's disk. Free hosts give ephemeral disks, so every deploy wipes documents, conversations, and message history. SQLite also cannot serve more than one process, so the app can never scale past a single worker.

**The fix.** Move to the owner's Supabase Postgres.

1. Add `asyncpg` to `backend/requirements.txt`.
2. **Connection string** goes in `backend/.env` — the owner sets this themselves; it contains a password and must never be committed or pasted into a chat:
   ```
   DATABASE_URL=postgresql+asyncpg://postgres.<ref>:<PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres
   ```
   Note `+asyncpg`, and percent-encode special characters in the password (`@` → `%40`).
3. **Supabase pooler compatibility** in `database.py::create_async_engine`. This is the step most likely to be done wrong:
   - `connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0}` — the pooler breaks asyncpg's prepared statements.
   - `pool_pre_ping=True` — the pooler drops idle connections.
   - `pool_size=5, max_overflow=5` — the free tier has a low connection ceiling.
   - Keep SQLite working for local dev: apply these only when the URL starts with `postgresql`.
4. **Replace `Base.metadata.create_all`** (`database.py:26`) with Alembic. `create_all` never alters an existing table, so the first schema change against a real database silently does nothing. Add `alembic/`, generate the initial revision from the current models, and run `alembic upgrade head` at startup or in the deploy step.
5. Update `docker-compose.yml` — drop `DATABASE_URL=sqlite+aiosqlite:///./data/rag.db` from the backend service.

**Verification.** Boot against Supabase, upload a document, restart the container, confirm the document is still listed. Confirm tables exist in the Supabase dashboard.

---

### PROBLEM 3 — Errors leak internals and freeze the chat  🟠 HIGH

**Status:** NOT STARTED

**Three separate bugs:**

**(a) Internal error text sent to clients.** `routes.py:454` and `routes.py:612` do `raise HTTPException(status_code=500, detail=str(e))`. That can expose connection strings, file paths, and library internals. Fix: log the exception with the request ID, return a fixed opaque message plus the request ID so logs can be correlated. Add a global handler on the app for unhandled exceptions.

**(b) Streaming failure hangs the UI forever.** In `routes.py:565`, `generate()` yields SSE frames. If `rag_pipeline.generate_streaming_response` raises mid-stream, the HTTP response has already started with status 200 — the connection simply dies, no error frame is sent, and the frontend waits indefinitely. Fix: wrap the loop in `try/except`, emit `data: {"error": "..."}` followed by `data: [DONE]`, and have the frontend render it.

**(c) Rate limiting does not work.** `rate_limit.py:7` keys on `get_remote_address`, i.e. `request.client.host`. Behind the Next proxy every request has the proxy's IP, so the whole internet shares one 20/min bucket — trivial self-DoS, and no real per-user limit. Fix: key on session/tenant identity, falling back to IP; honor the leftmost `X-Forwarded-For` entry **only** when `TRUST_PROXY_HEADERS` is true (trusting it unconditionally lets a caller spoof the key and bypass limits entirely).

**Also fix while here:** `routes.py:176` tells users to install Tesseract when extraction fails. That advice is wrong — OCR goes through a Groq vision model (`vision_ocr.py`), and there is no Tesseract dependency anywhere.

**Verification.** Force an LLM failure (bad `GROQ_API_KEY`) and confirm the UI shows an error instead of spinning forever. Confirm 500 responses contain no exception text.

---

### PROBLEM 4 — Uploaded files vanish on redeploy  🟠 HIGH

**Status:** NOT STARTED

**The bug.** Uploads are written to a relative `"uploads"` directory (`routes.py:257`), resolved against the process working directory — same ephemeral disk as Problem 2. When files disappear, three features break: document download (`/documents/{id}/file`), the document editor (`content_editor.py` reads the original file), and image questions (`rag_pipeline.py::_collect_image_paths` reads image paths from disk).

Worse, `_find_upload_file` (`routes.py:726`) scans the entire uploads directory on every call — O(n) per request, and it locates files **without checking tenant ownership**; ownership is verified separately just above each call site. That is a correctness footgun waiting for a refactor to trip over.

**The fix.**
1. Introduce `backend/app/services/storage.py` with a small interface: `save(key, data)`, `open(key)`, `delete(key)`, `exists(key)`.
2. Two implementations: `LocalDiskStorage` (dev, absolute path from config, not CWD-relative) and `SupabaseStorage` (production, via the Supabase Storage REST API — use a **private** bucket and signed URLs; never public).
3. Store the storage key on `DocumentRecord` instead of rediscovering it by directory scan. This removes `_find_upload_file` entirely and makes ownership a database lookup.
4. Image handling in `rag_pipeline._collect_image_paths` currently assumes a local path — it must fetch through the storage interface instead.

**Verification.** Upload a document, redeploy, then download it, edit it, and ask a question about an uploaded image.

---

### PROBLEM 5 — Response quality and voice latency  🟠 HIGH

**Status:** ✅ FIRST PASS DONE (prompts + turn-taking). Streaming-level latency work outstanding.

**What was wrong.** Voice answers felt generic because the prompt *required* it, not because of the model:
- `_VOICE_STYLE` capped every reply at "1-2 sentences maximum, never more than 3", so any multi-part answer was truncated into uselessness.
- `build_instructions` asked the model to insert filler sounds ("um", "uh") to seem human. It reads as hesitant, and every filler token is real TTS time.
- `VOICE_LLM_MAX_TOKENS=200` cut longer answers off mid-sentence.
- `VOICE_ENDPOINTING_MIN_DELAY` was `0.55` while its own comment said `0.35` was correct — 200 ms of dead air on *every* turn.
- `rag_client` opened a **new `aiohttp.ClientSession` per lookup**, forcing a fresh TCP (and TLS) handshake on every conversational turn, inside the pause before the assistant speaks.

**What changed.**
| Change | File | Effect |
|---|---|---|
| Rewrote spoken-delivery rules: length follows the question, sequence not bullets, spoken numbers | `voice/config.py` | Substantive answers that still work aloud |
| Added `_HONESTY` block to **every** mode, including custom personas | `voice/config.py` | Corrects wrong premises, no flattery openers, holds position under pushback |
| Removed filler-sound instruction | `voice/config.py` | More professional, fewer wasted TTS tokens |
| `MAX_TOKENS` 200 → 320 (cap 450), temperature 0.1 → 0.3 | `voice/config.py` | Complete answers, less robotic phrasing |
| Endpointing 0.55 → 0.35 s, max 1.2 → 0.9 s | `voice/config.py` | ~200 ms off every turn |
| Shared keep-alive connection pool | `voice/rag_client.py` | Removes handshake from the critical path |
| Voice rerank candidates 20 → 10 | `api/voice_routes.py` | Fewer cross-encoder passes before speaking |
| Same honesty rules + per-claim (not per-sentence) citations | `services/rag_pipeline.py` | Text chat matches the same standard, reads less robotically |

`VOICE_VAD_MIN_SILENCE` was deliberately **left at 0.45**. Endpointing delay was the dominant term and is already cut; lowering both at once risks clipping users mid-breath, which is far worse than 100 ms.

Locked in by `tests/test_voice_prompts.py` (20 tests) as behavioural invariants, not string snapshots.

**Still outstanding for latency:**
1. Measure before claiming. Add turn-level timing (speech end → LLM first token → first TTS audio) and log it, so tuning is evidence-based rather than intuition.
2. The RAG lookup still blocks the reply. Consider speculatively starting retrieval on partial transcript rather than waiting for the finalised turn.
3. The filler phrase ("let me check that") is a band-aid over a slow path — it should become unnecessary, not permanent.
4. Embedding + rerank run in a threadpool inside the API server, competing with request handling. Consider a dedicated executor.

---

### PROBLEM 6 — UI is not production-grade  🟠 HIGH (owner's explicit priority)

**Status:** IN PROGRESS. Foundation + chat surface done; shell, voice, and documents remain.

**Done so far**
- `styles/design-system.css` — spacing/type scales, warm-tinted elevation, motion capped at 260ms, real `prefers-reduced-motion` support.
- `lib/api.ts` — typed client with `ApiError.status`, and an SSE reader that buffers across chunk boundaries (the old per-chunk parse dropped tokens whenever a frame straddled a read).
- `components/chat/` — `citations.tsx`, `Message.tsx`, `Composer.tsx` + `styles/chat.css`.
- `page.tsx` renders messages through `Message`; 243 lines of superseded rendering code removed. **3,695 → 3,281 lines.**
- Verified in a browser at 1280px and 375px: no horizontal overflow at either width.

**Lesson worth keeping:** before swapping any surface, diff the old markup against the replacement feature by feature. The first attempt at this swap would have silently dropped image attachments, the copy button, filtered sources, and latency metrics. Parity check first, swap second.

**Next, in order**
1. **App shell** — sidebar → off-canvas drawer under 768px. Currently the sidebar has no mobile treatment.
2. **Composer** — not yet swapped. The old one carries drag-and-drop image attach and a preview strip that `Composer.tsx` does not implement yet; port those before replacing it.
3. **Voice call surface** — full-screen, orb states, transcript.
4. **Documents + settings panels.**

**The problem.** `frontend/app/page.tsx` is a single 3,695-line component holding chat, documents, settings, citations, the demo gate, and model management. There is no mobile layout, no design system, and no component boundaries — which is why it is hard to make anything look polished.

**Required outcome:** polished, modern, premium-feeling, and genuinely responsive on both phone and desktop, with smooth interactions.

**Approach — structure first, then style.** Restyling a monolith does not survive; the decomposition is what makes polish achievable.

1. **Design tokens** in `globals.css`: spacing scale, type scale, radii, elevation, motion durations/easings. The existing warm palette (`--claude-bg` etc.) is good and should be kept and extended, not replaced.
2. **Decompose by responsibility** (SOLID, per `.agents/AGENTS.md`):
   - `components/chat/` — MessageList, Message, Composer, CitationChip, MarkdownAnswer
   - `components/documents/` — DocumentList, UploadDropzone, DocumentEditor
   - `components/settings/` — SettingsPanel, ModelPicker
   - `components/voice/` — CallSurface, VoiceOrb, TranscriptView
   - `hooks/` — `useChat`, `useDocuments`, `useSession`, `useVoiceCall` (state and I/O out of components)
   - `lib/api.ts` — one typed client; today `fetch` calls are scattered through the monolith
3. **Responsive layout:** desktop = persistent sidebar; mobile = off-canvas drawer, bottom-anchored composer respecting safe-area insets, ≥44 px touch targets, full-screen voice surface. Test at 375 px.
4. **Interaction polish:** streaming cursor, skeletons instead of spinners, optimistic message send, animated citation hover/expand, `prefers-reduced-motion` respected.
5. **Accessibility:** focus rings, keyboard navigation, ARIA live region for streaming answers, labelled controls.

**Constraint:** citations, SSE streaming, and voice must keep working at every step. Move one surface at a time and verify, rather than rewriting the file in one pass.

---

## 3. Known issues NOT yet scheduled

Recorded so they are not lost. Do not start these before Problems 1–4 are done.

| Issue | Location | Notes |
|---|---|---|
| **UI is unprofessional and not responsive** — owner's explicit priority | `frontend/app/page.tsx` | One 3,695-line component; no mobile layout. Needs decomposition into components/hooks, a real design system, a mobile drawer for documents/conversations, a touch-friendly composer, and a full-screen voice surface. Scheduled next after Problem 3. |
| Voice worker starts twice under Compose | `main.py:63` + `docker-compose.yml` | Backend auto-spawns it *and* Compose runs it as a service. Auto-spawn should be disabled when a flag like `VOICE_WORKER_MANAGED_EXTERNALLY` is set. |
| ML models load at import time | `routes.py:36-65` | Module-level singletons make cold start slow and tests heavy. Move behind a lazy provider / FastAPI dependency. |
| Blocking work in health check | `routes.py:98` | Every liveness probe hits Qdrant and the tokenizer. Split into a cheap `/health/live` and a full `/health/ready`. |
| Persist blocks a worker thread per stream | `routes.py:554` | `run_coroutine_threadsafe(...).result(timeout=10)` inside the sync generator. Also, a client disconnect mid-stream means the assistant message is never saved. |
| No retrieval quality evaluation | — | The citation promise is the product's core claim, but nothing measures whether retrieval actually returns the right chunks. A small golden-question set would protect against regressions. |
| PyPDF2 is deprecated | `document_processor.py` | Migrate to `pypdf`. Emits a `DeprecationWarning` in the test run today. |

---

## 4. Working agreement

- **`pytest` must stay green.** 62 tests currently pass; treat a failure as a stop-the-line event.
- **Work one problem at a time**, in the numbered order, and verify before moving on.
- Follow `.agents/AGENTS.md` (SOLID) — it is the owner's stated standard.
- **Never commit secrets.** `.gitignore` is already correct; keep it that way. The database password and API keys belong only in `backend/.env`.
- Prefer editing existing files over adding new ones; this codebase is already well-factored in the backend.
