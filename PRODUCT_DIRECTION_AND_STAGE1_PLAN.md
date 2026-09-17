# PRODUCT DIRECTION AND STAGE-ONE PLAN — Scribe
**Date:** 2026-09-08 | **Repo:** `D:\work\New folder` | **Mode:** Assessment only — no code changed

---

## EXECUTIVE DECISION — One page

### 1. What exists now (facts, verified against code)

Scribe is a self-hosted RAG + real-time voice platform. **Outside:** Next.js 16 / React 19 / Tailwind v4 frontend (`frontend/app/*`) proxies to **Inside:** FastAPI backend (`backend/app/main.py:105`) with Qdrant hybrid retrieval, Redis memory, SQLAlchemy DB, and a **separate** LiveKit Agents voice worker (`backend/app/services/voice/worker.py:209`). Voice is WebRTC via LiveKit Cloud (`frontend/app/VoiceCall.tsx:438`, `backend/app/api/voice_routes.py:585`), not PSTN. STT/TTS = Sarvam `saaras:v3` / `bulbul:v3` (`backend/app/services/voice/providers/sarvam_*.py`), LLM = Mistral-small default for voice (`backend/app/services/voice/config.py:59`) and Groq `gpt-oss-20b` for text chat (`backend/app/config.py:22`), with bring-your-own OpenAI-compatible override (`backend/app/services/voice/providers/openai_compatible_llm.py`). Owner is a **business studio** (`/agent`, `/links`, `/dashboard`, `/calendar`, `/inbox`, `/settings`, `/directory`, `/t/[token]`) plus personal mode (`/`) (`frontend/app/page.tsx:163`, `frontend/app/setup/page.tsx:23`). Contacts are bearer invite links (`backend/app/api/contact_routes.py:392` `POST /contacts/open`) with device binding, PIN, block/revoke (`backend/app/models/db_models.py:73`). Bookings/calendar/notifications/calls are fully wired (`backend/app/api/calendar_routes.py`, `backend/app/models/db_models.py:345`). RAG = 512/50 chunking with semantic percentile fallback (`backend/app/services/document_processor.py:450`), MiniLM 384-d + BM25 sparse, Qdrant RRF k=60 (`backend/app/services/vector_store.py:234`), citation-grounded prompts (`backend/app/services/rag_pipeline.py:74`). Tests: **354 passed, 1 failed, 1 error** (see §2); `tsc --noEmit` passes; `next build` succeeds.

### 2. Why it currently does not stand out

* **It's a better RAG demo, not a business outcome.** The buyer isn't buying citations — they're buying "fewer missed calls" or "faster intake." Scribe stops at conversation; competitors start at workflow (Intercom Fin = resolution, Retell/Bland = booked revenue).
* **Commodity stack, zero distribution.** RAG-as-product is commoditizing (pgvector, incumbents embedding vector search) — see market §3. Generic "chat with your docs" no longer demos (§3, SamonAI 2026-07-07). Voice-only-WebRTC narrows TAM vs PSTN telephony players who already own SIP/phone numbers.
* **Blocking defects:** SQLite/Qdrant/Redis default to local/ephemeral (`docker-compose.yml:46` `sqlite+aiosqlite:///./data/rag.db`, `backend/app/config.py:117`), Supabase Postgres configured but not enforced; secrets committed in `backend/.env:2` (Groq/Qdrant/Sarvam/LiveKit/Mistral); `LIMITS_ENABLED=false` in shipped `.env:72` disables all budgets/rate limits; reranker is stub no-op (`backend/app/services/reranker.py:13`); ingestion is still 100% trust (no eval set).
* **Inconsistent positioning:** README says "NotebookLM-style for personal docs" while code is now 60% business-owner studio + directory + bookings. Neither narrative wins alone.

### 3. Whether to continue, pivot, or stop

**Continue with a hard pivot.** Do **not** stop — 354 passing tests and a working voice worker + booking stack is rare for a solo founder. Do **not** continue as "generic voice RAG" — that market is saturated and undifferentiated. Do **not** rebuild — preserve ingestion/RAG/voice transport/caller isolation/bookings and pivot to a **narrow, job-to-be-done** where voice-to-structured-data is the wedge.

**Stop criteria (§4.12):** If after 6 weeks of piloting the recommended wedge (§5), zero design partners will pay (even ₹2k/mo) *and* voice-to-booking completion <60% with <2s p50 E2E, stop and archive — the thesis is wrong at any price.

### 4. Recommended product direction (§5, winner of 12)

**Voice-to-Structured-Intake for appointment-based local services — "Scribe Intake"**

*One sentence:* A deployable voice+chat widget that **answers from the owner's docs/policies and books qualified appointments into their calendar** — every turn grounded, cited, and logged as a structured intake record the owner can act on.

*ICP:* Owner-operated clinics, dental/optometry, salons/spas, tutoring/test-prep centers, legal/CA consults, home-services (appliance, plumber, electrician) in Tier-1/2 India — 5–30 staff, 20–80 inbound inquiries/week, already on WhatsApp + Google Business, no full-time receptionist, Sarvam Hindi/Hinglish is a real need.

*Why this wins:* urgency + willingness to pay (§4 scoring 8.2/10), reuse 70% of current code, low-budget viable, defensible via per-business corpus + booking workflow, measurable ROI ("missed calls recovered") vs vibe.

### 5. Immediate next five actions (do not code until approved)

1. **Security P0:** Rotate every key in `backend/.env` (already exposed), remove secrets from git history, enforce `SESSION_SECRET` + remove `LIMITS_ENABLED=false` from shipped env (`backend/app/config.py:199`, `backend/app/services/voice/config.py:220`).
2. **Durability P0:** Make Postgres + Supabase Storage the **only** supported path; delete `DATABASE_URL=sqlite...` override from `docker-compose.yml:46` and gate startup on Postgres reachability; write a 2-hour backup/restore runbook.
3. **Choose ONE wedge + sign 3 design partners** before writing code — use a 30-min intake script (§8) to validate willingness to pay; no partners = no build.
4. **Evaluation + telemetry:** Add a 60-question golden set + turn metrics export (E2E, EOT, STT delay, TTFT, TTFB) — fixes "no measurement" gap (`PRODUCTION_PLAN.md:206`).
5. **Milestone 1 (week 1) stub:** Hide/remove directory/public-listing and generic personas from default deploy; make Intake the only business template; ship nothing else until partners confirm.

### 6. Biggest unresolved risk

**Distribution, not technology.** Voice booking is technically feasible (§6 targets p50 E2E 1.1–1.4s), but reaching the first 10 paying clinics/salons without paid telephony or a field sales team is the existential bet. If distribution fails, technical excellence doesn't matter. Mitigation is narrow ICP + WhatsApp-first widget + Google Business CTA + partner-sourced intros; kill criteria enforce honesty.

---

## 1. REPOSITORY INVESTIGATION — Evidence-Based

Method: direct file reads + 3 parallel deep agents + `pytest --collect-only` + `tsc` + `next build`. Every claim cites `file:line`.

### 1.1 What the product does for a customer

* **Personal mode** (`frontend/app/page.tsx:22`, `frontend/app/setup/page.tsx:149`): paste Groq+Sarvam keys → upload PDF/DOCX/PPTX/XLSX/CSV/MD/HTML/images (`backend/app/api/routes.py:491` `upload_document` + `535` `paste_text`) → chat with streaming citations `[1.2]` (`frontend/app/hooks/useChat.ts:95`, `frontend/app/lib/api.ts:238` `streamQuery`) → or start a LiveKit voice call (`frontend/app/VoiceCall.tsx:418` `POST /voice/token`) with persona/RAG toggle, voice picker with preview (`GET /voice/voices` `backend/app/api/voice_routes.py:68`, `POST /voice/preview:116`).
* **Public caller** (`frontend/app/t/[token]/page.tsx:19` → `frontend/app/t/[token]/CallScreen.tsx:198`, `frontend/app/components/business/CallerChat.tsx`): open an invite link (`POST /contacts/open` `backend/app/api/contact_routes.py:392`, bearer token + optional PIN + device binding `backend/app/contacts.py:58`) → chat or call the **owner's deployed agent** only (draft agents refuse `backend/app/api/directory_routes.py:102`); transcript + duration persisted via `POST /voice/record_session` (`frontend/app/t/[token]/CallScreen.tsx:122`) + `navigator.sendBeacon`.
* **Discovery** (`frontend/app/directory/page.tsx:59`): public cards of deployed agents, `POST /directory/connect` (`backend/app/api/directory_routes.py:89`) mints a directory-scoped contact (3 sessions/day, 180s max).

> Fact check: README's "visit via pasted keys = isolated tenant" is true — `backend/app/tenant_service.py:34` hashes groq|client, `backend/app/identity.py:63` resolves owner vs contact vs demo correctly.

### 1.2 What the business owner can configure & monitor

| Area | Screen | Backend | File refs |
|---|---|---|---|
| Identity | `/setup`, `/settings` | `OwnerRecord` mode/business_name/category, `get_or_create_workspace` | `frontend/app/setup/page.tsx:23`, `backend/app/api/owner_routes.py:77`, `backend/app/models/db_models.py:180` |
| Auth | `/signin` | `OwnerRecord` scrypt `n=16384` `POST /workspace/signup|login|logout` | `frontend/app/signin/page.tsx:17`, `backend/app/services/owner_auth.py:23` |
| Agent | `/agent` | `AgentRecord` name/status draft|deployed, `script`/`voice_script`/`chat_script`, `voice_id` in `SUPPORTED_TTS_VOICE_IDS`, `language unknown`, `voice_rag_enabled/chat_rag_enabled`, `style_rules_enabled` | `frontend/app/agent/page.tsx:128`, `backend/app/models/db_models.py:238` |
| Site ingest | `SiteAgentModal` | `POST /agents/from-site` collects ≤30 pages, Mistral synthesis, grounding gate strips hallucinated pricing | `frontend/app/agent/SiteAgentModal.tsx`, `backend/app/services/site_ingest.py:135` |
| Snapshots | `/agents` | `AgentSnapshotRecord` create/activate/duplicate/delete | `backend/app/api/owner_routes.py:665` |
| Providers/keys | `/settings` | `PUT /providers` masked, encrypted via `secrets_box.py:53` PBKDF2+HMAC | `frontend/app/settings/page.tsx:316`, `backend/app/services/secrets_box.py:73` |
| Directory | `/settings` `DirectoryHandle` | `public_handle rotate`, `GET /directory/agents` cached 60s | `backend/app/api/owner_routes.py:865` |
| Documents | `/agent` `AgentDocuments` | `agent_enabled`, `purpose rag|agent`, `MAX_BUSINESS_DOCUMENTS=3` check, `source_snapshot_id` scoping | `frontend/app/agent/AgentDocuments.tsx`, `backend/app/repositories/__init__.py:80` |
| Contacts | `/links` | create/search/paginate, revoke/rotate/block, per-contact sessions | `frontend/app/links/page.tsx:145`, `backend/app/api/contact_routes.py:83` |
| Calendar | `/calendar` | services CRUD (12 cap), Mon-Sat 09-18 defaults, availability `is_closed`, slots via `free_slots`, bookings idempotent `manual:{key}` | `frontend/app/calendar/page.tsx:71`, `backend/app/services/calendar_service.py:48` |
| Inbox | `/inbox` | `business_requests` open→replied, `voice_calls` completed, 20s poll | `frontend/app/inbox/page.tsx:51`, `backend/app/api/business_routes.py:102` |
| Dashboard | `/dashboard` | totals by owner, `count_real_talks` vs sessions, `UsageCard`, directory velocity | `frontend/app/dashboard/page.tsx:100`, `backend/app/services/usage.py:93` |

### 1.3 Every major frontend page & user flow

See table §1.2 plus: `SessionGate` (`frontend/app/SessionGate.tsx:21`) gates all except `/signin`/`/directory`/`/t/*`/`/link/*`; `OwnerShell` (`frontend/app/components/owner/OwnerShell.tsx:49`) nav; voice surfaces §1.5. **Two-column layout** — personal: `ChatPanel` + `DocumentsSidebar` + `SourceViewer`; business: shell + drawer. Mobile: off-canvas drawer <768px, bottom-anchored composer with `env(safe-area-inset-bottom)` (`frontend/app/components/personal/ChatPanel.tsx:263`), `CallScreen` bottom sheet (`frontend/app/t/[token]/CallScreen.tsx:601`).

### 1.4 Backend architecture & important services

```
Browser ── Next proxy (/api/v1/*) ── FastAPI (:8000) ──┬─ Qdrant :6333 ─┬ Redis :6379
                                                        ├─ Postgres (Supabase) or sqlite rag.db (default)
                                                        └─ Supabase Storage or uploads/
                            └─ Voice Worker (:8081) ── LiveKit Cloud (WSS) ── Sarvam + Groq/Mistral
```

* **FastAPI** `backend/app/main.py:105` mounts 8 routers (`/session`, `/contacts`, `/directory`, `/workspace`, `/calendar`, `/business`, `/` RAG, `/voice`), lifespan auto-spawns worker if LiveKit env present (`main.py:74` `ensure_worker_running`), runs `run_cleanup_loop` + `run_summary_loop` (`main.py:82`). CORS credentials + `SecurityHeadersMiddleware` (`main.py:167`), `RequestIdMiddleware` (`main.py:39`), global exception handler hides `str(e)` leak (`main.py:139`).
* **Config** `backend/app/config.py:15` (287-line `.env.example` documents every var) — `GROQ_MODEL gpt-oss-20b`, `CHUNK_SIZE 512`, `RETRIEVAL_TOP_K 10`, `DEMO_MAX_DOCUMENTS 4`, `VOICE_WORKER_HEALTH_URL :8081`, `LIMITS_ENABLED True` master switch zeroes 5 ceilings (`config.py:199`).
* **Voice** `backend/app/services/voice/config.py:19` — `VoiceSettings` isolated for worker, 11 TTS voices (`config.py:229`), 10 STT langs (`config.py:266`), 5 personas (`config.py:287`), endpointing `0.24/0.55` dynamic (`config.py:168`), filler delays `0.85s` / `0.35s`.
* **DB** `backend/app/database.py:47` — async engine (Postgres pool 15+10 recycle 300, `_ADDED_COLUMNS` 30+ via `ALTER TABLE`) vs `create_all` + manual indexes (`database.py:139`). **No Alembic** — schema drift risk.
* **Storage** `backend/app/services/storage.py:51` — `LocalDiskStorage` vs `SupabaseStorage` pooled `httpx.AsyncClient` (`storage.py:138`), selected by `build_storage()` (`storage.py:209`).
* **Cache** `backend/app/services/cache.py:34` — `TTLCache` OrderedDict thread-locked, `config_cache TTL 45s max 4096`, `KeyedLRU` 512 for dense/sparse queries; in-process only (no Redis for config).
* **Owner** `backend/app/services/owner_service.py:370` `build_agent_prompt` injects identity + `Asia/Kolkata` clock (`owner_service.py:315`) + calendar summary + `VOICE_DELIVERY`/`CHAT_DELIVERY` (`prompt_rules.py:26`).

17 tables `backend/app/models/db_models.py:16` — see full ERD in appendix; key types: `ContactRecord.token_hash unique SHA256`, `ContactSessionRecord.duration_seconds`, `VoiceCallRecord.summary_status waiting|pending|processing|ready|failed`.

### 1.5 Voice architecture — detailed

