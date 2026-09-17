# TECHNICAL REALITY AND SHARED FOUNDATION — Scribe
**Date:** 2026-09-08 | **Verification only — no code, no .env, no git history changed**

## 1. Correction: backend/.env was never tracked
**Commands:** `git check-ignore -v backend/.env`, `git ls-files --error-unmatch backend/.env`, `git log --all -- backend/.env`, `git ls-files | grep .env`
**Result:** `.gitignore:7:backend/.env backend/.env` (ignored) | `ls-files --error-unmatch` → `error: pathspec did not match any file(s) known to git` exit 1 | `git log` → no output | tracked files → only `backend/.env.example`. **Fact:** not tracked, no history. Both prior reports' `backend/.env:2` "committed secrets" claim is **false**. Untracked local file still needs local hygiene (do not publish, do not copy), but **no git purge/rotation/git-rm is required**. Report only `backend/.env.example` placeholders — no secret in any tracked file except regex test literals (`output_filter.py:13` `_RE_GSK` pattern, test dummy `gsk_x`).

## 2. Current capabilities — verified
*Rows cite file:line. Labels: Production-ready / Functional but incomplete / Prototype / Broken / Missing.*

| Capability | Label | Evidence |
|---|---|---|
| Voice transport + worker lifecycle | Functional but incomplete | LiveKit SFU `voice_routes.py:585` `RoomConfiguration(RoomAgentDispatch)` + client `VoiceCall.tsx:438` `Room.connect` + worker `worker.py:209` `JobContext` + `main.py:62` `lifespan` `ensure_worker_running()` detached. No PSTN, no TURN override, double-start under compose (`main.py:74` + `compose:66`). |
| Sarvam STT/TTS | Functional but incomplete | `sarvam_stt.py:14` `saaras:v3` `unknown`=auto-detect WS streaming; `sarvam_tts.py:32` `bulbul:v3` `pace 0.92 temp 0.75` WS streaming; preview REST `voice_routes.py:145` single lang `en-IN`. |
| Mistral config | Functional but incomplete | `voice/config.py:59` `mistral-small-latest` `temp 0.3` caps 220/240/350, `mistral_llm.py:22` `lk_openai.LLM(base_url)`; custom OpenAI-compat `openai_compatible_llm.py`. No auto-failover. |
| Voice latency measurement | Prototype | `turn_metrics.py:68` logs `e2e/eot/stt/ttft/ttfb` + warns `>2.0s` + DataChannel `telemetry` `turn_metrics.py:87`; `worker.py:214` TTF Audio log. **No histogram, no p50/p95 store**, `CallScreen.tsx` ignores telemetry. |
| Endpointing + interruptions | Production-ready | Silero `0.24s` `voice/config.py:187` `load_vad()`; `session_factory.py:125` `endpointing dynamic 0.24/0.55` `interruption vad 0/0.20 resume_true`; dynamic suffix `worker.py:353` `?!.।→0.18/0.36` conjunction→`0.55/0.75`; `worker.py:333` `INTERRUPT` DataChannel → `VoiceCall.tsx:522` `<audio>pause` <30ms; `speech_clean.py:50` backchannel suppress. |
| LLM/TTS streaming | Functional but incomplete | `session_factory.py:143` `preemptive_generation.enabled True` `preemptive_tts False` (disabled after replay bug `session_factory:115`); `speech_clean.py:72` `stream_clause_chunks 18/48/140`; `rag_pipeline.py:545` SSE streaming. |
| Provider-error recovery | Functional but incomplete | `worker.py:294` `session.on(error)` → `agent_unavailable(rate_limited|provider_busy)` DataChannel + spoken fallback; `voice_routes.py:109` health proxy 2s. **No automatic LLM failover**, 12s debounce. |
| RAG ingestion/hybrid search | Production-ready (search) / Functional (ingest) | `document_processor.py:450` semantic 90% + 512/50 fallback; `embedding_service.py:12` MiniLM 384; `sparse_encoder.py:17` BM25; `vector_store.py:168` hybrid prefetch 50+50 RRF `k=60` `vector_store.py:234` tenant+doc filter; CSV/XLSX 5k caps `processor:255`. |
| Citation integrity | Functional but incomplete | `rag_pipeline.py:82` allowlist IDs, `rag_pipeline.py:199` `CITATIONS MANDATORY [Source N.M]` forbids bare `1.1`; `output_filter.py:13` redacts `gsk_`; no eval measuring bypass. |
| Product/business doc scoping | Functional but incomplete | `db_models.py:38` `purpose rag\|agent` + `agent_enabled` + `source_snapshot_id` cascade `owner_routes.py:647`; `repositories/__init__.py:80` `selected_document_ids` narrowing only + `NoDocumentsSelected`. |
| Tool calling | Production-ready | `agent.py:439` 7 tools `check_availability`/`book_appointment`/`reschedule`/`cancel`/`list_bookings`/`leave_message`/`search_knowledge_base` adaptive 3/5 `agent.py:780` + `end_call` guard `agent.py:648`. |
| Background booking | Production-ready | `agent.py:477` `book_appointment` `publish booking_pending` → `_run_background_booking` `voice:{call_id}:{svc}:{date}:{time}` idempotent `agent.py:359` → `calendar_service.create_booking:178` → DataChannel `booking_confirmed/failed` + spoken confirm. |
| Calendar collision protection | Production-ready | `calendar_service.py:194` `transaction_lock calendar:{tenant}` `pg_advisory_xact_lock` `business.py:19` + cancelled-reactivate check `calendar_service:205` + collision `select BookingRecord` `calendar_service:312`. |
| Contact links | Functional but incomplete | `contacts.py:32` `token_urlsafe(32)` hash SHA256 `contacts.py:58` stored only, `contact_routes.py:392` `POST /contacts/open` public `10/min`, revoke `contact_routes:336` block `356` distinct `blocked_at` `db_models:132`. **Breaks QR multi-visitor** (next section). |
| Device binding | Functional (but wrong for QR) | `contacts.py:58` `derive_device_id(ua|salt)` hash[:32] (IP omitted), `contact_routes.py:431` `check_device` → refused, `461` `bound_device==None` claims. First device wins — blocks printed QR. |
| Public directory | Prototype | `directory_routes.py:89` `POST /connect` always **new** `source=directory` contact (fixed takeover bug), `GET /agents` `60s` `Cache-Control: public`. Stranger limits `DIRECTORY_SOURCE` 180s/10s. No moderation/report. |
| Transcript persistence | Production-ready | `db_models.py:414` `VoiceCallRecord(call_id PK, transcript JSON, transcript_source worker>browser, duration, summary_status waiting/pending/processing/ready/failed lease)` + `business.save_call` idempotent `business.py:53` + 15s checkpoint `worker.py:416` + browser `record_session` `voice_routes:617` `sendBeacon`. |
| Notifications | Functional but incomplete | `notification_service.py:7` `notify/list/mark_read` writes `NotificationRecord db_models:389`. **In-app only** — zero WhatsApp/SMS/email sending code. |
| File storage | Functional but incomplete | `storage.py:51` `LocalDiskStorage` vs `SupabaseStorage` pooled `httpx` `storage.py:138` selected `build_storage:209`. Defaults local unless `SUPABASE_URL+SERVICE_KEY` set. |
| Database config | Functional but incomplete | `database.py:47` `create_async_engine(settings.DATABASE_URL)` Postgres pooler `statement_cache_size=0` `database:35` + `Base.metadata.create_all` + `_ADDED_COLUMNS 30+` `database:63` + 5 indexes `database:139`. **No Alembic**. |
| Authentication | Production-ready | `session.py:46` HMAC-SHA256 cookie `compare_digest:98` `30d` `config:102`; `config:220` `SESSION_SECRET` required when not `DEBUG`; `auth.py:18` `verify_api_key` + `auth.py:28` `verify_internal_api_key` fails closed. |
| Tenant isolation | Production-ready | `identity.py:63` `resolve_identity` `owner:tenant` > `contact:id:tenant` (mismatch de-escalates `identity:109`) > BYOK `derive_tenant_id:34` > 401; every repo query filters `tenant_id`. |
| Rate limits | Functional but incomplete | `rate_limit.py:33` `rate_limit_key` per `owner:tenant/contact:id/demo:hash/ip`; `client_ip:20` honors XFF only if `TRUST_PROXY_HEADERS`; directory `5/min` `directory:131` + velocity `5/10min` `usage.py:93` `distinct_businesses_contacted`. Local `LIMITS_ENABLED=true` but live `backend/.env` shows `LIMITS_ENABLED=false` → all budgets zeroed `config:199` in that runtime. |
| Mobile UI | Functional but incomplete | `CallScreen` side-by-side→bottom sheet `t/[token]/CallScreen:601` + `env(safe-area-inset-bottom)` + drawer `OwnerShell:184` + `useCallQuality:58` stall 6s/14s + `VoiceSpectrum`. No 44px audit, no WCAG report. |
| Tests + builds | Functional but incomplete | `tsc --noEmit` **pass** 0 err; `next build` **pass** 18 routes; `py_compile` pass; `git diff --check` clean; tests: **8/9 pass 1 fail `test_voice_thinking_filler:64` 8w>3w** on isolated run; full suite 13 `ERROR` with `ValidationError GROQ_API_KEY` when run without env (expected, needs `backend/.env`), with env 354p/1f/1err prior. |

