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

---

## PROBLEM 7 — Two products in one app: Personal and Business  🔵 NEXT MAJOR DIRECTION

**Status:** DESIGN AGREED, NOT STARTED. Invite links (Problem 8 below) are built and are the foundation this sits on.

### The decision

When someone arrives with their own Groq/Sarvam keys, ask one question: **Personal or Business?**

**Personal** — the app exactly as it is today. Upload documents, chat, call. Nothing changes. This is the existing product and must keep working untouched.

**Business** — a different product built from the same engine. The owner is not here to browse their documents; they are here to *configure an assistant others will talk to*.

### Business mode: what the owner sees

A setup screen, and nothing else:

1. **Agent script** — the prompt. Who the assistant is, how it speaks, what it should and shouldn't say. This is the owner's main lever.
2. **Voice** — pick from the existing voice list, with preview.
3. **Documents** — up to **3**, small. A business FAQ, price list, and policy sheet is the realistic shape; this is not a document library.
4. **RAG toggle for voice** — on means answers come from those documents, off means the script alone.
5. **Test it** — try the configured agent in both voice and chat before sharing it. Nobody should hand out a link to something they have not heard.

Then: create links, share them, and read every conversation that happens.

### Business mode: what the caller sees

Only the agent they were given a link to. No document sidebar, no settings, no other owners. The call screen already built for voice-only links (`/t/[token]` → `CallScreen`) is the right surface.

### What this requires

- **Un-hardcode the owner.** `OWNER_TENANT_ID = "default"` is assumed in ~8 places, and every contact route uses it in place of "the tenant of whoever is asking". This is the blocking change and everything else depends on it.
- **An owner record** — durable, rather than a tenant id derived from a key hash. An owner rotating their API key must not lose their agent, links, and history.
- **An agent config per owner** — script, voice, RAG on/off, document cap. New table, owned by the owner tenant.
- **Contacts scoped to their owner** — the `owner_tenant_id` column already exists, so this is mostly swapping the constant for the caller's tenant.
- **Conversations scoped to their owner** — so each owner reads only their own callers' transcripts.
- **Per-owner quotas** — each owner spends their own key, so one cannot drain another's.

### Order

1. Un-hardcode the owner (blocking; do this first and alone)
2. Owner record + mode choice on first arrival
3. Agent config table + the setup screen
4. Scope contacts, sessions, and transcripts per owner
5. Test-your-agent flow
6. Per-owner quotas

### Open question, worth deciding deliberately

A public directory — users browsing owners and picking one — is a *different product* again, with abuse and moderation problems this app has no answer for yet. Business mode as described above does not need it: the owner shares their own links. Add discovery only if owners actually ask for it.

---

## PROBLEM 8 — Invite links  ✅ BUILT (uncommitted)

Each person gets a permanent, unguessable link. No signup. Every conversation is attributed to them.

| Piece | Where |
|---|---|
| Tokens, hashing, device binding, expiry | `backend/app/contacts.py` |
| `ContactRecord`, `ContactSessionRecord` | `backend/app/models/db_models.py` |
| Owner management + public `/open` | `backend/app/api/contact_routes.py` |
| Contact identity type | `backend/app/identity.py` |
| Link page + simple call screen | `frontend/app/t/[token]/` |
| Owner UI | `frontend/app/links/` |

**Security posture.** A link is a bearer credential — whoever holds it is that person, and that cannot be designed away. What limits the damage: only the hash is stored; the first device to open a link claims it and later devices are refused; instant revoke and rotate; optional out-of-band PIN; per-day session caps; and a session log showing IP and device so a spread link is visible.

**Caught while building:** `resolve_identity` accepted any validly-signed cookie as owner. Contact cookies use the same signing key, so an invite link would have carried full owner rights including document deletion. The payload's `kind` is now checked, and all four mutating document routes are guarded.

**Bugs found in testing, all fixed:** a column named `mode` collides with PostgreSQL's `mode()` ordered-set aggregate (renamed to `access_mode`); `set_cookie` received `key` both positionally and via `cookie_params()`, 500-ing every link open; action buttons had no busy state, so slow requests looked dead and got clicked repeatedly.

