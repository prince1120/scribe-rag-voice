# Scribe — Performance, Caching & Reliability Audit

Based on a read of the actual implementation on `feat/business-mode-agents` (commit `eb3bc5d`).
Every finding below cites the file and line it came from.

---

## 0. Architecture as it actually stands

```
Browser (Next 16 / React 19)
  └─ /api/v1/[...path]  Next route handler  (streaming proxy, injects BACKEND_API_KEY)
       └─ FastAPI (uvicorn, single process)
            ├─ module-level singletons in app/api/routes.py:43-69
            │    EmbeddingService (MiniLM, torch)  ← in-process
            │    SparseEncoder (fastembed BM25)    ← in-process
            │    Reranker (FlashRank ONNX)         ← in-process
            │    VectorStoreService → Qdrant (sync client + 2-thread pool)
            │    RAGPipeline → Groq / any OpenAI-compatible endpoint
            │    ConversationService → Redis (sync client) or in-memory dict
            ├─ SQLAlchemy async → SQLite or Supabase Postgres (pooler)
            ├─ Storage → Supabase Storage REST or local disk
            └─ cleanup loop (asyncio task)
  └─ LiveKit room
       └─ voice worker (separate detached process)
            ├─ Sarvam STT/TTS, Groq LLM, Silero VAD, turn detector
            └─ HTTP back to /api/v1/voice/retrieve + /voice/history
```

**There is currently no caching layer anywhere in the backend.** A grep for
`lru_cache`, `cachetools`, `TTLCache` across `backend/app/` returns nothing.
Redis is present but used for exactly one thing: conversation transcripts
(`conversation_service.py:113`). The only cache-like things in the codebase are
three ad-hoc ones: `identity._cached_real_owner_tenant` (never invalidated),
`worker_supervisor._last_seen_alive` (30 s trust window — this one is good),
and `storage.cached_path` for images (also good).

---

## 1. Blocking bugs — fix these before anything else

### 1.1 `POST /api/v1/query` is dead. Every call 500s.

**Problem.** `routes.py:503` passes `agent_prompt=overrides["agent_prompt"]` to
`rag_pipeline.generate_response`, but that method's signature
(`rag_pipeline.py:357-365`) has no `agent_prompt` parameter → `TypeError:
generate_response() got an unexpected keyword argument`. Even if the call site
were fixed, the method body at `rag_pipeline.py:387` references a bare
`agent_prompt` name that is never bound → `NameError`.

**Why it happens.** The per-channel agent prompt was added to the streaming path
(`generate_streaming_response` *does* have the parameter, line 446) and the
non-streaming twin was edited in the body but not in the signature. The two
methods are ~120 lines of duplicated prompt assembly, so a change to one does not
mechanically reach the other. No test covers `/query` — `test_channel_parity.py`
exercises prompts, not this route.

**Change.** Add `agent_prompt: Optional[str] = None` to `generate_response`.
Then, properly: extract the shared block (context build → history → system prompt
→ user prompt → messages) into one `_prepare_request(...)` helper that both
methods call. The duplication is the actual defect; the missing parameter is a
symptom.

**Improvement.** Restores a whole endpoint. Removes the class of bug entirely.

**Difficulty.** Trivial (1 line) / Small (30 min for the refactor).
**Priority: HIGH — this is a production outage on a documented endpoint.**

---

### 1.2 `POST /api/v1/directory/connect` lets anyone steal an existing contact's link

**Problem.** `directory_routes.py:28-74` is completely unauthenticated (no
`verify_api_key`, no identity, no `@limiter.limit`). It takes an
`owner_tenant_id` and a `name`, calls `get_active_contact_by_name`
(`repositories/__init__.py:188`), and if a contact with that name already exists
it calls `rotate_contact_token` and **returns the new plaintext token to the
caller** (line 56-60).

**Why it happens.** The endpoint was written for the "guest walks up to the public
directory" case, where reusing a contact keeps history unified. But name is not a
secret — `/directory/agents` publicly lists every deployed business, and contact
names are ordinary human names. Posting `{owner_tenant_id: "...", name: "Rahul"}`
returns a working invite link for whoever the real Rahul is, *and* invalidates
their existing link (rotate clears `bound_device` and `revoked_at`).