## 3. Safe verification — exact commands (read-only, secrets never printed)
| # | Command | Result | Failure reason if any | Code or env? |
|---|---|---|---|---|
|1|`git check-ignore -v backend/.env`|`.gitignore:7:backend/.env`|—|—|
|2|`git ls-files --error-unmatch backend/.env`|exit 1 `did not match any file(s) known to git`|not tracked|—|
|3|`git log --all -- backend/.env`|no output|never tracked|—|
|4|`git ls-files \| grep .env`|only `backend/.env.example`|—|—|
|5|`git diff --check`|no output (clean)|—|—|
|6|`python -m py_compile backend/app/main.py`|exit 0|—|—|
|7|`npx tsc --noEmit` (frontend)|exit 0, 0 errors|—|—|
|8|`npm run build` (frontend)|exit 0, 18 routes, `✓ Compiled successfully in ~9–10s`|—|—|
|9|`pytest tests/test_voice_thinking_filler.py -v`|8 pass 1 fail `test_the_filler_is_short:8w>3w filler.py:32`|phrase `I'm checking that now — please keep talking.`|code regression|
|10|`pytest backend -q` **without** env|13 collection ERROR `ValidationError GROQ_API_KEY missing` `config.py:17`|`Settings(GROQ_API_KEY required)`|env (needs `backend/.env`)|
|11|`pytest backend -q` **with** `backend/.env` (prior run 2026-09-08)|354 pass 1 fail same filler 1 err `Event loop is closed test_directory_workflow`|filler invariant + asyncpg teardown|code (filler) + infra |