**Still open:** the PIN screen appears on any 401 rather than only when a PIN is required; no duplicate-name warning; voice ignores per-document selection when RAG is on.

---

## PROBLEM 9 — Three audiences, three surfaces

This is the working spec for the Personal/Business split. Read it before touching `contact_routes.py`, `identity.py`, or anything under `frontend/app/links` and `frontend/app/t`.

### The three people

| | Who they are | What they came to do | How they are identified |
|---|---|---|---|
| **Personal user** | Someone with their own API keys | Ask questions about *their own* documents | Their own tenant, derived from their keys |
| **Business owner** | Someone with their own API keys | Configure an assistant *other people* will call, and read what those people asked | Their own tenant, derived from their keys |
| **Caller** | Someone handed a link. No account, ever | Talk to one specific owner's assistant | An invite token → a signed cookie carrying `contact:<id>:<owner_tenant>` |

The first two are the same person entering by the same door; the mode question decides which product they get. The caller is a different species entirely — they never see a library, a setting, or another owner.

### The mode question

On first arrival with keys, ask once: **Personal or Business?** Store it on the owner record. It is changeable later but not asked again.

- **Personal** → today's app, unchanged. Documents, chat, voice. Nothing in this section applies.
- **Business** → the setup flow below. The document library UI is *not* shown; documents exist only as the agent's knowledge.

### Screens

**Business owner**

1. `/setup` — first run only. Business **name** and **category** (both required: this is how we learn what people actually build), then straight into the agent editor.
2. `/agent` — the single agent. **One agent per owner** — no list, no picker, no "create new". Fields: script/prompt, voice (with preview), up to **3** small documents, RAG on/off for voice. A **Test** panel runs the configured agent in both voice and chat against the owner's own config, before any link exists.
3. `/links` — create, copy, revoke, rotate, delete links. Already built.
4. `/links` → History → Transcript — who called, when, from what device, and what was said. Already built.

**Caller**

`/t/<token>` and nothing else. Opens the call screen: orb, status, timer, mute, end. Already built. They never reach `/`, `/links`, or `/agent`; a contact identity is rejected by every one of those.

**Personal user**

`/` exactly as it is now.

### Data model

```
Owner (tenant_id)                     ← derived from their own API keys
  ├── mode: "personal" | "business"
  ├── business_name, business_category  (business only)
  ├── Agent (one, business only)
  │     ├── script / prompt
  │     ├── voice id
  │     ├── rag_enabled_for_voice
  │     └── documents (max 3, small)
  └── Contacts (many)                 ← ContactRecord.owner_tenant_id  [EXISTS]
        └── ContactSessions (many)    ← one per visit  [EXISTS]
              └── conversation_id     → messages = the transcript  [EXISTS]
```

`Owner` and `Agent` are the only new tables. Everything below `Contacts` is built.

### Isolation rules — the part that must not be got wrong

1. Every contact query is scoped by `identity.tenant_id`. Never by a constant. `OWNER_TENANT_ID` no longer appears in `contact_routes.py` and must not return.
2. A caller's owner tenant travels **inside the signed cookie** (`contact:<id>:<owner_tenant>`), so resolving identity needs no database round trip and the value cannot be edited to reach another owner.
3. `_require_owner` rejects **contacts**, not "anyone who isn't the single owner". Any owner manages their own links; a caller manages nothing.
4. Contacts may read the agent's documents. They may never upload, edit, or delete — enforced by `can_manage_documents` on all four mutating routes.
5. Each owner spends their own API keys. One owner must never be able to consume another's quota.

### Order of work