**Change.** Three things, all needed:
1. Never reuse a contact created outside the directory. Scope
   `get_active_contact_by_name` to rows whose `note` marks them directory-created,
   or better, add an explicit `source` column and match on `source='directory'`.
2. Never return a rotated token for a pre-existing contact — mint a *new* contact
   per directory visit and link them by a separate `person_id` if unified history
   is wanted.
3. Rate limit the endpoint (`@limiter.limit("5/minute")`) and add a captcha or
   proof-of-work if it stays public. As written it is also an unauthenticated
   unbounded row-insert into `contacts`.

**Improvement.** Closes an account-takeover path against every deployed business.

**Difficulty.** Medium. **Priority: HIGH (security).**

---

### 1.3 CORS is effectively open with credentials

**Problem.** `main.py:143-150` sets `allow_origin_regex=r"https?://.*"` together
with `allow_credentials=True`. The regex matches every origin on the internet, so
the carefully configured `CORS_ORIGINS` list is dead code.

**Why it happens.** Almost certainly added to unblock a local/tunnel dev setup and
never removed.

**Change.** Delete `allow_origin_regex`, or drive it from an env var that is empty
in production. Keep `CORS_ORIGINS` as the only allowlist.

**Improvement.** Any page the owner visits can currently read their workspace,
documents, contacts, and provider settings using their session cookie.

**Difficulty.** Trivial. **Priority: HIGH (security).**

---

### 1.4 Frontend ships another business's identity as a hardcoded default

**Problem.** `frontend/app/lib/workspaceCache.ts:29-36` initialises the module
cache with `businessName: "Shiro art and craft"`, `email: "shiro@mail.com"`,
`status: "deployed"`, `isBusiness: true`. The `useWorkspace()` hook falls back to
the same literals again at lines 136-140.

**Why it happens.** Test data left in as the "0 ms first render" placeholder.

**Change.** Initialise to `null`/`undefined` and render a skeleton until the first
revalidate lands. If a zero-flicker first paint matters, hydrate from
`localStorage` only.

**Improvement.** Right now every new user's console shows a stranger's business
name and email for the duration of the first fetch, and any user whose
`/api/v1/workspace` call fails sees it permanently. `status: "deployed"` also
makes a draft agent render as live.

**Difficulty.** Trivial. **Priority: HIGH.**

---

### 1.5 All owners share one rate-limit bucket

**Problem.** `rate_limit.py:33-48` returns the literal string `"owner"` for any
request carrying a valid session cookie — regardless of which tenant it belongs
to.

**Why it happens.** Written when the app had exactly one passcode-holding owner.
The multi-owner model (`owner:<tenant_id>` cookies, `identity.py:92-98`) landed
later and this function was not revisited.

**Change.** Parse the verified payload's `kind` and key on the tenant:
`f"owner:{tenant}"` / `f"contact:{contact_id}"`. `verify()` already returns the
payload — the tenant is right there.

**Improvement.** Today one busy tenant consumes the global 20 queries/minute and
every other customer gets 429s. This is a hard blocker on having more than a
couple of active tenants.

**Difficulty.** Small. **Priority: HIGH.**

---

### 1.6 `_cached_real_owner_tenant` is a permanent, process-wide, unkeyed cache

**Problem.** `identity.py:127-167` caches the "real owner tenant" in a module
global forever, and `get_identity` (line 186-189) silently rewrites *any* owner
identity whose tenant is `"default"` into that cached tenant.

**Why it happens.** A dev-mode convenience so dashboard queries find seeded data.

**Change.** Gate the whole block behind `if settings.DEBUG and not
settings.APP_ACCESS_PASSCODE:`, and give the cache a TTL. Better: delete it and
seed dev data under `OWNER_TENANT_ID` instead.

**Improvement.** In any deployment where the passcode is unset (which
`main.py:103` warns about but permits), an anonymous visitor is handed a real
registered business's tenant, with full owner rights over their documents and
contacts.

**Difficulty.** Small. **Priority: HIGH (security).**

---

### 1.7 Sync Redis client called directly from the event loop