## 4. Disputed claims — explicit re-verification
- **`.env` tracked?** No. `git check-ignore -v backend/.env → .gitignore:7:backend/.env`, `ls-files --error-unmatch` exit 1, `log --all -- backend/.env` empty. Prior "committed secrets/git history" false. Do not `git rm`/`history rewrite`.
- **Docker overrides Postgres with SQLite?** Yes, in compose. `docker-compose.yml:46` `environment: DATABASE_URL=sqlite+.../data/rag.db` **overrides** `env_file: ./backend/.env` (compose `environment` wins). Local `backend/.env` actually contains `DATABASE_URL=postgresql+asyncpg://...supabase...` + `LIMITS_ENABLED=false` — so local run uses Postgres but **any `docker compose up` deploy uses SQLite** on named volume `backend_data` (survives restart, lost on volume prune). Fix is removing that env override, not env file.
- **Uploaded files durable?** Only if `SUPABASE_URL+SERVICE_KEY` set → `SupabaseStorage`. Default `LocalDiskStorage` absolute root `storage.py:89`. `compose` mounts `backend_uploads:/app/uploads` (survives restart, not durable backup).
- **QR/public links multi-visitor?** No. `ContactRecord.bound_device:121` + `contacts.check_device` + `contact_routes:431` enforces first-device-wins. Printed QR → visitor #2 blocked `This link is already in use on another device`.
- **Notifications in-app only?** Yes. `notification_service.py` 20 lines, no WhatsApp/SMS/email sender. Only doc string mentioning WhatsApp in `contacts.py:8` is bearer warning.
- **WhatsApp/SMS/email delivery?** None. `grep -r whatsapp|sms|twilio` → 0 sender.
- **Reranker real?** No-op. `reranker.py:13` `return candidates[:top_k]`; `flashrank` in requirements unused.
- **Provider fallback automatic?** No. `worker.py:294` emits `agent_unavailable` but no model failover.
- **Voice telemetry stores p50/p95?** No. Only per-turn `logger.info [TURN]` `turn_metrics:68` + transient DataChannel `telemetry`; no DB/JSONL, no histogram.
- **Latency targets measured?** No. No p50/p95 evidence; only per-turn logs.
- **Bookings require verbal confirmation?** Tool `book_appointment` description `agent.py:476` says "after user confirms date and time" and code does `speak_booking_progress` then background create, but **no hard gate** verifying verbal "yes" token before `create_booking:178`.
- **RAG only when needed?** Guard exists: `agent.py:768` `if not _rag_enabled: return` + instruction "Call search_knowledge_base only when information needed" `agent.py:225`. When enabled, LLM decides per turn; not every turn.
- **Complete test suite passes?** No. Isolated single-file `pytest filler` → 1 fail `8w>3w` `filler.py:32`; full `pytest backend` without env → 13 collection errors `GROQ_API_KEY missing`; with env prior → 354p/1f/1err `Event loop is closed` `test_directory_workflow`. `tsc` pass, `next build` pass, `py_compile` pass, `git diff --check` pass.