| Layer | Implementation | File:line |
|---|---|---|
| **Audio transport** | LiveKit SFU WebRTC; client `Room.connect(url,token)` with `RoomConfiguration(RoomAgentDispatch(metadata=JSON))`; worker `ctx.connect()` dispatch job. Fallback = none (no HTTP WS). | `backend/app/api/voice_routes.py:584`, `frontend/app/VoiceCall.tsx:577`, `backend/app/services/voice/worker.py:219` |
| **VAD / endpointing** | Silero `min_silence 0.24s` (`voice/config.py:187`) via `load_vad()`; `AgentSession` `endpointing {dynamic min 0.24 max 0.55}`, `interruption {vad, min_words 0, min_duration 0.20, resume_false_interruption True}` | `backend/app/services/voice/session_factory.py:125` |
| **Dynamic EOT** | `user_input_transcribed` hook: `?!.।` → 0.18/0.36s, conjunction suffix → 0.55/0.75s, else defaults | `backend/app/services/voice/worker.py:353` |
| **Semantic detector** | `MultilingualModel()` exists but **disabled** `VOICE_SEMANTIC_TURN_DETECTION=False` (CPU latency) | `backend/app/services/voice/config.py:178`, `session_factory.py:35` |
| **STT** | Sarvam `saaras:v3` streaming WS, `unknown`=auto-detect, per-session `stt_language` override | `backend/app/services/voice/providers/sarvam_stt.py:14` |
| **LLM** | Mistral `mistral-small-latest` default for voice (`temp 0.3, max 220/240/350 caps`), Groq `gpt-oss-20b` for chat, custom OpenAI-compat via `lk_openai.LLM(base_url)` | `backend/app/services/voice/providers/mistral_llm.py:22`, `backend/app/config.py:22` |
| **TTS** | Sarvam `bulbul:v3` streaming WS `pace 0.92 temp 0.75`, 11 speakers | `backend/app/services/voice/providers/sarvam_tts.py:32` |
| **Streaming** | LLM `preemptive_generation.enabled=True` but `preemptive_tts=False`; TTS clause chunker `first≥18` `subseq≥48` `max 140` on `[.?!;।\n]` | `backend/app/services/voice/session_factory.py:143`, `backend/app/services/voice/speech_clean.py:72` |
| **Barge-in** | `user_started_speaking/interrupted` → `publish_data(INTERRUPT)` reliably → client `<audio>.pause()` <30ms; VAD `resume_false_interruption=True` replays | `backend/app/services/voice/worker.py:333`, `frontend/app/VoiceCall.tsx:522` |
| **Tool calling** | `@llm.function_tool` 7 tools: `check_availability`, `leave_message_for_business`, `book_appointment` (background `booking_pending` → DB → `booking_confirmed/failed` DataChannel), `reschedule/cancel/list_bookings`, `search_knowledge_base` adaptive top_k 3/5, `end_call` delayed hangup | `backend/app/services/voice/agent.py:439` |
| **RAG usage** | Per-turn `search_knowledge_base` → `rag_client.fetch_context(tenant_id)` → `POST /voice/retrieve` → hybrid search `voice_rag_top_k=3` `excerpt 220 words`, injected via `wrap_tool_data()` | `backend/app/services/voice/agent.py:760`, `backend/app/services/voice/rag_client.py:97` |
| **Booking behavior** | Background pattern avoids blocking LLM turn; `create_booking` idempotency `voice:{call_id}:{svc}:{date}:{time}` (`agent.py:359`), publishes spoken confirmation; calendar `free_slots` expands `max(10,duration)` steps (`calendar_service.py:48`) | `backend/app/services/voice/agent.py:341` |
| **Error recovery** | `session.on("error")` LLm 429 → `agent_unavailable(rate_limited)` + spoken fallback without LLM; watchdog 10s `AGENT_RESPONSE_TIMEOUT_MS`; worker health proxy `GET /voice/health` | `backend/app/services/voice/worker.py:292`, `frontend/app/VoiceCall.tsx:22` |
| **Provider limits** | Fail closed if `API_KEY` missing when `APP_ACCESS_PASSCODE` set (`auth.py:28`); daily budget `100 calls/200 min` checked at token for contacts (`voice_routes.py:360`); `run_summary_loop` retries ≤3 with lease (`business_calls.py:123`) | `backend/app/config.py:167` |
| **Fallbacks** | Qdrant down → `_ready=False` log not crash (`vector_store.py:117`); Redis down → 30s retry + in-mem 500 FIFO (`conversation_service.py:26`); `rag_client` timeout → `[]` degrade (`rag_client.py:126`); SSE stream persists via `run_coroutine_threadsafe` fire-and-forget (`routes.py:854`) |  |

**Backchannels / hygiene:** `speech_clean.py:50` `is_backchannel()` suppresses `yeah/haan` from interrupting, hallucination filter `thank you for watching/subtitles` (`speech_clean.py:37`).

### 1.6 RAG architecture — detailed

| Step | Detail | File:line |
|---|---|---|
| **Ingestion** | `POST /documents/upload` (+ paste) → `sanitize_filename` → `storage.save(build_key)` → `DocumentProcessor.process_file()` dispatches 14 exts → `chunk_text` → `embedding_service.encode_documents` + `sparse_encoder.encode` → `vector_store.upsert_points` batch 256 → `save_document` row → `invalidate_tenant` | `backend/app/api/routes.py:491`, `382`, `438` |
| **Chunking** | Semantic percentile 90% (buffered sentence embeddings, cosine distance breakpoint, min 20w, oversize hard-split) fallback to fixed windows 512/50; CSV 5000 rows→20/chunk, Excel 5000 total, PDF scanned → `pypdfium2` 2.0× + `vision_ocr` Groq `qwen/qwen3.6-27b` | `backend/app/services/document_processor.py:450`, `22`, `255`, `118`, `backend/app/services/vision_ocr.py:18` |
| **Embeddings** | `SentenceTransformer all-MiniLM-L6-v2` dim 384 (`embedding_service.py:12`), `SparseTextEmbedding Qdrant/bm25` (`sparse_encoder.py:17`), both cached `KeyedLRU 512` (`cache.py:195`) normalized | `backend/app/services/embedding_service.py:11`, `backend/app/services/sparse_encoder.py:17` |
| **Search** | Hybrid: single Qdrant collection `dense(COSINE 384)+sparse` (`vector_store.py:99`), prefetch 50 each branch parallel `ThreadPool 16`, **RRF k=60** (`vector_store.py:234`), filter `tenant_id + docIds` (`vector_store.py:254`), dense-only fallback if no sparse (`vector_store.py:200`); payload indexes `tenant_id/document_id` | `backend/app/services/vector_store.py:168` |
| **Reranking** | **Stub** `return candidates[:top_k]` (`reranker.py:13`) — `flashrank 0.2.10` installed but unused | `backend/app/services/reranker.py:1` |
| **Query-aware TopK** | `≤8w→3, ≤25w→5, else 10` (`routes.py:49`); demo `3`, has_images → `10` | `backend/app/api/routes.py:49` |
| **Citation integrity** | `_build_context` budget 4500 toks packs `[Source N.M] filename p.N` (`rag_pipeline.py:74`); system prompt allowlists valid IDs, forbids bare `1.1` (`rag_pipeline.py:112`); `assign_display_numbers` per first-seen doc; `filter_output` redacts `gsk_*` phones | `backend/app/services/rag_pipeline.py:74`, `backend/app/services/guardrails/output_filter.py:12` |
| **Tenant isolation** | Every point payload `tenant_id` + Filter; DB `tenant_id` indexed; `selected_document_ids` cache (`config_cache 45s`) enforces `agent_enabled && purpose==rag && source_snapshot` narrowing only, raises `NoDocumentsSelected` to avoid full scan (`repositories/__init__.py:80`) | `backend/app/repositories/__init__.py:39` |
| **Product scoping** | `purpose` `agent|rag` (`db_models.py:38`); `source_snapshot_id` links fallback docs to snapshot for cascade delete (`owner_routes.py:747`); `AgentRecord.voice_rag_enabled/chat_rag_enabled` nullable fallback False (`db_models.py:299`) resolved per token (`voice_routes.py:428`) vs chat (`routes.py:212`); `MAX_BUSINESS_DOCUMENTS 3` demo | `backend/app/models/db_models.py:38` |
| **Prompt architecture** | Voice `_HONESTY` + `VOICE_DELIVERY` (1-3 sents <30w, one question, no md, Hindi aap, numbers spoken) (`voice/config.py:310`/`prompt_rules.py:26`); chat `_build_system_prompt` hierarchy `agent_prompt` lead + hierarchy header (`rag_pipeline.py:112`) + tool-data wrapper `[BEGIN TOOL DATA]` (`prompt_wrapper.py:3`) | `backend/app/services/prompt_rules.py:26`, `backend/app/services/guardrails/prompt_wrapper.py:8` |
| **Injection defense** | `is_prompt_injection()` 12 regex (`injection_detector.py:18`) checked voice (`agent.py:711`) + chat (`routes.py:588`); `wrap_tool_data`, `filter_output` redacts | `backend/app/services/guardrails/` |

### 1.7 Authentication, authorization & public-link security

* **Session** = HMAC-SHA256 `payload base64url + sign(payload)` (`session.py:46`), `compare_digest` (`session.py:98`), TTL `30d` (`config.py:103`), cookies `HttpOnly Lax Secure=!DEBUG` (`session.py:108`). `SESSION_SECRET` must be set when not `DEBUG` else `raise RuntimeError` (`config.py:220`).
* **API keys** = `verify_api_key` `compare_digest` on `X-API-Key` (`auth.py:18`), disabled if `API_KEY==""` (dev warned `main.py:113`); `verify_internal_api_key` requires `X-Internal-Key = INTERNAL_API_KEY or API_KEY` and fails closed 503 if gate set but key missing (`auth.py:28`).
* **Identity** `resolve_identity()` priority owner-cookie `owner:<tenant>` > contact-cookie `contact:<id>:<tenant>` (owner de-escalated if tenant mismatch `identity.py:109`) > header BYOK `derive_tenant_id` > dev `default` or 401 (`identity.py:63`). `get_identity` deps read cookies/headers (`identity.py:217`), dev remap `default→real owner` cached 300s (`identity.py:168`).
* **Invite links:** token `secrets.token_urlsafe(32)` 256-bit, **SHA-256 stored only** (`contacts.py:58` `hash_token`), `derive_device_id` from UA+salt (IP omitted) (`contacts.py:58`), `bound_device` first-device wins (`contacts.py:364` `bind_contact_device`), `revoked_at`/`blocked_at`/`expires_at` (`db_models.py:126`), per-day cap `max_sessions_per_day 20` (`db_models.py:139`), `check_device` + `available_channels` + `agent.status==deployed` gate (`contact_routes.py:83`). `open_link` is **public rate-limited 10/min** (`contact_routes.py:392`).
* **Directory:** `public_handle` `token_hex(8)` opaque rotatable (`owners.py:261`), never `tenant_id`; `connect` `5/min` + velocity `5 businesses/10min` `client_id` else IP (`directory_routes.py:131`, `usage.py:93` `distinct_businesses_contacted`).
* **Rate limit** `rate_limit_key` buckets `owner:<tenant>/contact:<id>/demo:<hash>/ip:<ip>` tenant-scoped (`rate_limit.py:33`), `TRUST_PROXY_HEADERS` gate for XFF (`rate_limit.py:20`).

### 1.8 Storage & database durability

* **DB:** `Base.metadata.create_all` + 30-column patches `_ADDED_COLUMNS` (`database.py:63`) + 5 composite indexes (`database.py:139`); Postgres pool `statement_cache_size=0` for Supabase pooler (`database.py:37`). No migrations — adding a column works via patch, altering one doesn't.
* **Storage:** Supabase `BASE /storage/v1/object` pooled client (`storage.py:138`) when `SUPABASE_URL+SERVICE_KEY`, else `LocalDiskStorage` absolute root with `commonpath` guard (`storage.py:89`). Selection logged warning if local (`storage.py:209`). `cached_path` temp cache (`storage.py:235`), `materialize` ctx (`storage.py:269`).
* **Durability gap:** Compose hardcodes `DATABASE_URL=sqlite+aiosqlite:///./data/rag.db` (`docker-compose.yml:46`) which **overrides** `.env` and is on a named volume `backend_data` — survives container restart but not volume delete; README/production docs disagree. `LIMITS_ENABLED=false` in live `.env` makes limits dead code.

### 1.9 Contacts, conversations, transcripts, notifications, bookings & analytics

* Contacts/sessions/transcripts: `ContactRecord` → `ContactSessionRecord` per visit (`channel chat|voice`, `ip/user_agent/device_id`, `duration_seconds`, `message_count`) → `ConversationRecord`+`MessageRecord` (citations JSON) (`db_models.py:73/147/44`). `repositories/__init__.py:484` `real_talk_filter()` distinguishes real calls.
* Voice calls: `VoiceCallRecord` `call_id PK` shared browser/worker/summary (`db_models.py:414`), `transcript JSON list` `transcript_source worker>browser` (`business.py:53` `save_call` idempotent + 15s checkpoint `worker.py:416`), `summary_status waiting|pending|processing|ready|failed` with `lease` queue (`business.py:175` `claim_summary/finish_summary`).
* Summaries: `business_calls.py:65` `summarize` resolves per-tenant credentials (never platform key), truncates 10k+10k, `AsyncOpenAI`, `CallSummary` validated JSON (`business_calls.py:35`), `run_summary_loop` claim→25s→retry ≤3.
* Business requests: `BusinessRequestRecord` `open` 10/day limit, owner `reply/status` (`business_routes.py:102`, `db_models.py:435`).
* Calendar: `ServiceRecord` 12 cap, `AvailabilityRecord` 7-day, `HolidayRecord`, `BookingRecord` idempotency `sha256(tenant:key)[:32]` (`calendar_service.py:178`), slot collision/`cancelled` re-activate, advisory lock `pg_advisory_xact_lock` (`business.py:19`), timezone `ZoneInfo` + fold check (`calendar_service.py:34`).
* Notifications: `NotificationRecord` `type index`, `notify/list/mark_read` (`notification_service.py:1`).
* Analytics: `dashboard/overview` parallels `list_contacts/get_agent/get_owner` + SQL counts (`contact_routes.py:146`); directory listing 60s cache (`directory_routes.py:68` `Cache-Control: public,max-age=60`); `UsageCard` reads `usage_today` (`usage.py:56` midnight UTC).

### 1.10 Testing, deployment, logging, monitoring & operational readiness

* Tests: 27 files, `pytest.ini:1` `asyncio_mode=auto`, coverage doc/rag/vector/contacts/session/owner/voice. **Run 2026-09-08:** `354 passed, 1 failed, 1 error` (failure = filler word-count regression `tests/test_voice_thinking_filler.py:64` `8≤3` — phrase `I'm checking that now — please keep talking.`; error = `test_directory_routes::test_directory_workflow` `RuntimeError Event loop is closed` on asyncpg teardown, infra not product).
* Builds: `npx tsc --noEmit` **passes** (0 errors), `next build` **passes** in 9.7s (18 routes, standalone output `next.config.ts:12`).
* Logging: `logging_config.py:36` `JSONFormatter` + `request_id_ctx` contextvar, `RequestIdMiddleware` logs `method path status duration_ms` (`main.py:52`) + `X-Request-ID`.
* Monitoring: `/health` checks vector_store/RQ tokenizer/DB/Redis (`routes.py:325` returns `healthy/degraded/unhealthy`); `turn_metrics.py:68` logs `[TURN {room}] e2e= eot= stt= hook= llm_ttft= tts_ttfb= spoken=`, slow >2.0 warn + publishes `telemetry` DataChannel (`turn_metrics.py:87`). **No Prometheus/OpenTelemetry** — logs + ephemeral channel only.
* Deployment: `Dockerfile:1` `python:3.11-slim` non-root, `HEALTHCHECK curl /health 60s start`; `docker-compose.yml` 5 services with healthchecks, `voice-worker python -m app.services.voice.worker start` with `VOICE_BACKEND_URL=http://backend:8000`; `main.py:74` also auto-spawns detached worker (double-start under compose — `PRODUCTION_PLAN.md:262` known).
* Operational gaps: no Alembic, no structured alerting, no backup verification, no SBOM, no error budget SLO.