| # | Step | Status |
|---|---|---|
| 1 | Un-hardcode the owner in contact routes; carry owner tenant in the contact cookie | ✅ DONE — 139 tests |
| 2 | `Owner` table: mode, business name, category. Mode question on first arrival | next |
| 3 | `Agent` table + `/agent` editor. Enforce one agent and the 3-document cap | |
| 4 | Business mode hides the document library and shows the agent editor instead | |
| 5 | Test-your-agent panel (voice + chat against the owner's own config) | |
| 6 | Per-owner quota accounting | |

### Responsive

Every screen listed above must work at 375px. The pattern already used in `chat.css`: stack forms vertically below 640px, make buttons full width, let action rows wrap, and never let a fixed-width child widen the page. Test at 375px before calling any screen done.

### Deliberately not building

A public directory of owners. Callers reach an assistant because an owner sent them a link — not by browsing strangers. A directory is a different product with abuse and moderation problems this app has no answer for. Revisit only if owners ask for it.

---

## PROBLEM 10 — Business mode, full specification

Supersedes the sketch in Problem 9 for business mode. Build in the order given; each step is usable on its own.

### The owner's journey

```
/setup      business name + agent name, category
   ↓
/agent      build: prompt, voice, model, keys, documents, RAG-for-voice
   ↓
/agent      test in chat AND voice, against the unsaved draft
   ↓
Deploy      the agent goes live; only then do links work
   ↓
/links      share links, see who called, read transcripts, block or delete
   ↓
/dashboard  totals, recent activity, what people ask most
```

Editing after deploy is expected and must never require re-deploying from scratch: change the prompt, swap the voice, switch the model, rotate a key — all in place.

### Screens and what each contains

**`/setup`** — asked once
- Business name, **agent name** (what the assistant calls itself), category

**`/agent`** — the build surface
- **Prompt** — full, unconstrained. The owner's main lever.
- **Voice** — all voices, grouped male/female, each previewable before choosing.
- **Model settings** — which LLM, plus keys: Sarvam, and any custom OpenAI-compatible model. Keys are editable and rotatable here, never shown back in full once saved.
- **Documents** — optional. Up to 3, small. An agent with no documents is valid and common.
- **RAG for voice** — on/off. **Chat always retrieves**; only voice is toggleable, because a spoken answer pays retrieval latency on every turn while chat can absorb it behind a streaming cursor.
- **Test** — run the *draft* config in both chat and voice, before deploying. Nobody should hand out a link to something they have not heard.
- **Deploy** — flips the agent live. Links do nothing until this happens.

**`/links`** — the people
- Create, copy, rotate, revoke, delete — built.
- **Block** — distinct from revoke: a blocked person keeps their link but is refused, and the owner keeps their history. Revoke kills the link; block kills the person's access.
- Per caller: when they called, from what device, and the full transcript of chat or voice.
- **Search, filter, and pagination** — a business with two hundred callers cannot scroll.

**`/dashboard`** — the overview
- Total calls and chats, unique callers, activity over time.
- Recent conversations, newest first.
- **Most-asked questions** — the highest-value thing here: it tells an owner what to put in their documents next.

### New model concepts

| Concept | Why |
|---|---|
| `AgentRecord.status` — `draft` \| `deployed` | A link must not connect to a half-written prompt. Deploy is the gate. |
| `AgentRecord.name` | The assistant's own name, distinct from the business name. |
| `ContactRecord.blocked_at` | Block ≠ revoke. Revoke invalidates the link; block refuses the person while keeping their history. |
| Per-owner model + keys | Each owner spends their own quota; keys live with the workspace, not in `.env`. |

### Order

| # | Step | Status |
|---|---|---|
| 1 | Un-hardcode owner; carry owner tenant in contact cookie | ✅ DONE |
| 2 | `Owner`/`Agent` tables, service + routes, 155 tests | ✅ DONE |
| 3 | `/setup` and `/agent` screens | ✅ DONE (first pass) |
| 4 | Agent name, deploy gate, block | ← next |
| 5 | Business mode redirects to `/setup`, hides the personal library | |
| 6 | Documents on the agent screen, 3-doc cap enforced in UI | |
| 7 | Test panel: chat + voice against the draft | |
| 8 | Model settings + key rotation per owner | |
| 9 | Search, filter, pagination on `/links` | |
| 10 | `/dashboard` | |

### Rules that must not be broken

- Chat always retrieves. Only voice's RAG is toggleable.
- A caller can talk to a **deployed** agent only. Draft agents refuse connections.
- A blocked caller is refused at `/contacts/open`, before a session is minted.
- Keys are write-only from the UI: saved, never returned in full.
- Every list an owner sees is scoped by `identity.tenant_id`. No constants.