## 5. Real reuse — component matrix (equal weight = transparent)
*18 components, weight=1 each (no hidden scaling). Classifications: Full=1.0, Half=0.5, None=0.*

| # | Component | Intake (book) | Business QR (desk) | Product QR (box/manual) | Shared? |
|---|---|---|---|---|---|
|1|Auth/HMAC sessions `session.py:46`|Full|Full|Full|Yes|
|2|Tenant isolation `identity.py:63`|Full|Full|Full|Yes|
|3|Contact links `contact_routes:392`|Half*|None†|Half*|No—needs rewrite|
|4|Device binding `contacts.py:58`|None‡|None‡|None‡|No—needs visitor mode|
|5|Public directory `directory:89`|Half|Half|None|—|
|6|Voice transport `worker.py:209`|Full|Full|Full|Yes|
|7|Sarvam STT `sarvam_stt:14`|Full|Full|Full|Yes|
|8|Sarvam TTS `sarvam_tts:32`|Full|Full|Full|Yes|
|9|Mistral LLM `voice/config:59`|Full|Full|Full|Yes|
|10|VAD/endpointing/barge-in `session_factory:125`|Full|Full|Full|Yes|
|11|Tool framework `agent.py:439`|Full|Full|Half|Yes|
|12|RAG ingestion/chunk `processor:450`|Full|Full|Full|Yes|
|13|Hybrid RRF `vector_store:234`|Full|Full|Full|Yes|
|14|Citation guardrails `rag_pipeline:199`|Full|Full|Full|Yes|
|15|Calendar collision `calendar:194`|Full|Full|None|Yes for intake/QR-B, no for product|
|16|Transcript+summary `db_models:414 business:53`|Full|Full|Full|Yes|
|17|Notifications `notification_service:7`|Half§|Half§|Half§|Yes (in-app)|
|18|File storage `storage.py:51`|Full|Full|Full|Yes|

*Half=usable as attribution/session but needs multi-visitor mode. †Business QR printed QR cannot reuse `bound_device`. ‡Block shared QR. §In-app only, no outbound.