**Problem.** `conversation_service.py` uses the synchronous `redis.Redis` client.
`routes.py:440` and `routes.py:579` call `get_conversation_history` directly in
`async def` handlers — no `run_in_threadpool`. `voice_routes.py:212` does the
same. The client is constructed with no `socket_timeout` or
`socket_connect_timeout` (`conversation_service.py:17-23`).

**Why it happens.** The service predates the async refactor; the health check at
`routes.py:233` *does* wrap `ping` in a threadpool, which shows the pattern was
known but not applied here.

**Change.** Switch to `redis.asyncio`, or at minimum wrap every call in
`run_in_threadpool` and set `socket_timeout=1.0, socket_connect_timeout=1.0,
retry_on_timeout=True`.

**Improvement.** Today a slow or hung Redis stalls the entire event loop — every
concurrent request, including health checks and voice tokens. With no timeout,
"hung" means indefinitely.

**Difficulty.** Small. **Priority: HIGH.**

---

### 1.8 Redis fallback is per-process and silently wrong under scale

**Problem.** When Redis is unreachable at construction (`conversation_service.py:27`),
the service flips to `self.memory_store = {}` for the life of the process, and
never retries. `use_redis` is decided once, at import time.

**Change.** Retry the connection lazily on each call (with a short backoff), and
treat the in-memory store as a per-request degradation, not a permanent mode.

**Improvement.** Today, a Redis blip during boot means conversation memory is
unbounded in-process memory (no TTL, no eviction — a leak) and inconsistent the
moment you run two workers.

**Difficulty.** Small. **Priority: MEDIUM.**

---

## 2. Where caching belongs, and which kind

Ranked by impact on the actual hot paths. The two hot paths are
**chat turn** (`/query/stream`) and **voice turn** (`/voice/token` +
`/voice/retrieve` per utterance).

### 2.1 Per-request config lookups on every chat turn — **in-process TTL cache**

**Problem.** `_chat_overrides` (`routes.py:123-171`) runs on every single chat
turn and issues **three sequential DB round trips**:
`get_agent` → `get_owner` → `resolve_credentials` (which calls `get_owner`
*again*, `owner_service.py:495`). Each opens its own session
(`repositories/__init__.py` — every function is its own `async with
async_session()`). `resolve_credentials` additionally runs 3 Fernet decryptions.

Against Supabase's pooler, `voice_routes.py:246-253` documents a measured **3.5 s
for a single trivial query**. Three of those, serialised, in front of the LLM
call.

**Change.** Add a small TTL cache module:

```python
# app/services/cache.py
class TTLCache:  # dict + monotonic timestamps, ~40 lines, no dependency
    def get_or_set(self, key, ttl, loader): ...
```

Cache `(agent, owner, resolved_credentials)` per `tenant_id` with a **30–60 s
TTL**, and invalidate explicitly on the writes that change them:
`save_agent_config`, `deploy_agent`, `undeploy_agent`, `delete_agent`,
`save_provider_settings`, `update_owner`, `choose_mode`.

Also: collapse the three lookups into one `asyncio.gather` on a cache miss, and
make `resolve_credentials` accept an already-fetched owner record instead of
re-querying.

**Improvement.** Removes ~3 serialised DB round trips (and 3 decryptions) from
every chat turn and every voice-token request. On the Supabase pooler this is
plausibly seconds off time-to-first-token.

**Difficulty.** Small–Medium. **Priority: HIGH — biggest latency win for the least work.**

---

### 2.2 Query embedding + sparse encode + rerank — **in-process LRU, keyed by query hash**

**Problem.** Every turn runs `embedding_service.encode_query` and
`sparse_encoder.encode_query` (`routes.py:588-591`) then a FlashRank cross-encoder
pass over ~30 candidates (`routes.py:610`). Repeated and near-repeated questions
("what are your hours?") pay full price every time. The `[timing]` logs already
in the code exist precisely because these were suspected.

**Change.**
- `EmbeddingService.encode_query` and `SparseEncoder.encode_query`: wrap in an
  LRU keyed on `sha1(query)`. These are pure functions of the text — the cache is
  always correct, needs no invalidation, and 512 entries is a few MB.
- Retrieval results: cache `(tenant_id, normalised_query, top_k, document_ids)` →
  reranked chunk list, **60–120 s TTL**, invalidated on document upload / edit /
  delete for that tenant. This skips embed + Qdrant + rerank entirely on a repeat.