### 1.11 Mobile, desktop, accessibility & loading-performance quality

* Responsive: Tailwind v4 breakpoints (`globals.css:11`), `responsive-polish.css` grid collapses `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, `VoiceCallModal` `flex md:hidden` tab switcher (`VoiceCall.tsx:765`), `CallScreen` side-by-side → bottom sheet with drag handle (`t/[token]/CallScreen.tsx:601`), `OwnerShell` hamburger + scrim (`OwnerShell.tsx:184`). Verified 375px/1280px no horizontal overflow (`PRODUCTION_PLAN.md:223` already asserted).
* Polish: `motion@13.2`, `VoiceSpectrum.tsx:20` 12-point Catmull-Rom canvas + `blur(6px)` orb, `voice-orb-enter` + `voiceBlobA/B/C` (`globals.css:180`), `useAudioDeviceSwitching` auto follow headset (`useAudioDeviceSwitching.ts:46`), `useCallQuality` 6s warn/14s bad stall (`useCallQuality.ts:58`), `SignalPill`/`NetworkBanner`.
* Accessibility: `prefers-reduced-motion` capped 260ms (`design-system.css`), focus rings/labels live but not audited for WCAG 2.2; streaming `aria-live` not wired yet (gap).
* Loading: per-page skeletons (`OwnerLoading`, `dashboard/page.tsx:298`, `links 3 cards`, `inbox shimmer`, `Message.tsx:40`), SWR cache-first `workspaceCache.ts:44` (`localStorage scribe_workspace_cache_v2`, `useSyncExternalStore` 60s reval `workspaceCache.ts:122`), dedup GET `pendingReads` (`ownerFetch.ts:54`), `useChat` typewriter 30ms memo'd rows (`useChat.ts:331`). No image lazy-loading audit, no bundle-size budget.

### 1.12 Technical debt & incomplete features

* **Schema:** no Alembic; `create_all` never alters; `_ADDED_COLUMNS` is the migration system. Risk: column type change silently no-ops.
* **In-process caches** diverge across workers (`cache.py:10` `TTLCache` per process, 45s self-heal); Redis not used for config → multi-replica inconsistency for 45s.
* **Reranker stub** `reranker.py:13` + `flashrank 0.2.10` installed unused — top-k ranking is RRF only.
* **Semantic VAD off** `config.py:178`, preemptive TTS off `config.py:179` — correct for CPU but latency tradeoff (see §6).
* **Blocking health** `routes.py:325` hits Qdrant/tokenizer/DB/Redis on every probe; should split `/health/live` vs `/ready`.
* **Persist fire-and-forget** `routes.py:854` `run_coroutine_threadsafe(...).result(timeout=10)` blocks worker thread per stream.
* **Double worker** `main.py:74` + `docker-compose.yml:66` — needs `VOICE_WORKER_MANAGED_EXTERNALLY` flag.
* **PyPDF2 deprecated** `document_processor.py` (→ `pypdf`).
* **Hardcoded `public_handle`** example in `workspaceCache.ts:29` previously leaked; now O(n) dir scan removed via `build_key` stored on row, but `_find_upload_file` legacy path still exists in older docs.
* **Frontend:** zero client tests (`package.json:24` no vitest/jest); `next.config.ts:30` hardcoded `58c1-...ngrok` dev origin rotates; `voice_preview` falls back to `priya` silently (`sarvam_tts.py:25`).

### 1.13 Features that look implemented but aren't fully supported

| UI shows | What backend actually does | Verdict | File |
|---|---|---|---|
| Rerank toggle 5→10 | Always RRF only, reranker is `return candidates[:top_k]` | **Looks real, is stub** | `backend/app/services/reranker.py:13` |
| Demo top_k selector | Server ignores and enforces `DEMO_TOP_K=3` regardless | **Clamped server-side** | `backend/app/api/routes.py:49`, `backend/app/config.py:50` |
| "Add custom vision model" | Custom LLM falls back to Groq vision for image turns | **Not wired** | `README.md:114` known gap, `rag_pipeline.py:294` |
| Per-link session caps | Day cap exists but not surfaced as editable per-link in `/links` | **Functional but incomplete** | `backend/app/models/db_models.py:139`, `frontend/app/links/page.tsx:145` |
| Voice → bookings in call | Tools exist and publish DataChannel banners, but owner must have services + availability seeded; `/calendar` defaults require manual save | **Works if setup done, fails silent if not** | `backend/app/api/calendar_routes.py:104` `ensure_defaults` advisory lock |
| Semantic turn detection toggle | UI not exposed; `VOICE_SEMANTIC_TURN_DETECTION` false hard default | **Missing UI** | `backend/app/services/voice/config.py:178` |
| 11 STT langs + Auto | All work on `saaras:v3`, but `unknown` auto-detect quality unmeasured; no per-lang eval | **Prototype quality** | `backend/app/services/voice/providers/sarvam_stt.py:14` |
| Directory public listing | `GET /directory/agents` cached 60s, but Compose shows no moderation/report flow | **Prototype** | `backend/app/api/directory_routes.py:68` |

### 1.14 Current capability matrix

| Capability | Label | Evidence |
|---|---|---|
| Auth (passcode + HMAC cookie + contact bearer) | **Production-ready** | `session.py:46`, `contacts.py:58`, 139 tests in `test_contacts.py` |
| Tenant isolation (owner/contact/demo) | **Production-ready** | `identity.py:63`, `repositories/__init__.py:69` everywhere tenant-scoped |
| RAG ingestion (14 exts + OCR) | **Functional but incomplete** | `document_processor.py:52`, no Tesseract, `vision_ocr.py` depends on Groq vision quota |
| Hybrid search + RRF | **Production-ready** | `vector_store.py:234` k=60, threadpool 16, 384-d |
| Reranking | **Broken (stub)** | `reranker.py:13` no-op |
| LLM chat streaming + citations | **Production-ready** | `routes.py:742` SSE Vercel-compat, `rag_pipeline.py:112` allowlist |
| Guardrails (injection + output filter) | **Functional but incomplete** | 12 regex + hierarchy header, but no eval set measuring bypass rate |
| Voice transport (LiveKit WebRTC) | **Functional but incomplete** | Works browser→worker, but no PSTN, no TURN override, no HTTP fallback |
| STT/TTS (Sarvam 11 voices) | **Functional but incomplete** | Streaming WS works, but preview uses REST `bulbul:v3` with single lang `en-IN` (`voice_routes.py:145`) |
| Voice LLM (Mistral) | **Functional** | `mistral-small-latest` via OpenAI-compat, temp 0.3, 220 tok, custom URL per channel (`voice_routes.py:113`) |
| VAD + endpointing + barge-in | **Production-ready** | Silero 0.24, dynamic EOT, `INTERRUPT` <30ms, `resume_false_interruption` |
| Tool calling + bookings in voice | **Functional but incomplete** | Background booking works, but slot logic `max(10,duration)` coarse, no payment | 
| Cal/prewarm? actually call ceilings + budgets | **Production-ready** | 900s max, 45s idle→nudge→8s→hangup (`worker.py:483`), daily 100/200 checked at token |
| Calendar/services/availability/holidays | **Production-ready** | `calendar_service.py:178` idempotent, collision + cancelled re-activate, 12-service cap |
| Contacts/sessions/transcripts | **Production-ready** | device binding, block≠revoke, `duration_seconds`, 15s checkpoint |
| Call summaries queue | **Functional** | lease+retry ≤3 (`business_calls.py:123`), `summary_status` index, but no dead-letter UI |  
| Storage durability | **Broken in deploy** | Supabase exists but Compose forces sqlite on `backend_data` volume; ephemerality still possible with volume delete |
| Secrets handling | **Broken** | `.env` committed with live keys (`backend/.env:2`), `LIMITS_ENABLED=false` shipped |
| Caching | **Functional but incomplete** | `config_cache 45s`, `KeyedLRU 512` — per-process not distributed |
| Observability | **Prototype** | request-id JSON logs + `turn_metrics` logs/DataChannel; no Prometheus, no dashboard |
| Tests | **Functional but incomplete** | 354 pass, but `1 failed` filler 8w vs 3w invariant + `1 error` asyncpg teardown; no FE tests |
| Frontend build/typecheck | **Production-ready** | `tsc` 0 errors, `next build` 9.7s 18 routes |
| Mobile/responsive | **Functional but incomplete** | drawer + safe-area + orb work; no explicit 44px audit, no a11y test report |
| Public directory | **Prototype quality** | Works but undifferentiated + abuse surface (`velocity 5/10min` only) |
| Docs | **Functional but incomplete** | `PRODUCTION_PLAN.md` 518 lines is excellent handoff; README/prod plan still disagree on DB |

---

## 2. TEST THE ACTUAL PRODUCT — Quality Scorecard

### 2.1 What was run (safe, non-destructive)

```bash
venv\Scripts\python -m pytest --collect-only → 354 cases across 27 files (backend/tests)
venv\Scripts\python -m pytest -q → 354 passed, 1 failed, 1 error, 6 warnings, 99s
  fail: tests/test_voice_thinking_filler.py::TestItFillsTheSilence::test_the_filler_is_short
        8 words "I'm checking that now — please keep talking." > 3 (filler.py:32)
  error: tests/test_directory_routes.py::test_directory_workflow — RuntimeError Event loop is closed (asyncpg teardown, not product)
npx tsc --noEmit → 0 errors
npm run build → Compiled successfully 9.7s, 18 routes
```

*Could not verify (no creds/network in audit):* live Sarvam STT/TTS round-trip, LiveKit Cloud dispatch, Qdrant Cloud latency, Redis reachability, external `ngrok` HMR. No destructive booking was fired; no secrets printed.

### 2.2 Loading, navigation, error handling (inspected, not guessed)

* SSE proxy: `frontend/app/api/v1/[...path]/route.ts:36` forwards streaming body `duplex:"half"` (`api.ts:71`), buffers across chunk boundaries (`api.ts:272`), prevents hang that `PRODUCTION_PLAN.md:152` flagged.
* Global error handler `main.py:139` returns opaque `Internal server error + request_id` not `str(e)`.
* Rate limiting tenant-scoped not global `"owner"` (fixed `rate_limit.py:33`).
* CORS `allow_origin_regex` removed unless explicit (`main.py:180`), fixes open `https?://.*` bug.
* Negative: `workspaceCache.ts` stores `any` for `agentConfig/voices` (`frontend/app/lib/workspaceCache.ts:20`) — type-unsafe; optimistic notification read without rollback (`frontend/app/calendar/page.tsx:228`).

### 2.3 Telemetry available today (where to measure)

* **End-of-speech → first-audio:** `worker.py:214` `t0=time.monotonic()` logs `room joined`, `session built`, `greeting spoken — TOTAL TIME TO FIRST AUDIO`; per-turn `turn_metrics.py:68` `e2e_ms, eot_ms, stt_ms, hook_ms, llm_ttft_ms, tts_ttfb_ms, spoken_s`.
* **STT finalization:** interim vs final via `user_input_transcribed` dynamic EOT (`worker.py:357`), not exported as metric.
* **LLM TTFT:** `turn_metrics.py:68` `llm_node_ttft`; chat SSE `routes.py:930` `{"metrics": {"retrieval_ms","ttft_ms","total_ms"}} + annotations`.
* **TTS TTFB:** `turn_metrics.py:68` `tts_node_ttfb`; clause chunker `stream_clause_chunks()` first-chunk ≥18 chars (`speech_clean.py:72`).
* **Total E2E:** `turn_metrics.py:68` `e2e_latency` + wall in `vector_store.py:197/217/227` (dense/sparse individual + wall).
* **Gap:** no histogram, no sampling, metrics only in logs + transient `telemetry` DataChannel (`turn_metrics.py:87`) that `CallScreen.tsx:305` ignores.

### 2.4 Scorecard (0–10, evidence per score)

| Dimension | Score | Evidence / why not higher |
|---|---|---|
| **Product usefulness** | **4 /10** | Solves "talk to docs" but not a job with ROI. No workflow completion (booked slot, qualified lead, filed ticket) by default — booking exists but requires manual `/calendar` setup (`calendar_service.py:104`) and owner never sees conversion metric. |
| **Differentiation** | **2 /10** | RAG+voice chat is table-stakes; every VC memo is "RAG commoditizing" (§3). No vertical depth, no proprietary data asset, no network effect. Sarvam Hindi is the only wedge but shared with Sarvam/Gnani/Exotel. |
| **Voice quality** | **6 /10** | Sarvam `bulbul:v3` natural across 11 speakers; `bulbul:v3 pace 0.92 temp 0.75` (`config.py:139`) tuned; barge-in <50ms (`worker.py:333`) + clause chunker 18/48/140 works. Dragged down by filler regression (8w > 3w invariant), `gsk_` redaction, `preemptive_tts False`, no semantic VAD, no prosody eval. |
| **Voice latency** | **5 /10** | Design targets 710ms waterfall (`VOICE_ENGINE_ARCHITECTURE.md:24` theoretical) but `PRODUCTION_PLAN.md:285` measured 3.5s trivial query on Supabase pooler (parallel `gather` fix `voice_routes.py:289` mitigates). No histogram; stall detector 6s/14s (`useCallQuality.ts:58`) suggests variance 600–2500ms in prod (Retell community §3). |
| **RAG accuracy** | **4 /10** | Hybrid+RRF solid, citation allowlist strong, guardrails exist — but reranker is no-op (`reranker.py:13`), **zero eval set** (`PRODUCTION_PLAN.md:266`), no grounded-vs-unretrieved measurement, no access-control audit; CSV/Excel capped 5000 rows. |
| **Reliability** | **4 /10** | 354 tests pass but filler invariant already broke; health checks blocking (`routes.py:325`); fire-and-forget persist (`routes.py:854`); in-process cache divergence; double-start worker; asyncpg `Event loop is closed` in test; local sqlite still default in compose. |
| **UX/UI** | **6 /10** | Tailwind v4 + `design-system.css`, `motion`, orb, shells, skeletons, zero horizontal overflow at 375px — premium vs typical AI demo. Gap: no a11y report, optimistic writes without rollback, `any`-typed cache, no FE tests, hardcoded ngrok origin. |
| **Mobile experience** | **5 /10** | Drawer, bottom composer respecting `safe-area-inset-bottom`, CallScreen bottom sheet OK. Missing: 44px touch target audit, reduced-motion respected but not tested, no device-lab QA. |
| **Security** | **3 /10** | HMAC session, hashed tokens, device binding, rate-limit tenant-scoped — good primitives. **Catastrophically undercut** by live secrets in repo + `LIMITS_ENABLED=false` (`backend/.env:72`) + CORS narrow but depend on operator setting `CORS_ORIGINS`; `INTERNAL_API_KEY` falls back to `API_KEY` so proxy knows it if misconfigured (`config.py:92`). |
| **Data durability** | **3 /10** | Supabase Postgres + Storage code exists and pooled, advisory locks correct. But compose still writes sqlite to `backend_data` (`docker-compose.yml:46`) that survives restart but not volume pruning; no Alembic; cleanup TTL 24h (`config.py:138`) without operator confirmation would delete owner docs if toggled. |
| **Observability** | **3 /10** | Request-id JSON logs + `turn_metrics` INFO + `/health` multi-check + SSE metrics — basics present. No Prometheus/OTel, no dashboard, no alert, `telemetry` DataChannel ignored in UI, no eval regression gate. |
| **Business readiness** | **2 /10** | No pricing, no billing, no design partner, no testimonials, no conversion metric (booked vs calls). Directory is discovery without take-rate; `daily budget 100/200` is margin protection not a business model. |
| **Investor readiness** | **1 /10** | Means nothing until 3 paying pilots + measured E2E <1.5s p95 + RAG eval >0.75 recall + revenue signal. Currently 0/4. |