**Calculation:** `score = (Full*1 + Half*0.5)/18`
- **Scribe Intake:** 13 Full + 4 Half = 15/18 = **83%** (Full counted 13, Half 4→2, total 15).
- **Business QR:** 12 Full + 4 Half = 14/18 = **78%** (loses one Full vs Intake because contact model must be replaced for unlimited anonymous visitors; directory still Half).
- **Product QR:** 11 Full + 4 Half = 13/18 = **72%** (loses calendar too; product needs SKU/serial model not bookings).
*Prior reports' 70%/72% within range but understated Intake; difference is transparent counting vs hidden weighting. Shared foundation is 11 Full components (the "Yes" column).*

## 6. Shared foundation — valuable regardless of winner
*Exclude clinic/product UI, QR standee, WhatsApp/SMS, telephony, billing, CRM, redesign, reranker without eval.*

| # | Item | P | Files | Reason | Deps | Acceptance | Risk | Effort |
|---|---|---|---|---|---|---|---|---|
|1|Fix `compose` SQLite override → Postgres-only gate|P0|`docker-compose.yml:46`, `config.py:117`, `database.py:47`|Deploys silently use SQLite not `backend/.env` Postgres; volume prune = loss|—| `compose config` shows no `DATABASE_URL` sqlite; `init_db` fails fast if `DATABASE_URL` not postgresql in prod|H|S|
|2|Add DB migrations (Alembic) replacing `_ADDED_COLUMNS` patch|P0|`database.py:63/139`, new `alembic/`| `create_all` never alters columns; alter silently no-ops|1| `alembic upgrade head` after fresh `init_db` equals head; `check` in CI|M|M|
|3|Public visitor session (multi-visitor) distinct from contacts|P0|`contacts.py`, `db_models.py:121`, `contact_routes.py:431`, `t/[token]/page.tsx:19`| `bound_device` blocks shared QR — QR=BROKEN|1| Same QR scanned from 5 devices → 5 distinct sessions, no block; existing `contact` links still single-device|H|M|
|4|Tenant+knowledge isolation audit + tests|P0|`vector_store.py:254`, `repositories/__init__.py:80`, `identity.py:63`| One leaked chunk/citation = breach|—| `selected_document_ids` + `tenant_id` filter tests pass; cross-tenant query returns 0|H|S|
|5|Rate limiting + daily budget enforcement verified|P0|`rate_limit.py:33`, `voice_routes:360`, `config:199`, `voice/config:220`| Live env has `LIMITS_ENABLED=false` → 0 caps|—| `POST /voice/token` 429 after `100/200` budget; `DIRECTORY` 3/sess/day 180s enforced in test|M|S|
|6|Consent + retention (opt-in + TTL)|P0|`db_models.py:73 ContactRecord`, `config:138 DOCUMENT_TTL`, `calendar_service`| Voice stores PII+transcript without visible consent/retention|3| Caller sees consent before booking; `DOCUMENT_TTL`/`VoiceCall` retention tested; no auto-delete without owner flag|M|S|
|7|Idempotent actions (booking already) harden + verify|P0|`calendar_service.py:178`, `agent.py:359`| Double-tap creates double booking if key missing|—| Two `voice:{call_id}:...` same key → one row; concurrent `transaction_lock` test passes|M|S|
|8|Provider-error handling hardened (no silent hang)|P0|`worker.py:294`, `agent.py:760`, `rag_client:97`, `routes.py:742` SSE|`LLM 429` currently degraded `agent_unavailable` but chat SSE can hang|—| Mid-stream LLM fail → SSE `{"error":...}` + `data:[DONE]` not hang; `rag_client timeout → []` tested|M|M|
|9|Text fallback guaranteed from same entry|P0|`t/[token]/page.tsx:19` `CallScreen` vs `CallerChat`, `business_routes:37`| Crowded room = voice unusable `BUSINESS_QR:198` 65% silent|3| `ended/error` CTA "Continue in chat"; `CallerChat` books same `create_booking` path|M|S|
|10|Storage durable gate (Supabase or explicit volume backup)|P1|`storage.py:209`, `compose` volumes| Local `uploads/` ephemerality breaks download/editor/image Q `storage.py:51` doc|1| Prod `build_storage()` warns loud if local; docs state single durable path|M|S|
|11|Voice telemetry durable + p50/p95|P1|`turn_metrics.py:68`, `worker.py:214`| Only logs+DataChannel, no histogram → targets unverifiable|—| `GET /voice/metrics` returns `p50/p95` 24h from JSONL/DB ring; `X-Request-ID` propagated|M|M|
|12|Mobile performance baseline|P1|`t/[token]/CallScreen:601`, `VoiceCall.tsx:438`| Under 800ms open `BUSINESS_QR:22` unproven without measure|11| Lighthouse mobile `t/[token]` ≥85 performance, 44px targets, `safe-area`|M|S|
|13|Evaluation harness (no reranker until eval)|P1|`rag_pipeline.py:82`, `vector_store.py:234`, `reranker.py:13` stub| RAG shipped with `0%` eval `reranker` stub|—| 60Q golden set stored + `pytest --eval` fails if recall<0.70 faith<0.90; reranker stays stub until eval passes|M|M|
|14|End-to-end tests (contacts→call→booking→inbox)|P1|`tests/` 26 files, `playwright.config`| Zero FE tests `package.json:24`; `test_directory_workflow` `Event loop closed` flake|6| Playwright 5 flows `setup→agent→token→CallScreen→chat→booking inbox`; `pytest -q` green in CI with `backend/.env`|M|M|