**Improvement.** On a cache hit the entire retrieval stage collapses from
(2 model passes + 2 Qdrant round trips + 1 cross-encoder pass) to a dict lookup.
For a business FAQ agent, where callers ask the same handful of questions, hit
rates should be high.

**Difficulty.** Small (encoders) / Medium (retrieval, because of invalidation).
**Priority: HIGH.**

---

### 2.3 Voice retrieval per utterance — same cache, shared

**Problem.** `voice_routes.py:163-202` re-runs the identical pipeline on every
spoken turn, inside the pause between the caller finishing a sentence and the
assistant speaking. `agent.py:173-177` already speaks a filler phrase when this
takes >1 s, which is an admission that it regularly does.

**Change.** Route it through the same retrieval cache as 2.2 (the key already
includes `tenant_id` and `top_k`). Additionally: normalise the query (lowercase,
strip punctuation) before hashing, so "What are your hours" and "what are your
hours?" share an entry.

**Improvement.** Turns the filler phrase from routine into exceptional.
**Difficulty.** Free once 2.2 exists. **Priority: HIGH.**

---

### 2.4 Static catalogue endpoints — **HTTP cache headers**

**Problem.** `/voice/voices`, `/voice/languages`, `/voice/personas`
(`voice_routes.py:61-90`), `/workspace/models` (`owner_routes.py:365`), and
`/workspace/categories` (`owner_routes.py:87`) all return compile-time constants.
The Next proxy sets `cache-control: no-cache, no-transform` on **every** response
(`route.ts:104`), so the browser refetches them on every page mount. `agent/page.tsx:164-166`
fetches speakers + languages on each mount.

**Change.** Return `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`
from these routes, and stop the proxy overwriting `cache-control` when upstream
already set one (only force `no-cache` for `text/event-stream`).

**Improvement.** Removes 3–5 network round trips from every console page load.
**Difficulty.** Trivial. **Priority: MEDIUM.**

---

### 2.5 Public directory listing — **short-TTL server-side cache**

**Problem.** `list_deployed_agents` (`repositories/owners.py:223-253`) does a
join, then runs **one extra `SELECT` per deployed agent** to check for documents
(line 248) — a textbook N+1, on a **public unauthenticated endpoint**. It also
fetches all document ids and counts them in Python rather than using
`EXISTS`/`COUNT`.

**Change.** Replace the per-agent query with a single grouped query
(`SELECT tenant_id FROM documents WHERE tenant_id IN (...) GROUP BY tenant_id`),
and put the whole response behind a 60 s process-wide cache plus a
`Cache-Control: public, max-age=60` header.

**Improvement.** Turns an unauthenticated O(N) DB amplification into one query
served from memory. As written this endpoint is a free DoS lever.

**Difficulty.** Small. **Priority: MEDIUM–HIGH.**

---

### 2.6 Session/identity resolution — already good, leave it

`identity.resolve_identity` (`identity.py:55-123`) deliberately carries the tenant
inside the signed cookie so identity resolution needs **no database round trip**.
That is the right call and is well documented. Do not "improve" this by looking
the tenant up.

---

### 2.7 What to cache where — summary

| What | Cache type | TTL | Invalidate on |
|---|---|---|---|
| agent + owner + credentials per tenant | in-process TTL dict | 30–60 s | agent/provider/profile writes |
| `encode_query` (dense & sparse) | in-process LRU (512) | none needed | never (pure) |
| reranked retrieval results | in-process TTL, key incl. tenant | 60–120 s | doc upload/edit/delete |
| voice `/retrieve` | shares the above | — | — |
| voices/languages/personas/models/categories | HTTP `Cache-Control` | 1 h | deploy |
| `/directory/agents` | in-process TTL + HTTP | 60 s | — |
| decrypted secrets | in-process, inside the agent cache | 30–60 s | provider writes |
| conversation history | Redis (exists) | 24 h | — |
| document files for vision | disk (`storage.cached_path`) | — | — |

**Deliberately not Redis for the first four.** With a single-process API server,
in-process is faster and simpler. If you move to multiple uvicorn workers, promote
the retrieval cache to Redis (the embedding LRU should stay local — it is CPU
output, not shared state).