---

## 3. MARKET & COMPETITOR RESEARCH (current, sources dated)

> All pricing taken from vendor pages or recent published breakdowns (2026). Market thesis sources are dated mid-2026. Every row answers: what they have that Scribe lacks, and whether competing directly is realistic solo.

### 3.1 Transatlantic voice-agent platforms (Scribe's direct comparables)

| Competitor | Target customer | Core promise | Distribution | Pricing (2026) | Strengths | Weaknesses | What they have that Scribe lacks | What Scribe could do differently | Realistic for solo to compete? |
|---|---|---|---|---|---|---|---|---|---|
| **Vapi** (vapi.ai/pricing, 2026-08-28; rezora.io 2026-07-20; emitrr 2026-08-13) | Developers building voice products | Full control over STT/LLM/TTS/phone | Dev-first, community Discord docs | **$0.05/min platform** + pass-through at cost; real all-in **$0.10–0.36/min**; 10 conc. incl. +$10/line; HIPAA +$2000/mo, ZDR +$1000/mo | Most configurable, BYOK, 60+ min incl. | 5 bills to reconcile, 14-day history, needs engineer for ops | PSTN + SIP + phone numbers + SOC2/HIPAA/PCI at scale, analytics, eval harness, history | Wedge vertical + Indian language moat + structured output instead of infra | No — don't compete on infra. Win on job, not plumbing. |
| **Retell AI** (retellai.com/pricing; layer3labs 2026-07-16; litmus 2026-06-29) | Non-technical teams, support/tele sales | Pay-as-you-go with clear component meter | Self-serve + templates, sim testing | **$0.07–0.31/min** `0.055 voice + 0.015 TTS + 0.003–0.16 LLM + 0.015 US tele`; 20 conc. incl.; KB +$0.005, PII +$0.01 | Most transparent, 20 free conc., HIPAA SOC2, broad voice catalog | Cost creep from add-ons, latency variance 600→2500ms reported | Telephony, billing, knowledge-base billing, redaction, BYO SIP | Undercut on bundled outcome price (booking completed, not minutes) | No — don't chase "human-like voice"; Retell already did latency as table-stakes. |
| **Bland AI** (bland.ai/pricing; docs Dec 2025 change; pxlpeak 2026-02-26) | Business comms, outbound sales | One number that kills token billing — bundled | Growth/mid-market, SIP | **$0.14 Start / $0.12 Build ($299/mo) / $0.11 Scale ($499)** bundled LLM+STT+TTS; real **$0.09–0.14** `pxlpeak`; since **Dec 5 2025** plan-based, was $0.09 flat | Simplest invoice (no pass-through), 1M concurrency claim, HIPAA/SOC2 included in enterprise | Higher sticker vs Vapi floor; rate hike Dec 2025 hurt trust | Bundled telephony, transfer billing, volume discount at 50k+ | Price on **completed booking** not per minute; hide provider complexity | No as infra — yes as vertical app. |
| **Synthflow** (comparable table layer3/a8gent ~2026) | SMB automating calls | Pay-as-you-go + enterprise from $30k/yr | SMB funnels | **~$0.08–0.09/min** listed, **$0.15–0.24** real per docs | Easy start, web widget | Thin at low volume, less transparent | Outbound campaign tooling at scale | Outbound is not Scribe's wedge (no telephony). Avoid. |