*All P0 together = the "shared" gate; P1 adds measurability. No WhatsApp/SMS/telephony/billing here.*

## 7. What not to build (shared phase)
Clinic-specific intake form, product/warranty schema, QR art generator, WhatsApp/SMS/email senders, PSTN/SIP numbers, billing/Stripe, CRM (HubSpot/Sheets), visual redesign, or `reranker.py:13` re-enable.

## 8. Safe implementation prompt — one shared milestone
Copy-paste for next agent. Preserves `.env`, no secrets, no `git rm/history`, tests + rollback, stops for review.

```
You are on shared-foundation milestone M0 — durable public session.
Root: D:\work\New folder . Do NOT modify PRODUCT_DIRECTION... or BUSINESS_QR... or application code beyond M0.
Do NOT delete/overwrite backend/.env, never print env values, never git rm or rewrite history, never rotate credentials, do not change docker-compose.yml DATABASE_URL yet (founder decides after M0).

Tasks (in order, test after each):
1) Create public visitor session distinct from Contact.
   - New model PublicVisitorSession (id, tenant_id, agent_id/snapshot_id, created_at, device_fingerprint optional) — do NOT reuse Contact.bound_device semantics. No bound_device block for visitors.
   - API POST /api/v1/public/session {handle or token, placement_tag?} → returns ephemeral session cookie/header distinct from contact cookie (e.g. scribe_public_session). Existing POST /contacts/open must stay single-device enforced.
   - Reuse existing identity resolver but add is_public_visitor flag derived from this cookie only.
2) Wire t/[token] to use visitor session when entry is public QR vs contact link. If public entry, mint visitor session without blocking subsequent visitors.
3) Verify isolation: two visitors from different UAs on same QR → two sessions, each sees only their own transcript; cross-tenant vector search still tenant-filtered vector_store.py:254.
4) Wire same booking + chat paths: visitor voice chat → search_knowledge_base rag_enabled guard agent.py:768 + post-voice transcript save_call business.py:53 + notifications in-app notification_service.py:7.
Acceptance: (a) pytest python -m pytest tests/test_contacts.py tests/test_visitor_session.py -v all green, filler invariant still respected (≤3w filler.py:32); (b) manual twice same QR different UA → both admitted, no "in use" block; (c) git status shows backend/.env untracked and untouched, git diff --check clean, tsc --noEmit 0, next build 18 routes; (d) no secret literal added to any tracked file (grep gsk_/eyJ).
Tests required: new tests/test_visitor_session.py covering multi-visitor admit, isolation, and no cross-contact reuse.
Rollback: feature-flag VISITOR_SESSION_ENABLED env default false; when false, /public/session returns 404 and old contact path is sole path. No DB migration beyond one additive table + index.
Stop after M0 and await founder review. Do not proceed to M1.
```