---

## 3. Unnecessary latency and repeated processing

### 3.1 `_enforce_document_cap` re-fetches the workspace and all documents on every upload
`routes.py:86-120` calls `get_or_create_workspace` (a DB read, sometimes a write)
then `list_documents` — both of which `_chat_overrides` will fetch again moments
later on the next turn. Solved by 2.1's cache.
**Difficulty: Trivial once the cache exists. Priority: LOW.**

### 3.2 `contact_transcript` loads every conversation and every message for the tenant
`contact_routes.py:321` calls `list_conversations`, which uses
`selectinload(ConversationRecord.messages)` (`repositories/__init__.py:143`) —
so reading **one** transcript pulls the tenant's entire chat history into memory,
then filters it in Python (line 322-324). It also calls `list_contact_sessions`
and scans in Python (line 314-315) rather than querying by `session_id`.

**Change.** Add `get_conversation(conversation_id, tenant_id)` and
`get_contact_session(session_id, contact_id)` repository functions with proper
`WHERE` clauses.
**Improvement.** O(all history) → O(1). This will fall over on the first
moderately active business. **Difficulty: Small. Priority: HIGH.**

### 3.3 `/contacts/overview` and `/contacts` load unbounded session rows
`contact_routes.py:198-208` selects every `ContactSessionRecord` for every contact,
with no `LIMIT`, then aggregates in Python. `contact_routes.py:139-150` does the
same to compute counts.

**Change.** Do the counting in SQL (`func.count()` with `GROUP BY contact_id`),
and `LIMIT` the `recent` list to ~50 in the query rather than returning all of it.
**Difficulty: Small. Priority: MEDIUM.**

### 3.4 The cleanup sweep is an N-network-call storm every hour
`cleanup.py:81-107` lists **all** documents, then calls `storage.exists()` per
record — and with Supabase that is an HTTP `HEAD` per document
(`storage.py:168-174`), each opening a **brand-new `httpx.AsyncClient`**
(no connection pooling, new TLS handshake every time). This runs at startup and
every `CLEANUP_INTERVAL_MINUTES`.

**Change.** (a) Use one module-level `httpx.AsyncClient` for `SupabaseStorage`
instead of constructing one per call — every method in that class does this.
(b) List the bucket once (`GET /object/list/{bucket}`) and diff in memory instead
of N HEADs. (c) Bound the sweep (process at most K per pass).
**Improvement.** Startup sweep goes from N round trips to 1. Also removes a
per-file TLS handshake from *every* document read and write.
**Difficulty: Small. Priority: MEDIUM–HIGH.**

### 3.5 Streaming DB writes bounce across threads with a 10 s blocking wait
`routes.py:652-667`: `_persist` runs in Starlette's threadpool and uses
`asyncio.run_coroutine_threadsafe(...).result(timeout=10)` — a **blocking** join
inside a streaming generator. The user's first token is behind
`_persist("user", ...)` at line 674.