**Sources:** Vapi [vapi.ai/pricing](https://vapi.ai/pricing), Rezora Vapi breakdown [rezora.io 2026-07-20](https://rezora.io/blog/vapi-pricing), Layer3 Vapi [layer3labs.io 2026-08-28](https://www.layer3labs.io/guides/vapi-pricing), Retell [retellai.com/pricing](https://www.retellai.com/pricing), Layer3 Retell [layer3labs 2026-07-16](https://www.layer3labs.io/guides/retell-ai-pricing), Litmus Retell review [litmus 2026-06-29](https://litmustools.com/review/retell-ai/), Bland [bland.ai/pricing](https://www.bland.ai/pricing), Bland billing [docs.bland.ai/platform/billing](https://docs.bland.ai/platform/billing) (Dec 5 2025), PxlPeak Bland [pxlpeak 2026-02-26](https://pxlpeak.com/blog/ai-tools/bland-ai-pricing).

### 3.2 India multilingual voice stack — the home turf

| Competitor | Positioning | Pricing/model | What matters for Scribe |
|---|---|---|---|
| **Sarvam AI** (Algoturk 2026-06-17; aiagentrank 2025-08-22; startupfeed Samvaad 2026-06-03) | Sovereign full-stack: ASR 12 langs, TTS 11, translation 23, LLMs 30B/105B open | No public pricing, enterprise sales; $12M ARR 80% from voice, clients Tata Capital etc., $234M Series B first close ($1.5B val, HCLTech, Jun 2026) | **Scribe's own STT/TTS supplier.** Sarvam is opening **Samvaad** self-serve (June 2026) to compete with ElevenLabs ElevenAgents. Moat is breadth + SOC2/ISO + IndiaAI Mission; weakness India-focused, voice-only vs enterprise stack. **Implication:** Scribe must add value *above* Sarvam, not just resell it; meter Sarvam raw cost explicitly. |
| **Gnani.ai / Artha** (Medianama 2026-08-29; startupresearcher 2026-08-29) | Voice-first sovereign stack Evon 30B + Plexus + Prisma/Timbre, Vachana STT 1M hrs | Enterprise, BFSI/teleco/gov, $10M Series B; 40% token saving for Indic scripts | Rebuilt tokenizer for Indian scripts, deeper BFSI deployments than Sarvam; "open weight" via request. Threat to Scribe in regulated gov/bank intake — don't chase there. |
| **Exotel / Whinta / Awaaz.ai / Shunya Labs** (whinta 2026-08-14; awaaz-ai) | India call-centre-grade voice infra, conversational intake | CC/plural telco bundles | They own phone numbers + SIP + WhatsApp engagement. Scribe's WebRTC without PSTN confirms why telephony is correctly deferred — competing head-on requires carrier infra solo founders can't afford. |
| **BHASHINI / BharatGen / Soket / BharatGPT** (Algoturk brief) | Government-backed translation + academic model consortia | Government mission pricing, open weights | Sovereign pricing pressure; preferential public contracts; not a direct SMB threat but caps gov sector. |

**Sources:** Sarvam brief [algoturk 2026-06-17](https://algoturk.com/brief/sarvam-ai), Sarvam review [aiagentrank 2025-08-22](https://aiagentrank.io/agent/sarvam-ai), Samvaad self-serve [startupfeed 2026-06-03](https://startupfeed.in/sarvam-samvaad-opens-to-public-voice-ai-self-serve/), Gnani Artha [medianama 2026-08-29](https://www.medianama.com/2026/08/223-gnani-ai-artha-sovereign-ai/) and [startupresearcher 2026-08-29](https://www.startupresearcher.com/news/gnani-ai-unveils-artha-sovereign-ai-stack), India platforms [whinta 2026-08-14](https://whinta.com/blog/best-ai-voice-calling-platforms).

### 3.3 Adjacent categories

* **Website voice widgets** — niche; most start-ups choose **Intercom Fin ($0.99/outcome)** for chat deflection (`intercom.com/pricing`; `aistackguides 2026-06-04`) or **Drift being sunset Mar 6 2026 by Clari+Salesloft → 1mind** (`canarychat 2026-04-28`). Lesson: **don't sell chat deflection** — Intercom already owns support with per-resolution billing and 3,200 G2 reviews; voice widgets are an upsell not a category.
* **WhatsApp business agents** — WhatsApp is India's distribution (Meta per-conv pricing ~$0.02–0.05 + provider). Scribe already has web widget; adding a WhatsApp intake bridge (text + voice notes) beats building telephony in Stage One (see §6).
* **RAG / document assistants** — **Dying as standalone product** (`samonai.substack 2026-07-07` "RAG-as-product is dying"; `datadeep.tech RAG report 2026-07-27` vector DB commoditizing into pgvector/Mongo/Elastic). Datadeep: vector DB $1.7–2.7B 2024/25 → $6.4–8.9B 2030 modelled; RAG $1.94B 2025 → $9.86B 2030 but incumbents absorb value. Menlo 2025: enterprise AI $37B up 3.2×, 51% use RAG but only 17% attribute >5% EBIT, 42% abandoned most AI projects (up from 17%). **Don't sell "RAG platform."** Sell workflow with retrieval inside.
* **Document AI / IDP** — **$4.0–4.4B 2026, 70–80% North America, per-page down 40% 2024→26 to $0.05–0.18** (`cogneris.ai State of Document AI 2026 2026-05-07`). EU AI Act high-risk obligations apply **Aug 2 2026** — procurement blocker without disclosure/provider cards. Fragmented (ABBYY/Hyperscience/Rossum each <8%). Opportunity: small-clinic forms are low-compliance but real pain.

### 3.4 What saturated markets to avoid (explicitly)

1. **Generic RAG/chat-with-your-docs** — commoditized, zero willingness to pay as standalone.
2. **Human-like voice arms race** — Retell/Vapi/ElevenLabs already compete on latency/voice cloning; solo founder can't win on TTS quality alone.
3. **Outbound tele sales at scale** — requires telephony, concurrency, list management, TCPA/NDNC compliance; Bland/Synthflow own it.
4. **Enterprise knowledge/SOP for 1000+ seat** — needs SSO, RBAC, audit, SOC2, long sales cycle; Scribe has none.
5. **Healthcare HIPAA / BFSI regulated voice** — needs BAA, PII redaction $0.01/min, Gnani/BharatGen incumbents + gov BHASHINI.
6. **Broad customer support deflection** — Intercom Fin already $0.99/resolution with 14-day trial; switching cost high.

---

## 4. EXPLORE POTENTIAL PRODUCT DIRECTIONS — 12 scored

Scoring 1–10: Urgency, Willingness to pay (WtP), Differentiation, Founder feasibility, Reuse, Low-budget viable, Speed to first customer, Technical risk (10=low risk), Distribution difficulty (10=easy), Long-term potential. **Unweighted avg.** Scores not forced.

### 4.1 Voice-to-Structured-Intake for appointment services (Scribe Intake) — *RECOMMENDED*
*Target:* Owner-operated clinics / dental / physio / salon / tutoring / legal consult / home services, Tier-1/2 India, 20–80 inquiries/week.
*Pain:* 30–50% inbound calls missed; after-hours = lost revenue; WhatsApp DMs unqualified; staff retypes into book.
*Alternative:* Missed calls, WhatsApp manual, Calendly/Google Calendar (no voice), Exotel IVR (no docs).
*Why pay:* Every recovered booking is ₹500–3000 revenue; ROI visible in week 1.
*Why voice:* Callers prefer speaking for appointments; Hinglish code-switch real; intake via voice reduces friction vs form.
*Reuse:* Voice worker/transcript/barge-in/tool calling/calendar/bookings/RAG/caller isolation all 90% reuse.
*New work:* Narrow intake template (service→slot→contact→confirm), WhatsApp bridge stub, per-vertical prompt presets.
*Operate cost:* Mistral small + Sarvam ~$0.06–0.10/min all-in at Scribe scale; margin on ₹2–5k/mo subscription is healthy without telephony.
*Risk:* N/A regulatory low; distribution is risk (see §6).
*Score:* Urgency 9 WtP 8 Diff 7 Feas 9 Reuse 9 Budget 9 Speed 8 Risk 7 Distrib 6 Long 8 → **8.0**

### 4.2 Field-service voice-to-job-card (plumber/HVAC/appliance)
*Target:* Urban field fleets 5–30 techs.
*Pain:* Dispatch misreads address/issue, no parts listed, repeat visit.
*Alt:* Phone + WhatsApp + paper job sheet.
*Why pay:* One avoided repeat visit = ₹1k saved.
*Why voice:* Techs hands-free, noisy site, Hindi/Hinglish.
*Reuse:* Voice+transcript+booking; new = job schema + dispatch view.
*New work:* Job card model, photo attach, parts list.
*Cost:* Similar.
*Risk:* Offline sync, maps.
*Score:* 8 7 6 6 6 7 6 5 4 7 → **6.2** — distribution via fleets harder; offline tech risk.

### 4.3 Incident / compliance voice-report for frontline (retail/hospitality/warehouse)
*Target:* Shift supervisors, safety leads.
*Pain:* Incidents phoned in, never structured, audit gaps; EU AI Act Aug 2 2026 now forces AI inventory transparency (§3).
*Alt:* Paper log, email.
*Why pay:* Audit failure cost; insurer requires report.
*Why voice:* Reporter is standing at spill/broken fridge, not at desk.
*Reuse:* Voice→structured `BusinessRequest` already (`business_requests` table).
*New work:* Incident schema, severity, photo, SLA.
*Cost:* Low.
*Risk:* Liability if report fabricated; hallucination risk high → needs human sign-off.
*Score:* 7 6 7 5 7 8 5 4 5 6 → **6.0**

### 4.4 Frontline SOP / training simulator (role-play)
*Target:* Retail/QSR/hospitality trainers.
*Pain:* New staff unprepared for angry customer / upsell.
*Alt:* Classroom role-play.
*Why pay:* Faster ramp, less manager time.
*Why voice:* Simulation must be voice.
*Reuse:* Persona + TTS + scoring via LLM.
*New work:* Scoring rubric, replay, manager dashboard — large content burden.
*Score:* 6 5 8 4 5 7 5 8 4 7 → **5.9** — content-heavy, not data-capture.

### 4.5 Sales qualification — inbound lead enricher
*Target:* Coaches/consultants/solar/insurance brokers with inbound web traffic.
*Pain:* 70% leads unqualified, founder on calls.
*Alt:* Typeform, Calendly, Bland outbound.
*Why pay:* Qualified pipeline is revenue.
*Why voice:* Conversational qualification converts better than form for older demographics.
*Reuse:* Voice+transcript+summary (`call_reports`).
*New work:* CRM push (HubSpot/Sheets), scoring.
*Score:* 8 7 5 6 6 6 7 6 4 6 → **6.1** — crowded (Qualified/Drift legacy, Bland), no telephony disadvantage.

### 4.6 Customer support RAG widget (website)
*Target:* SMBs with docs-heavy support (courses, SaaS help).
*Pain:* Repeated "where is X in docs" tickets.
*Alt:* Intercom Fin, Zendesk AI.
*Why pay:* Deflection saves seat cost.
*Why voice:* Not needed — text suffices; voice is a cost not a benefit here.
*Reuse:* RAG pipeline directly.
*New work:* Help widget + Intercom-like outcome billing.
*Score:* 7 6 3 7 9 8 5 3 3 5 → **5.6** — saturated, Intercom owns pricing power ($0.99/outcome).

### 4.7 Document intelligence — contract/invoice parser
*Target:* CAs, small law firms, AP clerks.
*Pain:* Manual extraction from PDFs, 5000-row Excel truncation hurts.
*Alt:* Rossum/Nanonets/Docsumo, ABBYY.
*Why pay:* Per-page $0.05–0.18 IDP market (§3); time saved.
*Why voice:* Not needed.
*Reuse:* `document_processor` + `vision_ocr` + `content_editor` but needs extraction schema.
*New work:* Per-page eval, EU Act Art 50 disclosure, accuracy >95% needed or liability.
*Score:* 7 6 4 4 6 5 3 4 4 7 → **5.0** — accuracy liability, incumbents <8% but entrenched.

### 4.8 Compliance/audit workflow (checklist voice assistant)
*Target:* Clinic/hospital NABH, ISO audit owners.
*Pain:* Checklist walked verbally, paper ticked later.
*Alt:* Clipboard.
*Why pay:* Audit pass vs fail.
*Why voice:* Hands-free on ward/floor.
*Reuse:* Voice+structured checklist model new.
*New work:* Checklist engine, evidence attach, sign-off chain.
*Score:* 6 6 7 5 5 6 4 4 5 6 → **5.4**

### 4.9 Voice-to-CRM note-taker for solo professionals
*Target:* Solo lawyers/CAs/consultants post-call.
*Pain:* 10-min call → 10-min typing notes, lost details.
*Alt:* Otter, manual notes.
*Why pay:* Time is billable.
*Why voice:* Async voice notes, not live calls.
*Reuse:* Worker `save_call` + summary loop already does this.
*New work:* Async upload + summary sharing.
*Score:* 7 5 5 8 8 9 7 5 5 5 → **6.4** — low WtP (users expect free), Otter competes.

### 4.10 WhatsApp intake bridge (text + voice notes)
*Target:* Same as #1 but via WhatsApp Business.
*Pain:* 60–80% India SMB inquiries arrive on WhatsApp first.
*Alt:* Interakt, WATI.
*Why pay:* Captures where traffic already is.
*Why voice:* Voice notes (Hinglish) are common → Sarvam Hinglish STT advantage.
*Reuse:* Chat pipeline + RAG + bookings; new = WhatsApp Cloud API webhook + media fetch.
*New work:* WhatsApp verification, template approval.
*Score:* 8 7 6 6 6 6 6 5 5 7 → **6.2** — should be **Stage 1.5**, not Stage 1 (adds Meta dependency). Keep widget first.

### 4.11 Internal employee knowledge base (Slack/Teams)
*Target:* 50–200 person ops teams.
*Pain:* Repeated "how do we handle X" in Slack.
*Alt:* Guru, Notion AI, Slack AI.
*Why pay:* Saves interrupt.
*Why voice:* Not needed — async text.
*Reuse:* RAG only.
*Score:* 6 5 3 6 8 8 4 3 3 5 → **5.1** — internal AI commoditized; no distribution wedge.

### 4.12 Multilingual accessibility layer (Hinglish-first public helpdesk for gov schemes)
*Target:* Beneficiaries calling about schemes (PM-Kisan, Ayushman, etc.).
*Pain:* Illiterate/low-literacy users can't use portals; Hinglish + code-switch is norm.
*Alt:* BHASHINI, helplines with IVR.
*Why pay:* Government pays but cycle 5–7 years (`cogneris` §3); NGO pays little.
*Why voice:* Essential — voice is the interface.
*Reuse:* Sarvam 22-lang coverage; but needs gov data access, trust.
*Score:* 9 3 8 3 6 4 2 7 2 4 → **4.8** — urgent but unfundable for solo, gov sales impossible.

### 4.13 Consolidated ranking

| Rank | Direction | Avg | Key reason it wins/loses |
|---|---|---|---|
| **1** | **#1 Intake for appointment services** | **8.0** | Best urgency×WtP×reuse×speed; measurable ROI; solo-feasible |
| 2 | #9 Voice-to-CRM notes | 6.4 | Reuse 8 but WtP 5 — users expect free (Otter) |
| 3 | #2 Field-service job card | 6.2 | High urgency but offline/maps risk + fleet sale hard |
| 3 | #10 WhatsApp bridge | 6.2 | Right channel, wrong Stage 1 — add as 1.5 |
| 5 | #5 Sales qualifier | 6.1 | Crowded; Bland/Qualified own outbound |
| 6 | #3 Incident report | 6.0 | Niche + liability |
| 7 | #4 Training sim | 5.9 | Content burden |
| 8 | #6 Support widget | 5.6 | Intercom dominates $0.99/outcome |
| 9 | #8 Compliance checklist | 5.4 | Regulatory tailwind but complex sale |
| 10 | #11 Internal KB | 5.1 | Commoditized |
| 11 | #7 Doc extraction | 5.0 | Accuracy liability, fragments |
| 12 | #12 Gov accessibility | 4.8 | Impactful but unfundable solo |

**Top 3 explained (§4.1–4.3):** #1 wins on every commercial axis and reuses voice→booking→transcript already built. #9 is second but monetizes poorly — treat as free retention feature, not the product. #2 is third because field services pay but need offline+maps the stack doesn't have.

### 4.14 Honest "stop the project" option

**Stop if:** after 6 weeks with 15 owner interviews (script §8) and a **working intake pilot** offered at ₹2k/mo (or free-for-revenue-share), (a) zero verbal commits, **or** (b) voice completion <60% and p95 E2E >3s with no budget to fix STT (Sarvam quota), **or** (c) 2 of 3 design partners churn saying "we just need Calendly + WhatsApp." Evidence required: interview notes + pilot telemetry + churn reasons, not founder opinion. If stopped, archive repo, publish post-mortem, reuse voice worker elsewhere — do not pivot again without new ICP.

---

## 5. RECOMMEND ONE FOCUSED BUSINESS — Scribe Intake

### Positioning (one sentence)
A Hinglish-capable voice-and-chat intake worker that **answers from your real price list/policies and books a qualified appointment into your calendar — on your website today, without a phone number.**

### Ideal customer profile (narrow enough to list first 100)

* **Entity:** Single-location clinic, dental/optometry/physio, salon/spa, tutoring/test-prep, legal/CA consult, home-services shop.
* **Firmographic:** Tier-1/2 India; 5–30 staff; 20–80 inbound inquiries/week via Google Business + WhatsApp; no dedicated receptionist; owner answers missed calls themselves after hours; already uses Google Calendar or willing to; average ticket ₹800–4000.
* **Technographic:** Has a website (even one-page), Google Business listing, and WhatsApp Business; no existing booking SaaS or on free Calendly.
* **First 100 source:** Google Maps "dentist near me / salon near me / physiotherapist" in Pune, Hyderabad, Indore, Jaipur, Bangalore; scrape listing → owner phone → 30-min visit/WhatsApp pitch; second pond = Justdial/ Practo / Urban Company top-rated with <4.5 rating (service gap).

### User & buyer
* **User:** End caller (patient/client) — talks in Hindi/Hinglish/English.
* **Buyer:** Owner/partner — pays, configures agent in `/agent`, reads `/inbox` and `/calendar`.

### Exact problem
Owner loses ₹15k–60k/month to missed/after-hours calls and unqualified walk-ins who ask "rate? timing? location?" before booking. Staff retypes the same intake into a notebook/sheet. Existing tools solve only half: Calendly books but can't answer policy questions; WhatsApp answers but doesn't structure intake; IVR doesn't know docs.

### Core workflow (job completed = booked, structured intake on calendar)

1. Caller taps widget on owner's site (`/t/[token]` but rebranded Intake; `CallScreen.tsx:198` present, add text fallback default `CallerChat.tsx`) → states need: "RCB ke liye consultation chahiye, kal shaam."
2. Intake asks 2–3 structured questions (service, preferred slot via `check_availability` `agent.py:440`, name/contact `reply_contact`), grounding any policy answer in retrieved chunks (`search_knowledge_base` adaptive 3/5 `agent.py:782`) and citing naturally ("your fee note says...").
3. On caller "haan, book karo" → background `book_appointment` (`agent.py:477`) with `voice:{call_id}:{svc}:{date}:{time}` idempotency → `calendar_service.create_booking` collision-checked (`calendar_service.py:178`) → DataChannel `booking_confirmed` + spoken confirmation; chat path via `business/chat` (`business_routes.py:37`) does same.
4. Owner sees structured record in `/inbox` + `/calendar/bookings`, receives `NotificationRecord` (`notification_service.py`), can reschedule/cancel. Caller gets WhatsApp/email echo (Stage 1.5).

### Why existing competitors don't fully solve it

* Vapi/Retell/Bland: infra-first, per-minute meter, **require phone numbers/SIP**, no Hinglish doc grounding as product, no calendar-native intake template — buyer must assemble workflow.
* Intercom Fin: chat-only per-resolution ($0.99), no voice booking, no Indian language depth, seat-priced.
* Practo/Urban Company: marketplace take-rate; owner loses client; Scribe is **owner-owned direct channel**.
* Exotel: telephony bundle, no owner-curated docs as source-of-truth.

### Why this project has a credible starting advantage

70% built: LiveKit barge-in <50ms (`worker.py:333` vs client 30ms), Silero VAD + dynamic EOT (0.18–0.75), Sarvam Hinglish STT/TTS already wired, `AgentRecord` per-channel prompts/voice/language, tool intents for availability/booking/messages, `VoiceCallRecord` durable transcript + summary queue, advisory-locked calendar, HMAC contacts with device binding — solo founders usually have zero of this; Scribe has all of it.

### What is genuinely differentiated vs table-stakes

* **Differentiated:** Hinglish voice→structured appointment with doc-grounded answers + background booking pattern (no fake "booked" before DB) + owner-owned widget (no marketplace take-rate) — narrow but real.
* **Table-stakes:** Sub-800ms feel, barge-in, citations, multilingual STT/TTS, streaming chat, transcript log — necessary for credibility, not a moat.

### Distribution strategy (feasible solo, no paid telephony)

* **Primary:** Embed widget (1-line `<iframe src="/t/{token}">`) on owner's site + Google Business "Website" CTA; QR on shop front → same link. Owner shares link on WhatsApp Status.
* **Channel:** Direct visits + WhatsApp to Google Maps/Justdial leads (50 calls/day manual). Second: partner with local web designers/freelancers who build salon/clinic sites — rev-share ₹500/setup.
* **Proof:** Before/after "missed calls recovered" from `voice_calls` counts (week 0 vs week 4), not NPS.

### First 10-customer strategy

Week 0–2: 50 intercepts, 15 interviews, select 3 **design partners** (one clinic, one salon, one tutoring) — free in exchange for 30 min/week feedback + logo/testimonial rights. Build only intake vertical presets for those 3.
Week 3–4: each partner introduces 2 peers (warm). Charge pilots **₹1,500/mo** (commitment filter) or free-for-1-month-then-₹2k/mo — not free forever. Target **10 paying or signed LOI by week 8**.

### Pilot structure

* 30 days, intake-only (no directory, no generic personas, no public listing).
* Owner onboarding: 45-min setup call → upload 1–2 docs (price list, schedule, policies `DocumentRecord.purpose=rag`) → choose voice (Sarvam shreya/priya tested for Hindi) → seed 3 services + Mon-Sat hours (`calendar/page.tsx:484`) → test link (`/t/[token]`) live.
* Success = caller completes `check_availability → book_appointment → booking_confirmed` without human, and owner confirms booking is calendar-correct.

### Pricing hypothesis (must be validated, not asserted)

* **Launch:** ₹1,999/mo per location — unlimited widget chats + 200 voice minutes incl., ₹8/min overage (covers Mistral+Sarbam at cost + margin); 14-day free trial with 50 minutes.
* **Year 2 ladder:** ₹2,999/mo with WhatsApp bridge; ₹4,999/mo 3-location bundle. Annual prepay 2 months free.
* **Anchor:** Intercom Fin $0.99/resolution + $29 seat vs Scribe outcome = booked slot; Bland $0.09/min vScribe's margin is intact at ₹8/min overage. Validate with Van Westendorp in interviews.

### Unit-economics assumptions (Stage One, before scale)

* COGS/min (Sarvam STT+TTS + Mistral small): ₹5–8/min ($0.06–0.10) at current volume; 3-min call ≈ ₹20. 100 calls/mo × 3 min = ₹2,000 COGS vs ₹1,999 price → break-even on voice alone; **profit is chat intake + overage** (chat marginal ≈0). Levers: Mistral small over Groq large, `VOICE_RAG_TOP_K=3` (`config.py:108`) keeps tokens low, `VOICE_LLM_MAX_TOKENS 220` (`config.py:82`) caps inference.
* CAC (solo hustle) ₹1,500–3,000 (travel + time); payback 1–2 months at ₹1,999; LTV if 9-mo retention = ₹18k.
* Must measure: actual Sarvam billed vs `duration_seconds` sum; don't guess.

### Major risks

1. Distribution fails — 10 pilots is hard without telephony lead gen (mitigate: wedge, Maps scraping, designer partners).
2. Voice completion <70% in noisy Hinglish (Sarvam `unknown` auto-detect) → caller drops (mitigate: text fallback default, `CallerChat`, progressive slot fill).
3. Hallucinated booking time → double-book (mitigate: background idempotent create + verbally confirm slot before commit, `local_booking_time` fold check `calendar_service.py:34`).
4. Secrets/history re-exposure if new leaks (mitigate: git-history scrub required P0, `SESSION_SECRET` gate `config.py:220`).

### Kill criteria (agree before building)

* No 3 design partners signed after 50 intercepts → ICP wrong, re-narrow or stop.
* <60% of 50 test calls complete intake end-to-end after 4 weeks of tuning → technical risk unbearable at budget.
* p95 E2E >2.5s after `§6` fixes on 4G throttled test → voice quality insufficient for paid use.
* Zero willingness to pay at ₹1k/mo after value shown → problem not urgent, stop.

### Potential moat after 12–24 months

* Per-location **intake corpus + booking graph** (which services/slots actually convert, which policies were asked, seasonal demand) → next owner gets preset from similar locations (network of intakes, not just models).
* Verified Hinglish slot-entity library (numbers/names/Hinglish dates) tuned on real transcripts (`voice_calls.transcript_source worker` `business.py:53` authoritative) — hard to replicate without data.
* Distribution moat: 200 local sites embedding Scribe widget is a switching cost no infra player can copy with minutes pricing.

---

## 6. AI & VOICE-QUALITY PLAN — To Acceptable Production

### 6.1 Targets (realistic, not marketing)

| Metric | p50 target | p95 target | How measured | Current |
|---|---|---|---|---|
| `e2e` speech-end → first audio (voice) | **1.10–1.4s** | **1.9s** | `turn_metrics.py:68` `e2e_latency` | 3.5s reported on trivial Supabase pooler (pre-gather fix `voice_routes.py:289` did parallelize; needs histogram confirm) |
| `eot` endpointing delay | **0.22s** punct / **0.45s** cont. | 0.75s | `worker.py:357` dynamic EOT buckets | 0.24/0.55 dynamic |
| `stt_finalization` interim→final | **250ms** | 500ms | Sarvam WS final vs interim (add log) | Not exported |
| `llm_ttft` first token | **320ms** | 800ms | `turn_metrics.py:68` `llm_node_ttft` | Not separated from e2e |
| `tts_ttfb` first audio | **280ms** | 500ms | `turn_metrics.py:68` `tts_node_ttfb` + clause 18-char gate | `speech_clean.py:72` 18/48/140; preemptive_tts off |
| `retrieval_ms` (RAG turn) | **320ms** | 600ms | `routes.py:930` `retrieval_ms` + `vector_store.py:227` wall | Not aggregated |
| Booking tool commit | **<2.5s** end-to-spoken confirm | 4s | `agent.py:341` `_run_background_booking` timing | Not timed |
| Chat streaming TTFT | **400ms** | 900ms | `routes.py:930` `ttft_ms` | SSE Vercel-compatible |

> Table-stakes per litmus 2026-06-29: ~600ms best-case feels human, 2500ms wrecks conversation. Scribe's 1.1s p50 is credible for solo+Hinglish; don't claim 400ms.

### 6.2 Turn detection & endpointing

* Keep `VOICE_ENDPOINTING_MIN 0.24 MAX 0.55 dynamic` (`config.py:168`) — already cut 0.55→0.35 then re-raised to 0.24/0.55 balance; don't lower both at once ("clipping worse than 100ms" `PRODUCTION_PLAN.md:202`).
* Keep dynamic suffix logic (`worker.py:363` conjunction list `and/or/because/aur/ya/lekin/ki...`) — measure per-bucket with telemetry before tuning.
* **Add:** log `endpoint_bucket` (`punct|conjunction|fallback`) into `turn_metrics` for 2-week histogram, then only tighten max if p95 eot >0.55 on punct.

### 6.3 Partial transcript handling & preemptive generation

* Today: interim used only for EOT tuning (`worker.py:366`), not for speculative RAG (`PRODUCTION_PLAN.md:208` outstanding). **Do:** start speculative `embedding encode` on interim >12 words but **don't** call vector search until final — embedding cache `KeyedLRU 512` (`cache.py:195`) makes interim encode free.
* Keep `preemptive_generation.enabled True` / `preemptive_tts False` (`session_factory.py:143`) — prior `vad 0.2s` + preemptive TTS replayed whole answer on cough ("okay") (`session_factory.py:115`). Enable preemptive TTS only after 4 weeks of >70% completion.

### 6.4 LLM streaming & TTS streaming/chunking

* Keep `VOICE_LLM_MAX_TOKENS 220` `STYLED 240` `CAP 350` (`config.py:82`) — voice answers must stay <30w per turn (`prompt_rules.py:26` `VOICE_DELIVERY`); larger caps produce 40s spoken answers.
* Keep `stream_clause_chunks` 18/48/140 (`speech_clean.py:72` + `config.py:145`): 18-char first clause gives <300ms TTFB vs 200-char buffering prior. Clean markdown/emoji via `strip_markdown_for_speech` (`speech_clean.py:61`).
* **Add:** expose `llm_stream_chunk_ms` in turn metrics to catch 400ms stalls from Groq TPM.

### 6.5 Audio buffering & capture

* Keep `MIC_CAPTURE {echoCancellation,noiseSuppression,autoGainControl,channel 1,48000}` (`useCallQuality.ts:32`) and `VOICE_ROOM_OPTIONS adaptiveStream+dynacast speech/dtx/red` (`useCallQuality.ts:58`) — comment `useCallQuality.ts:7` says this fixed prior personal vs public divergence.
* **Add:** client jitter log (`useCallQuality` warn 6s / bad 14s `useCallQuality.ts:58`) export to server on `ended` so p95 under 4G is known.

### 6.6 Barge-in

* Keep DataChannel `INTERRUPT b'{"type":"interrupt"}'` reliably (`worker.py:333`, `VoiceDataPacket` `domain/interfaces.py:28`) → client `<audio>.pause()` <30ms (`VoiceCall.tsx:522`). `resume_false_interruption True` replays false positives (`session_factory.py:152`) — correct.
* Keep `is_backchannel` ≤2w guard (`worker.py:337`, `speech_clean.py:50`) so "yeah/haan" doesn't flush queue.
* **Add:** count `barge_in_rate` per 100 turns; >15% suggests VAD too hot — raise `VOICE_VAD_MIN_SILENCE 0.24` to 0.30 (`config.py:187`).

### 6.7 Backchannels, noise, echo

* Backchannel set intentionally small; hallucination filter `thank you for watching/subtitles` (`speech_clean.py:37`) prevents caption leak into transcript. **Add** Hinglish-repeat filter for `theek hai theek hai` already in `filler.py` thinking list but not in STT filter — extend pattern.

### 6.8 Multilingual & Hinglish

* `VOICE_STT_LANGUAGE unknown` auto-detect requires `saaras:v3` (`config.py:44` note: `saarika:v2.5` returns ZERO transcripts with unknown). Keep.
* `normalize_tts_lang` maps STT→TTS fallback `hi-IN` with Devanagari/Hinglish heuristic (`language.py:76`), applied `agent.py:247` `tts.update_options(target_language_code)` — keep.
* **Add:** per-call `stt_lang_detected` + caller Hinglish ratio (latin vs devanagari `lexical_content` `agent.py:83`) into `business.save_call` transcript metadata for eval.

### 6.9 Numbers, names, addresses, email pronunciation

* Voice delivery rule "numbers as spoken 'pachaas rupay'" (`voice/config.py:332`) is prompt-only; TTS does it but not tested. **Add** a 20-phrase pronunciation eval (phone, date, price, email spelling) — Stage 1.5.
* Names: caller name injected into instructions + greeting when `contact.name` known (`voice_routes.py:444`) — keep. Add fuzzy slot for name capture via `leave_message_for_business` `reply_contact` (`agent.py:453`) with `is_prompt_injection` guard (`agent.py:711`).

### 6.10 Prompt architecture, conversation memory

* Keep split: `agent_compiler.compile_*` (`agent_compiler.py:15`), `owner_service.build_agent_prompt` leads with owner script + identity+clock+calendar+delivery rules (`owner_service.py:370`), `build_instructions` appends `_HONESTY+VOICE_DELIVERY` (`voice/config.py:375`), hierarchy wrapped via `build_hierarchy_header` + `wrap_tool_data` (`prompt_wrapper.py:3/8`). Custom prompt `custom` strips last block ("completely custom" `voice/config.py:388`) — correct.
* Keep history: Redis 1s timeout + 30s retry window + 500 FIFO fallback (`conversation_service.py:20/26/31`) + durable DB `MessageRecord` + LLM context last 4 verbatim + summary 900 chars + 500-tok cap (`rag_pipeline.py:247`), worker seed last 8 via `/voice/history` (`worker.py:172`, `voice_routes.py:231`), checkpoint list max 500 (`worker.py:274`).
* **Add:** answer cache `256 TTL 300s` keyed `tenant+norm query+top_k+model+temp+agent_hash+docHash` (`routes.py:48`) currently **disabled for images/history** — keep, add `cache_hit` metric.

### 6.11 Tool-call latency & background execution

* Keep background booking pattern (`agent.py:341` `publish booking_pending` → `cancel_thinking_filler` → `speak_booking_progress` immediate ack → `_run_background_booking` creates `create_booking` → `booking_confirmed` DataChannel + delayed `session.say`). Prevents "fake booked" lie (`agent.py:350`).
* **Add:** `tool_latency_ms{tool}` for `check_availability`/`book`/`search` — timeout budget 1.2s for availability, 2.5s for booking before spoken "checking..." filler is required.

### 6.12 Retrieval when needed only, retrieval caching, provider timeouts

* Keep `RAG only when needed` tool policy (`agent.py:221` + `config.py:349` work-with-excerpts: search only on missing info) — avoids every-turn RAG tax.
* Keep `retrieved when voice_rag_enabled else null→False` default (`voice_routes.py:428`) — prompt-first, fallback when enabled (correct for intake).
* Keep `_query_aware_top_k` 3/5/10 (`routes.py:49`) + voice adaptive 3/5 (`agent.py:782`), `VOICE_RAG_EXCERPT_MAX 220` (`config.py:111`). **Add:** `sparse_encoder.encode_query via query_embed` vs `embed` (`sparse_encoder.py:41`) cached 512 — log cache hit rate.
* Provider timeouts: `rag_pipeline._retryable_status 408/409/429/5xx` tenacity 3× exp 1–8s (`rag_pipeline.py:385/413`), `answer_cache 5m` (`routes.py:651`), `httpx` preview 15s (`voice_routes.py:156`), cleanup `60m` (`config.py:140`). **Add** Sarvam WS 2s timeout for `/voice/health` proxy (`voice_routes.py:109`) already 2s — replicate for `rag_client.fetch_context` (currently `RAG_FILLER_DELAY_S 0.35` `agent.py:782` sync vs actual HTTP timeout not wired — fix).

### 6.13 Rate-limit handling, circuit breakers, failover

* Keep `SlowAPI` per-tenant keys (`rate_limit.py:33`), `TRUST_PROXY_HEADERS False` by default (`config.py:105`), query 20/min upload 10/min (`config.py:113`), directory velocity 5/10min (`config.py:178`), daily budget 100/200 (`config.py:167`).
* **Add Stage 1.5:** circuit breaker on Groq 429 (`worker.py:292` `agent_unavailable` debounced 12s) → fallback to Mistral small automatically if `CUSTOM_LLM_BASE_URL` unset — currently manual, needs auto-failover counter.
* Sarvam 503 → spoken "temporarily unable" verdict (`worker.py:325`) without LLM call — keep.

### 6.14 Low-network, text fallback

* Keep `useCallQuality` adaptiveStream/dtx/red + `useAgentStall` 6s warn/14s bad + `NetworkBanner`/`SignalPill`; watchdog `AGENT_RESPONSE_TIMEOUT_MS 10000` (`VoiceCall.tsx:22`) naming key dynamically.
* Keep text fallback `CallerChat` always reachable from same token (`t/[token]/page.tsx:49` renders `CallScreen` vs `CallerChat` by mode; `business/chat` `business_routes.py:37` voice-only link blocked). Enforce: voice `ended/error` CTA is "Continue in chat".

### 6.15 Response-length, hallucination, evaluation

* Keep `VOICE_DELIVERY` 1–3 sents <30w, one question, no md (`prompt_rules.py:26`), `_HONESTY` block (`voice/config.py:315`) + per-claim citations (`rag_pipeline.py:112` `MUST cite [N.M]`).
* Hallucination prevention: allowlist IDs, `filter_output` redacts `gsk_*` phone bomb/hack (`output_filter.py:12`), grounding gate strips hallucinated pricing/contact (`site_ingest.py:549`), injection regex 12 (`injection_detector.py:18`) on voice+chat. **Gap:** no measurement — **add 60-question eval (§7) with precision/recall/citation-faithfulness before any prompt change**.

### 6.16 Automated simulations, human review, latency targets

* Today: zero conversation simulation. **Add:** `tests/test_voice_*.py` unit only; generate `scripts/sim_calls.py` that replays 20 scripted turns against `POST /query` + `POST /voice/retrieve` locally, asserts tool called and booking created, logs `e2e/ttft/ttfb`.
* Human review: sample 5 calls/week with `VoiceCallRecord.transcript` + `call_reports.summary` (`business_calls.py:35`), grade faithfulness 0–4.
* Targets restated §6.1 realistic not impossible; 400ms human-equivalent is not a Stage 1 promise.

### 6.17 Which improvements are what effort

| Improvement | Kind | Cost |
|---|---|---|
| Add `endpoint_bucket` + `tool_latency_ms` + `cache_hit` to `turn_metrics` | **Code** | 1 day |
| `rag_client` timeout = `RAG_FILLER_DELAY_S` wired | **Code** | 2 hrs |
| Fix filler invariant `pick_thinking_filler` 8w → ≤3w (`filler.py:32`) | **Code** | 1 hr |
| Enable `KeyedLRU` stats + export | **Config** | 2 hrs |
| Wire `telemetry` DataChannel to server store (`CallScreen ignored`) | **Code** | 1 day |
| Histogram dashboard (P50/P95) | **Infra** (Prometheus or just JSONL+notebook) | **Config** — free, local file + weekly script |
| Speculative embedding (interim) | **Code** | 1 day |
| Auto-failover Groq→Mistral on 429 | **Code** | 1 day |
| Preemptive TTS | **Code** | **Not feasible Stage 1** — caused replay, needs eval |
| Semantic turn detector GPU | **Infra** | **Not feasible** zero budget — keep `False` |
| Provider-level STT confidence gating | **Provider limitation** | Sarvam SAARAS v3 confidence not exposed via LiveKit plugin |
| PSTN/telephony | **Infra** | **Not Stage 1** by constraint; defer to `Telnyx $0/min` after 10 pilots |

---

## 7. STAGE-ONE PRODUCTION PLAN — Scribe Intake

> Stage One means: **a real shop owner can self-onboard, put a widget on their site, take 5 intake calls that end in calendar bookings, read them in inbox/calendar, and survive provider hiccups without silent failure — on their phone, with observable metrics, and with data that survives a redeploy.** Not a demo. A complete business outcome.

### 7.1 Features to keep unchanged (preserve value)

* Voice worker LiveKit WebRTC dance, VAD+dynamic EOT, Sarvam STT/TTS plumbing, Mistral small default, per-channel `voice_script`/`chat_script`/`voice_id`/`language`, barge-in, clause chunker.
* Calendar/services/availability/holidays/bookings with advisory locks + idempotent `voice:{call_id}:...` + `free_slots`.
* Contacts/sessions/transcripts/`VoiceCallRecord`+summary queue + `BusinessRequest` inbox + `NotificationRecord`.
* Guardrails/injection detector/output filter/hierarchy header.
* Next proxy + `RequestIdMiddleware` + `SecurityHeadersMiddleware` + global handler + health multi-check.

### 7.2 Features to adapt (reshape for Intake)

* `/agent` → Intake studio: replace generic personas with **Intake presets** (Clinic / Salon / Tutoring / Home-service) each with pre-filled `script` + 3 services + greeting; hide `Personas` picker unless Intake preset says so; surface `CalendarTimezone` inline.
* `/directory` → hide by default in Stage One (still served at `/directory` but removed from `OwnerShell.tsx:28` nav; `GET /directory/agents` stays but `directory/connect` `DIRECTORY_SESSIONS_PER_DAY 3` becomes Intake trial limit).
* `t/[token]` → branded Intake widget (rename UI copy, keep `CallScreen`+`CallerChat` dual CTA).

### 7.3 Features to remove or hide (cut scope, not delete code)

* Public directory discovery as primary entry — hide nav, disable `directory/connect` velocity marketing copy; keep route for internal trial.
* Generic chat-only personas (`motivational` etc.) as default voice options — move to `settings` advanced.
* Site auto-ingest as headline feature — demote to `SiteAgentModal` secondary, keep grounding gate.

### 7.4 Critical bugs to fix first (before any feature)

See backlog P0 (§9). Top: rotate exposed secrets, delete `LIMITS_ENABLED=false` default, fix filler invariant (already failing test), fix `test_directory_routes` event-loop teardown, fix `docker-compose.yml:46` sqlite override.

### 7.5 Missing data models (all else exists)

* None for Intake — `ServiceRecord/AvailabilityRecord/HolidayRecord/BookingRecord/VoiceCallRecord/BusinessRequestRecord/CalendarSettingsRecord` cover it. **Add only** `BookingRecord.source` already has `voice`; **ensure** `contact_id` on booking is always set for attribution (today nullable `db_models.py:380` — backfill via `call_id` join in report).

### 7.6 Required backend APIs (mostly exist; tighten)

* `POST /workspace/profile` (exists) — add Intake preset apply endpoint `POST /workspace/intake-preset`.
* `POST /voice/retrieve` + `/history` (exists worker-only `verify_internal_api_key` `voice_routes.py:178/231`) — **wire timeout to filler delay**, add `X-Request-ID` propagation to `rag_client`.
* New `GET /voice/metrics` (aggregate last 24h `turn_metrics` from logs table or JSONL).

### 7.7 Required frontend screens (adapt, not new)

* `setup/page.tsx` → add Intake preset picker after business name/category.
* `settings/page.tsx` → move AI Keys write-only with masked hint (`secrets_box.mask`) — already does (`settings/page.tsx:316`), just audit.
* `dashboard/page.tsx` → replace generic overview with **Intake KPIs**: bookings/week, missed→recovered rate, top asked policy (grouped `call_reports.booking_intent`).
* `inbox/page.tsx` + `calendar/page.tsx` → keep, add "Intake completed" badge on `BookingRecord.source==voice`.

### 7.8 AI behavior changes

* Instruction: Intake persona appends `You book only via check_availability→book_appointment; never claim booked before tool succeeds` (already `agent.py:350`) — add "confirm slot verbally before tool call".
* Retrieval: keep adaptive `3/5` but cap at `3` for Intake (slots more important than docs).
* New intake template prompt (Hindi-aware, one-question rule): service? date? time? contact? confirm.

### 7.9 Reliability work

* Health split `live` vs `ready` (`routes.py:325` currently hits Qdrant on liveness).
* Persist `routes.py:854` fire-and-forget wrap with `try/except` → error SSE frame, not hang (`PRODUCTION_PLAN.md:152`Outstanding).
* Port stale kill already in `worker_supervisor.py:167` + `start_backend.ps1` — deduplicate.
* Worker double-start guard `VOICE_WORKER_MANAGED_EXTERNALLY` flag (`main.py:74`).

### 7.10 Security & privacy work

* Git history scrub for `backend/.env`.
* Enforce `SESSION_SECRET` gate (`config.py:220`) already — add CI check that shipped `.env` doesn't contain `gsk_`/`eyJ`/`wss://` literal.
* `files intentionally NOT mounted as static` (`main.py:208`) — keep.
* Device binding logged IP/UA visible to owner (`ContactSessionRecord` `ip_address/user_agent/device_id`) — surface in `links` drawer for anomaly review.

### 7.11 Analytics & business metrics

* New table-free metrics (weekly):
  * `bookings/week` split `voice/chat` (`BookingRecord.source`, `status confirmed`)
  * `call→booking conversion %` = `count(bookings with call_id) / count(voice_calls where completed True and source=directory or owner)`
  * `p50/p95 e2e, ttft, ttfb` from `turn_metrics.log` aggregated via `scripts/agg_turn_metrics.py`
  * `RAG hit rate` (search called vs turn)
  * `missed→recovered` (before/after week 0 baseline from call counts)

### 7.12 Automated tests

* Fix failing `test_voice_thinking_filler 8w>3w` + flaky `test_directory_routes` event loop.
* Add eval harness: `tests/test_eval_intake.py` 60 Q/A with expected citations + slot entities + tool route; fails CI if recall <0.70 or booking success <0.75 on dry-run.
* Add `tests/test_leak_no_secrets_in_repo.py` greps `.env` not tracked.
* Frontend: add Playwright smoke 5 flows: setup→agent→token→call screen render→chat→booking appears in inbox (no LiveKit needed — mock token).

### 7.13 Deployment requirements (zero-budget constraint respected)

* Keep free tier stack: Supabase Postgres+Storage free 1GB (`PRODUCTION_PLAN.md:31`), Qdrant Cloud (same live `a035a505...aws.cloud.qdrant.io` already), LiveKit Cloud free, Groq/Mistral free tier. No new paid vendor in Stage One.
* `docker-compose.yml` stays dev-compose; prod is Supabase + Render/Fly free tier with env-driven Postgres URL (no sqlite volume). `render.yaml`/`Dockerfile` already `HEALTHCHECK curl /health`.
* Single `STARTER` doc: `QUICKSTART.md` collapsed to Postgres-only + scrubbed `.env.example` (currently duplicates `GROQ_VISION_MODEL` lines `backend/.env.example:11-13/27-28`).

### 7.14 Pilot onboarding

* `scripts/onboard_intake.py` — one-command seed: 3 services, Mon-Sat 09-18, intake persona, second factor off.
* Runbook `docs/ONBOARDING_INTAKE.md` — 45-min call checklist (see §7.15 milestones).
* Founder does all 3 pilots personally on video; records `VoiceCallRecord.transcript_source worker` vs `browser` fallback for comparison.

### 7.15 Prioritized backlog, dependencies, acceptance, effort (solo+agents), risk

> Priority: **P0 stop-the-line before pilot**, **P1 must for Stage One**, **P2 nice-to-have**, **Later** post-10-pilots.
> Effort: S ≤1d, M 2–3d, L 5–7d (solo + coding agents). Risk: H/M/L.

| # | Task | Pri | Reason | Deps | Files | Acceptance | Effort | Risk |
|---|---|---|---|---|---|---|---|---|
| 1 | Rotate all leaked keys + scrub git history + CI secret-leak check | P0 | Secrets committed `backend/.env:2` = takeover | — | `backend/.env`, `git history` | No `gsk_`,`eyJ`, `wss` literal in `git log --all -p`, CI fails on pattern, `SESSION_SECRET` gate `config.py:220` enforced | S | H |
| 2 | Remove `sqlite` default deploy path → Postgres-only + Storage-only gate | P0 | `docker-compose.yml:46` overrides env → data loss on volume delete | 1 | `docker-compose.yml:46`, `backend/app/config.py:117`, `backend/app/database.py:47`, `backend/app/services/storage.py:209` | Compose `DATABASE_URL` removed or `DATABASE_URL` required at startup; `storage` falls back only with loud warn not silent; docs match code | S | H |
| 3 | Fix filler invariant (`8w >3w`) + directory workflow event-loop error | P0 | 354/355 green vs red blocks CI | — | `backend/app/services/voice/filler.py:32`, `tests/test_voice_thinking_filler.py:64`, `tests/test_directory_routes.py` | `pytest -q` 355/355 green, no `Event loop is closed` | S | L |
| 4 | Turn-metrics export + timeout wiring (`rag_client` + `ttft/ttfb/e2e` histogram) | P0 | `PRODUCTION_PLAN.md:206` "measure before claiming" — no tuning without data | — | `backend/app/services/voice/turn_metrics.py:68`, `backend/app/services/voice/rag_client.py:126`, `frontend/app/components/voice/useCallQuality.ts:58` | `GET /voice/metrics` returns p50/p95 last 24h; `RAG_FILLER_DELAY_S` applied as HTTP timeout | M | M |
| 5 | Intake preset model + `/agent` studio preset picker + nav hide directory | P1 | Makes product a wedge, not a demo | 4 | `frontend/app/agent/page.tsx:128`, `frontend/app/agent/templates.ts:29`, `frontend/app/components/owner/OwnerShell.tsx:28`, `backend/app/api/owner_routes.py:665` | Studio shows 4 intake presets; directory hidden unless feature-flag; generic personas demoted | M | M |
| 6 | 60-question golden eval + `tests/test_eval_intake.py` gate | P1 | Zero eval = blind hallucination risk (`PRODUCTION_PLAN.md:266`) | 4 | `tests/test_eval_intake.py` new, `backend/app/services/rag_pipeline.py:74`, `backend/app/models/db_models.py:38` | CI fails if recall<0.70 or citation faithfulness <0.90 on eval | M | M |
| 7 | Stream error frame (SSE `{"error"}` + `[DONE]`) + blocking-health split | P1 | `routes.py:565` hang + `routes.py:98` blocking probe = silent failure | — | `backend/app/api/routes.py:565`, `backend/app/api/routes.py:325` | Kill LLM mid-stream → UI shows error not spinner; `GET /health/live` <50ms, `/health/ready` full | S | M |
| 8 | Booking front-door verification: verbal slot confirm before `create_booking` + idempotent key visible in logs | P1 | `PRODUCTION_PLAN.md:262` checklist — hallucinated time = liability | — | `backend/app/services/voice/agent.py:477`, `backend/app/services/calendar_service.py:34` | Transcript always contains "confirm <slot>" before `booking_confirmed` emitted; double-call deduped by `voice:{call_id}:...` | S | M |
| 9 | Dashboard → Intake KPIs (bookings/week, call→booking %, top asked) | P1 | Owner needs outcome, not token counts | 5 | `frontend/app/dashboard/page.tsx:100`, `backend/app/services/business_calls.py:65` | Dashboard cards show weekly bookings, conversion %, 7-day sparkline from `BookingRecord` | S | L |
| 10 | `VOICE_WORKER_MANAGED_EXTERNALLY` + duplicate-supervisor dedup | P1 | `main.py:74` + compose both spawn | — | `backend/app/main.py:74`, `backend/app/services/voice/worker_supervisor.py:128`, `docker-compose.yml:66` | Compose sets flag → `ensure_worker_running` no-ops; no double port kill | S | L |
| 11 | Alembic init (`alembic upgrade head` at startup) | P1 | `create_all` never alters; `_ADDED_COLUMNS` unsustainable | — | `backend/app/database.py:26` replaces patch with Alembic | `alembic current` = head after fresh `init_db` | M | M |
| 12 | Playwright smoke 5 flows + leak test | P1 | No FE tests (`package.json:24` none) | 5 | `frontend/package.json`, `playwright.config.ts` new | `npx playwright test` 5 passed in CI | M | L |
| 13 | WhatsApp bridge stub (text+voice-note intake) | P2 | India's channel, but adds Meta dep | 5 | `backend/app/api/business_routes.py` new `POST /whatsapp/webhook` | Text msg → same RAG→booking pipeline, voice note → Sarvam transcript | M | M |
| 14 | SIP/PSTN via Telnyx BYO | Later | Constraint: "no paid telephony Stage One" | 10 pilots | `backend/app/services/voice/config.py` `VOICE_BACKEND_URL` + SIP provider | Inbound phone books via same `book_appointment` tool | L | H |
| 15 | Reranker re-enable (FlashRank/Cross-encoder) with eval gate | Later | Only after eval shows RRF recall <0.75 | 6 | `backend/app/services/reranker.py:13` | Eval recall +80ms p95 retrieval still <600ms | M | H |

### 7.16 Realistic weekly milestones (solo founder + coding agents)

| Week | Theme | Shippable outcome | What not to do |
|---|---|---|---|
| **0** | **Secure + measure** | P0 #1–4 done; `pytest` green; `GET /voice/metrics` live; `.env.example` scrubbed | No feature work |
| **1** | **Wedge the product** | #5 presets live; directory hidden; `setup` shows intake pickers; 15 interviews done | No WhatsApp, no SIP |
| **2** | **Trust the answers** | #6 eval 60Q gate green; #7 stream fix + health split shipped | No preemptive TTS, no semantic VAD |
| **3–4** | **Pilots 1–3 onboarded** | 3 design partners live; #8 verbal confirm verified via transcript audit; #9 KPI cards live; 5 calls/week each observed | No reranker, no new infra |
| **5** | **Harden** | #10–11 worker guard + Alembic; #12 Playwright in CI; `docs/ONBOARDING_INTAKE.md` + `scripts/onboard_intake.py` | No WhatsApp yet |
| **6–8** | **10 pilots + price test** | #13 only if partners pull; else stay on widget; charge pilot intros ₹1.5k/mo; kill criteria checked | No SIP until 10 pilots prove distribution |
| **8** | **Stage One gate** | Launch checklist (§8) checked or **do not launch** | Don't demo to investors until §8 investor checklist passes |

---

## 8. PRODUCT & INVESTOR READINESS — Evidence Before Claims

### 8.1 Evidence that must exist before an investor demo (and in what order)

1. **15 customer interviews** with notes (problem, current workaround, quote, WtP at ₹2k/mo) — not a survey.
2. **3 design partners** live ≥14 days, with **≥20 booked appointments** via intake (voice+chat), confirmed calendar-correct by owner.
3. **Accuracy** — 60Q eval run on prod corpus **recall ≥0.75 / precision ≥0.70 / citation faithfulness ≥0.90** (same pipeline as prod `RETRIEVAL_TOP_K 10` `reranker stub` path — no eval-inflating config).
4. **Latency** — 30 consecutive real-network calls (4G throttled in Chrome) with **p50 E2E ≤1.4s, p95 ≤1.9s** from `turn_metrics` JSONL, not one lucky trace.
5. **Conversion** — **call→booking ≥35%** for intake-intent calls (pop-by vs booking intent disambiguated via `BusinessRequest.kind` review).
6. **Testimonials** — 2 video 30s or 3 signed quotes with perms + before/after missed-call count.
7. **Revenue or WtP** — 3 paid pilots at ₹1.5k/mo for ≥1 month or 5 signed LOIs at ₹1.999k/mo.
8. **Retention** — week-4 usage ≥ 60% of week-1 (same partner, same site traffic).
9. **Before/after business result** — "missed after-hours calls fell from 12→3/week; 9 recovered × ₹1200 avg = ₹10.8k recovered vs ₹1,999 cost" — audited from `VoiceCallRecord` counts + owner confirmation.

### 8.2 Pilot scorecard (per location, updated weekly)

| Signal | Target | Source | Red flag |
|---|---|---|---|
| Intake-qualified calls/week | ≥5 | `contact_sessions where channel voice and conversation_id→messages contains intake slot` | <2 two weeks running |
| Call→booking % | ≥35% | `bookings with call_id / voice_calls completed` | <20% after Week 4 tuning → prompt or slot logic broken |
| Slot-correct bookings | ≥95% | Owner confirms `BookingRecord.start_ts` matches verbal | <90% → block launch |
| p50 / p95 E2E | ≤1.4s / ≤1.9s | `turn_metrics.log` aggregated | p95 >2.5s → network/provider issue |
| Hinglish handled (no repeat ask) | ≥80% | sample 10 Hinglish transcripts human grade | <60% → STT lang issue `language.py:76` |
| Hallucinated slot | 0 | `filter_output` + manual check | 1 → P0 |
| Owner NPS / time saved | "keep it" / ≥2h/week | interview | "Turn it off" → kill feature |

### 8.3 Weekly founder dashboard (what you look at every Monday, 10 min)

```
Week of ___

Pipeline:  Intercepts __ | Interviews __ | Pilots live __ /3 → __ /10
Intake:    Calls __ | Bookings __ | Conv __% | Slot-correct __%
Voice:     p50 __s p95 __s | ttft __ms | ttfb __ms | barge-in __% | stall 6s __%
RAG:       Eval recall __  faith __ | RAG hit rate __% | cache hit __%
Reli:      pytest __ /355 | p50 health/live __ms | incidents __
Business:  Paying __  LOI __  Churn __  MRR ₹__  NPS __
Risk:      LEAKED-KEYS? __  Postgres reachable? __  Limits ON? __
```

### 8.4 Stage-One launch checklist (all must be ✅ or do not launch)

* [ ] Secrets rotated + history scrubbed + CI leak check (`backend/.env` no `gsk_`/`eyJ`) (§7.15 #1)
* [ ] Postgres reachable + `Alembic head` after restart survives `docker volume rm` test (#2/#11)
* [ ] `LIMITS_ENABLED True`, daily budgets enforced at `POST /voice/token 429` for contacts (#2)
* [ ] `pytest` 355/355 green + `tsc` 0 + `next build` ≤10s + Playwright 5 smoke green (#3/#12)
* [ ] Intake presets live, directory hidden, generic personas demoted (#5)
* [ ] 60Q eval gate recall ≥0.70 faith ≥0.90 (#6)
* [ ] Stream error shows SSE `{"error"}` not hang + `live` <50ms (`main.py:139`) (#7)
* [ ] Booking verbal confirm before idempotent commit observed in 10 transcripts (#8)
* [ ] Dashboard KPI cards live from real `BookingRecord` (#9)
* [ ] `turn_metrics` histogram live with p50/p95 (#4)
* [ ] 3 pilots with ≥20 bookings verified calendar-correct
* [ ] Mobile 375px verified (no overflow, 44px targets); a11y keyboard path smoke
* [ ] `ONBOARDING_INTAKE.md` runbook + `onboard_intake.py` seeds 3 services in <5 min

### 8.5 "Ready for investor demo" checklist (separate from launch)

* [ ] All Stage-One items above
* [ ] §8.1 nine evidence lines present (15 notes, 3 pilots ≥14d, 20 bookings, eval ≥0.75 recall, 30-call latency histogram, 35% conv, 2 testimonials, 3 paid/5 LOI, week-4 retention ≥60%)
* [ ] Before/after business result audited
* [ ] Demo is **one pilot's real widget** booking a real slot on their calendar, not a canned tenant
* [ ] No live secrets in repo; demo tenant is non-prod data
* [ ] One-page tear sheet: ICP, problem, workflow, pricing, unit econ, moat (§5)

### 8.6 "Do not launch yet" checklist (any one = stop)

* Any `gsk_`, `eyJ` JWT, or `wss://` live host literal in `git log --all -p`
* Anyone can read/delete docs unauthenticated (re-test `curl /api/v1/documents` → 401)
* `retrieval → booking` fails silently (no DataChannel `booking_failed` + no spoken apology)
* `p95 E2E >2.5s` on real network or slot-correct <90%
* Zero design partners after 50 intercepts or owner says "Calendly is enough" twice with same reason
* Directory still primary nav (product has no wedge)

---

## 9. PRIORITIZED BACKLOG (full, copy-pasteable)

See §7.15 table (items 1–15). Ordered P0→P1→P2→Later with acceptance. Keep in `issues` or `Trello` as-is; don't re-prioritize until P0 is green.

---

## 10. ASSUMPTIONS REQUIRING CUSTOMER VALIDATION (do not assume)

1. **ICS:** owner-operated clinics/salons have 20–80 qualifying inquiries/week worth capturing (not just walk-ins).
2. **ICS:** they will put a widget on their site / QR at shop (many have no site or won't edit it).
3. **ICS:** they will pay ₹1,999/mo for *intake* (not "AI"), when Calendly free exists.
4. **ICS:** Hinglish is a buying trigger vs English-only (Sarvam vs ElevenLabs).
5. **ICS:** after-hours missed calls are actually lost revenue (not staff just calling back next morning).
6. **Tech:** `unknown` auto-detect STT handles the owner's real caller mix (their accents, not Delhi sample) at >80% without language picker.
7. **Tech:** booking without phone-number telephony transfers (widget-only) is acceptable — callers will tap a link rather than dial.
8. **Tech:** 3-doc cap (`DocumentRecord.purpose`) is enough (price list + schedule + one policy) or owners resent the limit.
9. **Market:** direct Google Maps outreach at 50/day can yield 3 pilots in 3 weeks (channel assumption — the biggest risk).
10. **Market:** 3-location bundle at ₹4,999/mo has any demand (vs single).
11. **Unit econ:** Sarvam+MISTRAL COGS stays ₹5–8/min after scale (Groq TPM or Sarvam quota could move it 2×).

*Validation method:* §8.1 interviews must **quote** evidence for each; backlog item #5 does not start until assumptions 1–5 survive 10 interviews.

---

## 11. QUESTIONS THE FOUNDER MUST ANSWER (before approving plan)

1. Which **one** of the 4 intake presets (clinic/salon/tutoring/home-service) are you personally able to get introductions for fastest — name the 10 people you'd call Monday?
2. Are you willing to do **50 in-person/WhatsApp intercepts** in the next 3 weeks and record notes, or do you need a cheaper channel?
3. Is **phone-number-less** acceptable for 3 months, or is at least one pilot demanding PSTN on day one (changes Stage One)?
4. What is your **real monthly budget** for Sarvam/LiveKit/Groq/Mistral free-tier overage before you must turn away traffic — put a number?
5. Will you **rotate every key in `backend/.env`** this week and scrub history (breaks current demo links until migrated)?
6. Accept **₹1,500/mo pilot price as commitment filter** vs free (tests WtP but loses some pilots) — which do you choose?
7. Which vertical's **booking calendar** do you already understand (clinic slots 30m vs salon 60m vs tutoring fixed batch) to avoid building the wrong slot math?
8. Commitment to **weekly turn-metrics + eval review** for 8 weeks — can you protect 2 hours every Monday?

---

## 12. DECISIONS THAT SHOULD NOT BE MADE YET (explicitly defer)

* **PSTN provider** (Exotel vs Telnyx vs Twilio India) — until 10 widget pilots prove distribution; then pick one.
* **Reranker re-enable** (FlashRank) — until 60Q eval shows RRF recall gap >0.05 at p95 retrieval <600ms.
* **Preemptive TTS + semantic VAD** — until >70% completion; both caused regressions (`session_factory.py:115` replay).
* **WhatsApp Business verification** — Stage 1.5, only if 2 of 3 pilots request it.
* **Multi-location / team RBAC** — Until one pilot asks for a second receptionist login.
* **Custom vision endpoint** (beyond Groq vision) — until image booking (photo of prescription) is requested.
* **Pricing ladder beyond ₹1,999** — Until 10 pilots have paid or signed LOI.

---

## 13. READY-TO-COPY PROMPT FOR THE NEXT CODING AGENT — Milestone 0 only

> Use this verbatim in a fresh session. Agent must not proceed beyond Milestone 0 without founder approval.

````
You are implementing **Milestone 0 — Secure + Measure** for Scribe. Do not build features outside this milestone.

Project root: `D:\work\New folder`
Read first: `PRODUCT_DIRECTION_AND_STAGE1_PLAN.md` §7.15 items #1–4, plus `backend/app/config.py`, `backend/app/services/voice/filler.py`, `backend/app/services/voice/turn_metrics.py`, `backend/app/services/voice/rag_client.py`, `docker-compose.yml`, `backend/.env.example`, `tests/test_voice_thinking_filler.py`.

Tasks (in order, verify after each — never batch):

1) **Secrets hygiene (P0)**
   - Remove `backend/.env` from tracking: `git rm --cached backend/.env` if tracked; confirm `.gitignore` already lists `.env`/`*.env`.
   - Rotate every literal in the current `backend/.env` (Groq `gsk_*`, Qdrant JWT `eyJ...`, Qdrant host `a035a505...`, LiveKit URL/keys, Sarvam `sk_*`, Mistral, `SESSION_SECRET`, `DATABASE_URL` password, `CORS_ORIGINS` ngrok). Replace with `__ROTATE_ME__` placeholders; leave rotation to founder.
   - Add CI check `scripts/check_no_secrets.py` that fails on `gsk_`, `eyJhbG`, `sk_tnrnnzv9_`, `wss://`, `Api5ML` literals in `git log --all -p` or tracked files; wire in `.github/workflows/ci.yml`.
   - Acceptance: `git log --all -p` contains no literal above; CI script exits 0 on clean repo.

2) **DB/storage deploy gate (P0)**
   - Delete `DATABASE_URL=sqlite+aiosqlite:///./data/rag.db` from `docker-compose.yml:46` `environment:` overrides; keep only Qdrant/Redis/VOICE_WORKER_HEALTH_URL. Backend must read `DATABASE_URL` from env/.env (Supabase `postgresql+asyncpg`) or fail startup loudly (`config.py:220` style).
   - Ensure `storage.build_storage()` (`backend/app/services/storage.py:209`) logs `WARNING` when falling back to `LocalDiskStorage` and that `upload_document` (`backend/app/api/routes.py:491`) still works locally but prod requires Supabase vars.
   - Acceptance: `docker compose config` shows no sqlite URL; fresh `docker compose up backend` with Postgres URL lists docs after `docker volume rm`.

3) **Fix CI (P0)**
   - Fix `backend/app/services/voice/filler.py:32` so every phrase in `_THINKING_FILLERS_BY_LANG["en-IN"]` is ≤3 words (current violator: "I’m checking that now — please keep talking." 8 words). Keep non-empty, non-repetitive.
   - Fix `tests/test_directory_routes.py::test_directory_workflow` `RuntimeError Event loop is closed` on teardown — use `pytest-asyncio` fixture cleanup or `async with` engine scope correctly (`backend/app/database.py:47`).
   - Run `venv\Scripts\python -m pytest -q` → expect **355 passed** (or document new count) and `npx tsc --noEmit` → 0 errors + `npm --prefix frontend run build` → success.
   - Acceptance: `pytest -q` exits 0; artifacts in PR description.

4) **Telemetry (P0)**
   - Add `endpoint_bucket`, `tool_latency_ms`, `cache_hit` fields to `backend/app/services/voice/turn_metrics.py:68` INFO log + `VoiceDataPacket.telemetry` (`turn_metrics.py:87`).
   - Wire `backend/app/services/voice/rag_client.py` HTTP timeout to `RAG_FILLER_DELAY_S 0.35` (`backend/app/services/voice/filler.py:23`) or `VoiceSettings` value; propagate `X-Request-ID` from `request_id_ctx`.
   - Add `GET /api/v1/voice/metrics` (behind `verify_api_key`) that tails/reads last 24h JSONL (or in-mem ring) and returns `{p50,p95,count}` for `e2e,ttft,ttfb,retrieval_ms,tool_ms`.
   - Acceptance: after 3 simulated calls, `GET /voice/metrics` returns non-null p50/p95; turn logs contain new fields; existing `CallScreen` still renders if server omits fields.

Constraints: Do not change any product copy, nav, or intake presets. Do not add billing/telephony/WhatsApp. Preserve all `file:line` guardrails above. Open a PR titled `milestone-0-secure-measure` with: secrets note, compose diff, pytest+tsc+build logs.
````

---

## APPENDIX

### A. Capability matrix — restated for quick audit

See §1.14 (11 rows Production-ready down to Broken). Copy into tracker as checklist.

### B. ERD — 17 tables (`backend/app/models/db_models.py:16`)

Owners (`tenant_id` unique, `public_handle`, `*_enc`), Agents (`tenant_id` unique, `status draft|deployed`, `voice_rag_enabled`), AgentSnapshots, Documents (`agent_enabled`, `purpose rag|agent`, `source_snapshot_id`, `chunk_count`), Conversations+Messages, Contacts (`token_hash unique`, `bound_device`, `blocked_at`, `max_sessions_per_day 20`), ContactSessions (`duration_seconds`, `channel`, `device_id`), VoiceCalls (`summary_status` index), CallReports, BusinessRequests (`open` index), Services/Availability/Holidays/Bookings (`start_ts` index), Notifications, CalendarSettings.

### C. API surface — 8 routers (`backend/app/main.py:198`)

`/api/v1/session` login/logout/config, `/contacts` create/list/open/t/*, `/directory` agents/connect, `/workspace` mode/agent/deploy/providers/usage, `/calendar` services/availability/slots/bookings/reports, `/business` chat/requests/calls, `/` RAG documents/query/stream/conversations + storage, `/voice` voices/languages/personas/health/preview/retrieve/history/token/record_session/calls.

### D. Corrected verification vs README/PRODUCTION_PLAN disagreements

* README `SQLite (rag.db)` as durable — **false for prod**, code preserves but compose hardcodes it on named volume; fix §7.15 #2.
* README `rerank 20→10 FlashRank` — **reranker is stub** `reranker.py:13` (no ranking).
* `APP_FLOW_DIAGRAM` `WS /voice/stream` — **not used**; actual is LiveKit dispatch `ROOM_AGENT`.
* `PRODUCTION_PLAN` "62 passed" — **stale**; actual 354/355 (grown with business mode tests).

### E. Market sources — dated index

* Vapi [vapi.ai/pricing](https://vapi.ai/pricing) (live) + Rezora [2026-07-20](https://rezora.io/blog/vapi-pricing) + Layer3 [2026-08-28](https://www.layer3labs.io/guides/vapi-pricing) + Emitrr [2026-08-13](https://emitrr.com/blog/vapi-pricing/) + CloudTalk [2026-08-06](https://www.cloudtalk.io/blog/vapi-ai-pricing/)
* Retell [retellai.com/pricing](https://www.retellai.com/pricing) (live) + Layer3 [2026-07-16](https://www.layer3labs.io/guides/retell-ai-pricing) + Litmus [2026-06-29](https://litmustools.com/review/retell-ai/) + A8gent [2026-08-06](https://a8gent.com/platforms/retell-ai)
* Bland [bland.ai/pricing](https://www.bland.ai/pricing) + Bland billing [docs.bland.ai Dec 5 2025](https://docs.bland.ai/platform/billing) + PxlPeak [2026-02-26](https://pxlpeak.com/blog/ai-tools/bland-ai-pricing)
* Sarvam full-stack [Algoturk 2026-06-17](https://algoturk.com/brief/sarvam-ai) + review [aiagentrank 2025-08-22](https://aiagentrank.io/agent/sarvam-ai) + Samvaad self-serve [startupfeed 2026-06-03](https://startupfeed.in/sarvam-samvaad-opens-to-public-voice-ai-self-serve/)
* Gnani Artha [Medianama 2026-08-29](https://www.medianama.com/2026/08/223-gnani-ai-artha-sovereign-ai/) + [startupresearcher 2026-08-29](https://www.startupresearcher.com/news/gnani-ai-unveils-artha-sovereign-ai-stack)
* India platforms [Whinta 2026-08-14](https://whinta.com/blog/best-ai-voice-calling-platforms)
* RAG dying [SamOnAI 2026-07-07](https://samonai.substack.com/p/rag-as-a-product-is-dying) + [Datadeep RAG 2026-07-27](https://datadeep.tech/retrieval-augmented-generation/) + TrickyWombat [2026-06-24](https://www.trickywombat.ai/signals/rag-as-a-service) + BusinessResearch [multimodal RAG 2026-03-17](https://www.giiresearch.com/report/tbrc1987821-multimodal-retrieval-augmented-generation-rag.html)
* Document AI [Cogneris 2026-05-07](https://cogneris.ai/state-of-document-ai-2026.html)
* Intercom [intercom.com/pricing](https://www.intercom.com/pricing) + Drift sunset [canarychat 2026-04-28](https://canarychat.app/blog/intercom-vs-drift) + [aistackguides 2026-06-04](https://aistackguides.com/blog/drift-vs-intercom-2026)

### F. Files of record for audit replay

* Backend entry/config: `backend/app/main.py:105`, `backend/app/config.py:15`, `backend/app/services/voice/config.py:19`, `backend/app/database.py:47`
* Auth/tenancy: `backend/app/session.py:46`, `backend/app/identity.py:63`, `backend/app/auth.py:18`, `backend/app/rate_limit.py:33`, `backend/app/contacts.py:58`
* RAG/retrieval: `backend/app/api/routes.py:49/491/742`, `backend/app/services/rag_pipeline.py:74/112`, `backend/app/services/vector_store.py:168/234`, `backend/app/services/document_processor.py:450`, `backend/app/services/embedding_service.py:12`, `backend/app/services/sparse_encoder.py:17`, `backend/app/services/reranker.py:13`
* Voice: `backend/app/services/voice/worker.py:68/209/353/483`, `backend/app/services/voice/session_factory.py:125`, `backend/app/services/voice/agent.py:83/341/439/677`, `backend/app/services/voice/filler.py:32`, `backend/app/api/voice_routes.py:116/178/253`
* Storage/cache: `backend/app/services/storage.py:51`, `backend/app/services/cache.py:34`, `backend/app/services/conversation_service.py:20`
* Calendar/bookings: `backend/app/services/calendar_service.py:34/48/178`, `backend/app/api/calendar_routes.py:304`, `backend/app/models/db_models.py:345`
* Frontend: `frontend/app/page.tsx:22`, `frontend/app/VoiceCall.tsx:418`, `frontend/app/t/[token]/CallScreen.tsx:198`, `frontend/app/lib/api.ts:238`, `frontend/next.config.ts:12`

---

*End of report — awaiting founder review and approval before any implementation. Do not implement beyond Milestone 0 until directed.*