**Change.** Fire-and-forget the user message (don't `.result()`), or move the
whole generator to `async def` so `StreamingResponse` drives it on the loop and
you can `await` the repository directly. The latter is cleaner and also lets you
drop the `loop` capture.
**Improvement.** Removes a DB write from in front of time-to-first-token.
**Difficulty: Medium. Priority: MEDIUM.**

### 3.6 Qdrant search thread pool is 2 workers, process-wide
`vector_store.py:38`: `ThreadPoolExecutor(max_workers=2)`. Hybrid search submits
2 tasks (`vector_store.py:215-216`), so **one concurrent query saturates it**. The
second concurrent user's dense and sparse queries serialise behind the first.

**Change.** `max_workers=min(32, 4 * expected_concurrency)` — at least 8. Better:
use `AsyncQdrantClient` and drop the executor entirely.
**Difficulty: Trivial (bump) / Medium (async client). Priority: MEDIUM–HIGH.**

### 3.7 Retrieval over-fetch is generous
`routes.py:602`: `limit=max(final_top_k * 3, 20)` with `RETRIEVAL_TOP_K=10` →
30 candidates through the cross-encoder every turn. FlashRank TinyBERT at 512
tokens × 30 pairs is the single largest CPU cost in the request.

**Change.** Drop to `max(top_k * 2, 15)` and measure against the `[timing] rerank`
log line you already emit. Voice already uses a tighter `max(top_k*3, 10)`
(`voice_routes.py:195`) for exactly this reason.
**Difficulty: Trivial. Priority: MEDIUM.**

### 3.8 Frontend re-renders the whole message list every 30 ms while streaming
`page.tsx:972-990`: a 30 ms `setInterval` calls `setMessages` with a fresh array
for the typewriter effect. In a 3379-line page component with a long transcript,
that is 33 full reconciliations per second.

**Change.** Move the streaming message into its own memoised component with local
state, or raise the interval to ~60 ms and only update when text actually changed.
**Difficulty: Medium. Priority: MEDIUM.**

---

## 4. Other reliability & production issues

### 4.1 No Alembic; schema migrations are a hand-maintained list
`database.py:63-96` uses `create_all` plus a manual `_ADDED_COLUMNS` list. Every
new column must be remembered here, and there is no way to change a type, add an
index, or backfill.
**Change.** Adopt Alembic now, while there is one entry in the list.
**Priority: MEDIUM (rises sharply with time).**

### 4.2 No database indexes are declared anywhere
Nothing in `db_models.py` or the repositories creates an index. Every query filters
on `tenant_id`, `owner_tenant_id`, `contact_id`, `conversation_id`, `token_hash`,
`email`, `started_at`. On Postgres these are sequential scans.
**Change.** Add `index=True` to those columns (and a composite on
`(tenant_id, created_at)` for documents, `(contact_id, started_at)` for sessions).
**Improvement.** Order-of-magnitude on every list endpoint as data grows.
**Difficulty: Small (plus the Alembic migration). Priority: HIGH.**

### 4.3 A Qdrant collection mismatch silently deletes all vectors
`vector_store.py:84-89`: if the existing collection is not hybrid, it calls
`delete_collection` at startup with only a log warning. A misconfigured
`QDRANT_COLLECTION_NAME` pointing at a legacy collection wipes it on boot.
**Change.** Refuse to start and require an explicit `--migrate` flag or env var.
**Priority: MEDIUM.**

### 4.4 Retry wrapper on the wrong method
`rag_pipeline.py:356` decorates `generate_response` with
`@retry(stop_after_attempt(3), wait_exponential(min=4, max=10))`. It retries
**everything** — including 400s, auth failures, and context-length errors — and
each retry re-does the full prompt build. `generate_streaming_response` has no
retry at all. Worst case: 3 × (10 s wait + full LLM call) on an error that will
never succeed.
**Change.** Retry only on `RateLimitError` / connection errors / 5xx, and wrap the
LLM call rather than the whole method.
**Difficulty: Small. Priority: MEDIUM.**

### 4.5 CSV and Excel ingestion is unbounded
`document_processor.py:259` emits **one chunk per row**, with no cap. A 200 k-row
CSV under the 50 MB limit produces 200 k chunks, 200 k embeddings
(`routes.py:296`), and one enormous Qdrant upsert (`routes.py:316` — a single
batch, no chunking). This will OOM the process.
**Change.** Cap rows (or group N rows per chunk), and batch the upsert in slices
of ~256 points.
**Difficulty: Small. Priority: MEDIUM–HIGH.**

### 4.6 Uploads buffer the entire file in memory
`routes.py:371-385` reads into a list of 1 MB slices then `b"".join(parts)` —
peak ~2× file size in RAM, per concurrent upload, on top of processing.
**Change.** Stream to a temp file (`spooled` above a threshold) and pass the path.
**Difficulty: Medium. Priority: MEDIUM.**

### 4.7 `chunk_index` collides across CSV/Excel and images
`document_processor.py:267` uses the pandas index; `_process_image` restarts at 0
per document. `assign_display_numbers` and `get_document_chunks`
(`vector_store.py:304`) both sort on it. Mixed-source documents can produce
duplicate or non-monotonic citation numbering.
**Priority: LOW.**

### 4.8 `/voice/record_session` has no `verify_api_key`
`voice_routes.py:547` — the only route in that router without it. It writes
transcripts attributed to `identity.tenant_id`, so it is not a data leak, but it
is an inconsistency and an unauthenticated-ish write path.
**Priority: LOW–MEDIUM.**

### 4.9 Single uvicorn process, torch + ONNX + fastembed all in-process
`main.py:180-187` runs one process. `routes.py:43-45` loads MiniLM (torch),
FlashRank (ONNX), and fastembed BM25 into it at import. Every CPU-bound retrieval
step contends with the event loop via the default threadpool (40 threads, but the
GIL still serialises the Python-side work).
**Change (staged).** Short term: `--workers N` will *not* work as-is — it
multiplies model memory N× and the in-process caches diverge. Medium term: split
retrieval (embed + search + rerank) into its own service or a
`ProcessPoolExecutor`, so the API process stays I/O-bound.
**Priority: MEDIUM (this is the scaling ceiling).**

### 4.10 Health check reports `healthy` while `/query` is broken
`routes.py:194-241` checks that the Groq client and tokenizer construct, which
they do. Nothing exercises a real path.
**Change.** Add a `/health/ready` that runs a tiny end-to-end retrieval.
**Priority: LOW–MEDIUM.**

### 4.11 `SESSION_SECRET` has a hardcoded default
`config.py:95` — `"scribe-default-session-secret-key-32bytes-long"`. The guard at
line 152 only fires when it is *empty*, which it never is. A deployment that sets
`APP_ACCESS_PASSCODE` but forgets `SESSION_SECRET` signs cookies with a value that
is in the git history.
**Change.** Default to `""` so the existing guard actually works.
**Difficulty: Trivial. Priority: HIGH (security).**

### 4.12 Contact PINs are stored in plaintext
`repositories/__init__.py:159` stores `pin=pin` raw; `contact_routes.py:423`
compares with `!=` (not constant-time). Tokens are correctly hashed — PINs should
be too.
**Priority: MEDIUM.**

---

## 5. What is already good — do not touch

These are deliberate, well-reasoned, and correct. Changing them will make things
worse.

- **Hybrid retrieval + RRF fusion + cross-encoder rerank** (`vector_store.py:160-244`,
  `reranker.py`). Dense and sparse run concurrently; RRF with k=60 is the right
  default; FlashRank over sentence-transformers' CrossEncoder is the right call on CPU.
- **Semantic chunking** (`document_processor.py:422-494`). Kamradt percentile method
  with neighbour buffering, oversized hard-split, undersized merged forward, and a
  clean fallback. Genuinely good.
- **Identity from signed cookies with the tenant inside the signature**
  (`identity.py`, `session.py`). No DB round trip, no client-supplied tenant. The
  `kind` prefix check that separates contact from owner is exactly right.
- **The voice worker's latency engineering.** Persistent `aiohttp` session
  (`rag_client.py:22-43`), prewarmed VAD (`worker.py:277`), parallel history fetch
  vs session build (`worker.py:202`), `session.say` instead of `generate_reply` for
  greetings (`worker.py:268`), the `_worker_alive` 30 s trust window
  (`worker_supervisor.py:45`), per-turn metrics (`turn_metrics.py`). This is the
  strongest part of the codebase.
- **`_should_search` backchannel filter** (`agent.py:71-83`) and
  `strip_markdown_for_speech` (`agent.py:104-118`). Both solve real problems that
  prompting alone does not.
- **`asyncio.gather` batching in `/voice/token`** (`voice_routes.py:254-268`) — the
  pattern that should be applied to `_chat_overrides`.
- **Secrets encrypted at rest with masked read-back** (`owner_service.py:412-444`).
- **Error handling discipline** — `logger.exception` + generic detail + request id
  (`main.py:112-133`, `routes.py:551-556`). Do not start returning `str(e)`.
- **Storage abstraction with path traversal guard** (`storage.py:84-91`) and the
  image `cached_path` design (`storage.py:206-237`).
- **The mid-stream error frame** (`routes.py:699-717`) — correctly recognises that
  raising after a 200 leaves the client hanging.
- **Cleanup's three-store ordering** (vectors → file → row, `cleanup.py:31-56`).

---

## 6. Missing for production readiness

1. **Alembic migrations** (§4.1).
2. **Database indexes** (§4.2).
3. **A caching layer** — none exists (§2).
4. **Horizontal scalability.** In-process model singletons + in-process
   conversation fallback + in-process caches mean `--workers > 1` is currently
   incorrect, not just wasteful (§4.9).
5. **Metrics/tracing.** Rich `[timing]` log lines exist but nothing aggregates
   them. No p50/p95, no error rate, no Prometheus endpoint. You cannot tell
   whether a change helped.
6. **Tests for the API layer.** 18 test files, none covering `/query` — which is
   why §1.1 shipped. Add route-level tests with the services faked.
7. **Backpressure / concurrency limits.** No semaphore around retrieval or LLM
   calls. Under load the threadpool queue grows without bound.
8. **Graceful degradation when Qdrant is down.** `_ensure_ready` raises
   (`vector_store.py:47`) → 500. Should return "I can't reach my documents right
   now" instead.
9. **Cost controls.** Per-tenant token accounting exists nowhere. A leaked invite
   link is capped by sessions/day, not tokens.
10. **Structured audit log** for contact link opens, rotations, and directory
    connects — needed to detect §1.2 being exploited.

---

## 7. Prioritized roadmap

### Phase 0 — this week (broken / exploitable)
| # | Item | Effort |
|---|---|---|
| 1 | Fix `generate_response` signature — `/query` is 500ing (§1.1) | 5 min |
| 2 | Remove `allow_origin_regex` from CORS (§1.3) | 5 min |
| 3 | `SESSION_SECRET` default → `""` (§4.11) | 5 min |
| 4 | Remove hardcoded "Shiro art and craft" from `workspaceCache.ts` (§1.4) | 10 min |
| 5 | Gate `_cached_real_owner_tenant` behind DEBUG (§1.6) | 30 min |
| 6 | Fix `/directory/connect` token-theft path + rate limit it (§1.2) | half day |
| 7 | Rate-limit key per tenant, not literal `"owner"` (§1.5) | 30 min |

### Phase 1 — next two weeks (latency + the obvious scaling walls)
| # | Item | Effort |
|---|---|---|
| 8 | `TTLCache` + cache agent/owner/credentials; gather the misses (§2.1) | 1 day |
| 9 | LRU on `encode_query` (dense + sparse) (§2.2) | 2 h |
| 10 | Redis: async client + timeouts, or threadpool-wrap every call (§1.7) | half day |
| 11 | Database indexes + adopt Alembic (§4.1, §4.2) | 1 day |
| 12 | Fix `contact_transcript` full-history scan (§3.2) | 2 h |
| 13 | Bump Qdrant executor to 8 workers (§3.6) | 5 min |
| 14 | One shared `httpx.AsyncClient` in `SupabaseStorage` (§3.4a) | 1 h |

### Phase 2 — the month after (throughput + robustness)
| # | Item | Effort |
|---|---|---|
| 15 | Retrieval result cache w/ invalidation, shared chat+voice (§2.2, §2.3) | 2 days |
| 16 | Cap CSV/Excel rows; batch Qdrant upserts (§4.5) | half day |
| 17 | Cleanup sweep: list-once instead of N HEADs (§3.4b) | half day |
| 18 | `Cache-Control` on static catalogues; stop proxy overwriting it (§2.4) | 2 h |
| 19 | `/directory/agents` N+1 → grouped query + 60 s cache (§2.5) | 2 h |
| 20 | Narrow the retry decorator to retryable errors (§4.4) | 2 h |
| 21 | Async streaming generator; drop the 10 s threadsafe join (§3.5) | 1 day |
| 22 | Route-level tests for `/query`, `/query/stream`, `/voice/token` | 2 days |

### Phase 3 — scaling
| # | Item | Effort |
|---|---|---|
| 23 | Split retrieval into its own service/process pool → enable `--workers` (§4.9) | 1 week |
| 24 | Promote the retrieval cache to Redis once multi-worker (§2.7) | 2 days |
| 25 | Prometheus metrics from the existing `[timing]` instrumentation (§6.5) | 2 days |
| 26 | Per-tenant token/cost accounting (§6.9) | 3 days |
| 27 | Graceful degradation when Qdrant is unavailable (§6.8) | 1 day |

**If you only do three things:** #1 (the endpoint is down), #6 (the link-theft
path), and #8 (the config cache — the single largest latency win available).
