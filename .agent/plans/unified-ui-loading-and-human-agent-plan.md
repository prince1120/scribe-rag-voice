# Plan: Unified UI, Faster Loading, and High-Class Human-Like Agent Studio

**Date:** 2026-08-25 · **Status:** Draft → Implementation · **Author:** Muse Spark (with user images 1-4)
**Scope:** Fix visual mismatch (Image 1 Overview vs Images 2-4), eliminate dashboard loading jank, redesign Agent create/deploy/enable-disable so a non-technical owner gets accurate, human-sounding answers from a small model with minimal effort — while saving tokens and never dropping context.

---

## 1. Context & Problem Statement

### 1.1 What you showed (images)
- **Image 1 — `/dashboard` (Overview):** Stat cards beige/pink/blue/green hardcoded vs rail dark, spinner `Loading latest analytics...` + 3 skeleton rows visible too long. Counts are 0 but still loading.
- **Image 2 — `/agent` (Your AI Assistant):** Card `Your AI Assistant → Assistant Identity → Voice Calls/Text Chat → Voice Call Prompt & Script` with raw textarea containing `- HSM007 / HSG022: 750W...`. Save/Take Offline pill at top. Looks like settings form, not a studio.
- **Image 3 — `/links` (People & Calls):** `People & Call Management` centered header, single row `prince — 9 Completed Talks — DEVICE BOUND` with 4 buttons.
- **Image 4 — `/dashboard` vs `/agent` drift:** `Account & Business Profile` same card shell as Dashboard. Overall: 3 palettes live (warm Claude #F0EEE6, cool DS #f8fafc, owner dark rail #131418), 4 radius scales, 2 shadows, serif vs sans headings, skeleton vs spinner, inline hardcoded hex per card.

### 1.2 Stated goals
1. **UI matches other thing not good** → unify to one design system, professional, responsive on phone.
2. **Loading takes time** → dashboard+overview slow skeleton.
3. **Agent enable/disable & create/deploy** → owner should create a high-class, *more accurate* agent easily, without doing a lot.
4. **Agent works properly, sounds human, reposes like human, even on small model** → don't forget any context, save token, perfect accurate human-like response, real and act as owner wants.

### 1.3 Principles
- **One tokens file, zero hardcoded hex in pages.** Warm vs cool decision made once. Owner rail stays dark for focus, but cards/surfaces/controls use one light token set.
- **Progressive disclosure, not big forms.** Owner writes ~30 words, system compiles to 800-token optimized prompt.
- **Small model wins by giving it *less* but *better* context.** 3 perfectly ranked excerpts + 500-token curated history beats 4500 tokens of noise. Constrained decoding (`1-3 sentences`, `max_tokens 180-320`, `temperature 0.2`) is cheaper and more human than letting 8B ramble.
- **Don't drop context — compress it.** Summarize stale turns, keep salient facts, cache stable prefixes.
- **Measure tokens & accuracy, not just latency.** Log per-turn `input_tokens = prefix+context+history`, `output_tokens`, `citation_valid_rate`.

---

## 2. Discovery — Where we are (file:line)

### 2.1 UI — 3 palettes (proven)
- `frontend/app/globals.css:14` warm `--claude-bg:#F0EEE6` vs `frontend/app/styles/design-system.css:88` cool `--claude-bg:#f8fafc` which overrides via `@import` order. `frontend/app/components/landing/Landing.tsx:77` header `rgba(248,250,252,0.9)` cool on warm body.
- `frontend/app/styles/owner.css:8` `--owner-bg:#F7F7F5`, `--owner-accent:#4F46E5` vs inline `frontend/app/dashboard/page.tsx:205` hardcoded `background:#fdf2f8/#eff6ff` per stat card.
- Radii: DS `6/10/14/20` vs Landing `16` vs Signin `20/12` vs Dashboard `14/12/8`. Shadows: DS warm `rgba(60,52,38)` vs Owner cold `rgba(0,0,0,0.03)`.

### 2.2 Loading — why skeleton lingers (Image 1)
- **Frontend** `frontend/app/dashboard/page.tsx:113-141` `fetchOverview()` is `await ownerFetch("/api/v1/contacts/overview")` cold cache → `loading=true` → renders skeleton `287-302` (spinner + 3 rows). No `Suspense`, `"use client"`. Cache `frontend/app/lib/workspaceCache.ts:30 CACHE_TTL 60s` helps second visit, but first visit after sign-in `clearWorkspaceCache()` → empty → full wait. Plus 4 parallel fetches: `overview` + `usage` (`UsageCard.tsx:70`) + `workspace`+`agent` (`useWorkspace.ts:120`).
- **Backend** `backend/app/api/contact_routes.py:147-254` does 3 serial DB awaits (`list_contacts` → `get_agent` → `get_owner`), then `SELECT * FROM contact_sessions WHERE contact_id IN (...)` with **no LIMIT**, Python loops for `active_sessions_all`, `unique_names`, `conversations_this_week`, `voice_count`, sort — pagination is client-only `recentList.slice((page-1)*5, page*5)` (`dashboard/page.tsx:162`). No `COUNT(*)`/`GROUP BY` pushdown, no `Cache-Control`, proxy `frontend/app/api/v1/[...path]/route.ts:64 cache:"no-store"`. Owner mentions `cached_owner` single query measured 3.5s on pooler.

### 2.3 Agent create/deploy & enable/disable today
- `frontend/app/agent/page.tsx:35` `AgentConfig {name, greeting, voice_script, chat_script, voice_id, language, rag_enabled, style_rules_enabled, ...}`. `205 save()` `PUT /workspace/agent`, `264 deploy(live)` `POST /workspace/agent/{deploy|undeploy}` sets `status draft↔deployed`, `deployed_at`. `available_channels()` requires `has_prompt(channel) && (chat needs docs)`.
- `backend/app/services/owner_service.py:356 build_agent_prompt(script, agent_name, business_name, timezone, channel, style_rules)` appends identity if missing first 400 chars, appends `current_context_line(timezone): "It is Friday, ..."`, appends `prompt_rules.DELIVERY_RULES[channel]` if `style_rules_enabled`.
- `backend/app/services/prompt_rules.py:26 VOICE_DELIVERY` (`1-3 sentences`, contractions, at most one question, react one word, no markdown) and `63 CHAT_DELIVERY`.
- `frontend/app/agent/templates.ts:39` 7 category starters (`dental…`) with `voice_script/chat_script/greeting/sampleDoc`. Quick chips shown when `prompt.trim<40`.
- Deploy toggles voice+chat together; no per-channel deploy, no dry-run, no confidence score.

### 2.4 RAG & tokens today (why small model can fail)
- Chunk `512w overlap 50` + semantic split (`backend/app/services/document_processor.py:430`), hybrid dense `all-MiniLM-L6-v2` + sparse `Qdrant/bm25` + FlashRank `ms-marco-TinyBERT` rerank (`backend/app/services/*.py`). Chat: `final_top_k 10` → `limit max(3*top_k,20)=30` → rerank top 10 (`backend/app/api/routes.py:552-563`). Voice: `top_k 3 → limit 10` (`voice_routes.py:202`). Context `max_context_tokens 4500` (`rag_pipeline.py:75`), history `500 tokens / 4 turns` drop-oldest (`245`), per-voice excerpt `220 words` (`voice/agent.py:309`), `max_tokens` chat 800 / voice capped 200 styled or 450 unstyled (`voice/config.py:91`).
- Gaps: no prefix cache, no query-aware budget (short yes/no still sends 4500), no history summarization, no semantic answer cache, image 1024px always, no `COUNT` aggregates, 30-vector rerank heavy, time/context line resent every turn.

---

## 3. Plan — 4 tracks

### Track A — Design System Unification (fixes "not match other thing")
**Goal:** One light palette + dark rail for focus. No hardcoded hex in pages. All cards share one shell.

**A1. Tokens single source** `frontend/app/styles/design-system.css` stays canonical. `globals.css:14` warm re-declaration removed (or alias to DS values). `owner.css` keeps `--owner-rail` dark, but re-exports `--owner-bg/--owner-surface/--owner-border/--owner-text/--owner-muted` as aliases to `--claude-*` so owner cards inherit Landing/Setup/Signin. Remove hardcoded `rgba(248,250,252,0.9)` → `rgba(var(--claude-bg-rgb),0.9)`.

**A2. Card shell** New `.ds-card` (or reuse `agent-section`): `bg:var(--claude-surface) border:var(--claude-border) radius:var(--radius-lg) shadow:var(--shadow-sm) hover:var(--shadow-md)`. Dashboard stat cards replace inline `background:#fdf2f8` with `accent-soft` tints via token, not hex.

**A3. Header parity** Landing `Landing.tsx:73` header reused for `/setup` and `/signin` already, extend to owner: `OwnerShell` topbar on desktop gets same translucent header treatment or keep dark rail but make content header match Landing `font-serif-display`. Signin already fixed this sprint.

**A4. Skeleton parity** Use `design-system.css:186 .ds-skeleton` linear gradient + `1.6s shimmer` everywhere. Replace Dashboard `var(--claude-border)` bars + spin icon with `.ds-skeleton` + `ai-shimmer-bar`.

**A5. Radii/shadows/typescale lock** Enforce `14/10/6/9999`, shadow warm, `text-*` scale. Lint: `grep -r "#fdf"`
 fails CI.

### Track B — Loading Performance (fixes "loading takes time")
**Goal:** Skeleton <300ms p50 on cold, <0ms on warm (cache hit shows stale instantly).

**B1. Backend `/overview` pushdown + paging**
- `contact_routes.py:147-254` → `asyncio.gather(list_contacts, get_agent, get_owner)` in parallel.
- Replace Python loops with SQL: `SELECT COUNT(*) FILTER (WHERE real_talk)`, `COUNT(DISTINCT contact.name)`, `SELECT ... WHERE real_talk ORDER BY started_at DESC LIMIT 25 OFFSET :page*25` (add `page` param, default 0). Keep `recent` as 5 for dashboard first paint.
- Add index hint migration if missing: `CREATE INDEX IF NOT EXISTS ON contact_sessions(tenant_id, started_at DESC)`.
- Add `Cache-Control: public, max-age=10, stale-while-revalidate=30` on proxy or `Next fetch next:{revalidate:10}`.

**B2. Frontend cache & SWR**
- `dashboard/page.tsx:133-139` change to stale-while-revalidate: render cache immediately (`getWorkspaceCache()`), fetch in background (`revalidate: no loading` unless no cache). Use `SWR` or `useOverview` dedup hook. `ownerFetch` stays `no-store` on proxy but page fetch uses `SWR`.
- Deduplicate 4 fetches: `useWorkspace` already batches `workspace+agent`; move `usage` into same `Promise.all` or include `usage` in `overview` response (one JSON vs two DB queries).

**B3. Skeleton polish**
- Replace 3-row skeleton with DS skeleton that matches final card height, no spinner text flicker.

### Track C — Agent Studio UX: Enable/Disable + High-Class Without Effort
**Goal:** Non-technical owner does ~30 seconds of input → gets business-grade prompt + docs auto-shaped → toggle Live with confidence. No 8000-char textarea dread.

**C1. Studio layout refactor (fixes Image 2 "form" feel)**
- Top live bar `Assistant is Live / Draft` stays, but `Save Changes` becomes `Save draft` (secondary) vs `Go Live / Take offline` (primary, `status` driven). `page.tsx:449` deploy already does this; just surface per-channel readiness: `Voice ready ✓ / Needs greeting+script`, `Chat ready ✓ / Add a doc`.
- Replace single 8-row textarea `page.tsx:617` with **2-tab + guided blocks**:
  - `Assistant Identity` card (keep): Name + Greeting (with 1-click polish: "Make friendlier / more formal" micro-models via 8B itself).
  - **Voice Script builder** (when Voice tab active): structured fields that *compile* to `voice_script`, not raw prompt editing:
    1. *What you do* (chips from `templates.ts` duties + free text)
    2. *What you know* (doc excerpt chips: pick 3 FAQ bullets to ground — linked to `AgentDocuments.tsx`)
    3. *How you sound* (tone pills: `Friendly • Concise • Professional` → maps to `style_rules` + temperature)
  - Same for Chat. Raw textarea remains collapsed `Advanced → Edit prompt directly` for power users. Owner who never opens advanced still gets full prompt.
- Enable/disable: `Live` toggle is per-assistant (existing `deploy(live)`), but UI shows *why* not live: `chat_blocked_reason` / `voice_blocked_reason` from `GET /workspace/channels` (`owner_service.py:633`). Disable button when `!has_prompt` with tooltip `Write what your assistant should say`.

**C2. Zero-effort seeding**
- `setup/page.tsx` already seeds `voice_script/chat_script/sampleDoc` from category via `templateForCategory`. Extend: on `category` select, call `GET /workspace/templates/{category}` (or client `templates.ts`) to preview greeting+script live. On `businessName` + 1 doc upload, background call `POST /workspace/agent/autodraft` (new) → LLM 8B drafts `voice_script/chat_script` constrained by `BASE_VOICE_RULES + duties` + doc summary (30s, cached). Owner edits, not writes.

**C3. Docs as knowledge, not uploads**
- `AgentDocuments.tsx` caps 3 docs. Add *curate* step: after upload, show top 6 chunk previews with checkboxes (enabled/disabled already exists `agent_doc.is-off`), plus *Summarize this doc* button that shows how RAG will quote it (`[1.1]`). Token budget shown: `~X chunks • ~Y tokens`.

### Track D — Human-Like, Accurate, Token-Saving Engine (small model grade-up)
**Goal:** 8B sounds human, 70B not required; answers stay grounded; context never lost; tokens halved for voice.

**D1. Prompt compilation (owner writes little, system writes well)**
- `owner_service.build_agent_prompt` stays, but input `script` is now *compiled* from blocks, not freeform. Compilation:
  ```
  WHO YOU ARE: You are {name} for {business}
  WHAT YOU DO: {duties bullets}
  WHAT YOU KNOW: {doc excerpt pointers}
  CURRENT TIME: {Fri, 12 Aug...}  (keep)
  DELIVERY: {VOICE_DELIVERY or CHAT_DELIVERY if style_rules_enabled}
  ```
  `script` stays ≤800 chars structured → `VOICE_DELIVERY` caps at 200 tokens rather than owner paste of 750W spec sheet verbatim (Image 2 shows raw spec dump — model will parrot specs). Keep specs in *docs*, not prompt.

**D2. Human voice without token bloat**
- Keep `VOICE_DELIVERY 1-3 sentences, at most one question, no markdown, say numbers as spoken` (`prompt_rules.py`). Add voice-only micro-directives compiled per tone pill: `Friendly: use contractions, one soft filler max`. *Do not* add `THINKING_FILLERS` random list verbatim; instead let LLM generate one natural connector when `rag_enabled` wait >1s (existing `RAG_FILLER_PHRASES` stays as fallback).
- Model routing: Voice → `llama-3.1-8b-instant` (`voice/config.py:52`) with `temperature 0.2-0.3`, `max_tokens 180` (styled) / `320` (unstyled). Chat → `openai/gpt-oss-20b` default (`config.py:23`), rec asks upgrade to `70b` only if `rerank score < threshold` (low confidence).
- Post-process: `strip_markdown_for_speech` (`voice/agent.py:206`) kept, but *prevent* generation waste by adding to system prompt `Never use markdown` (already in VOICE_DELIVERY).

**D3. Context that never forgets, but stays cheap**
- Replace naive `drop oldest until 500 tokens` (`rag_pipeline.py:260`) with **salient + summary**:
  - Keep last `4 turns` verbatim (existing) + embed older turns → retrieve top 2 salient turns via `embedding_service` similarity to current query (tiny dense search over history).
  - Summarize remaining older into `80-token` stale summary via 8B summarizer (cached per conversation, updated every 5 turns). Budget: `500 = 200 (recent) + 120 (salient) + 80 (summary) + 100 reserve`.
  - Voice seeding `VOICE_HISTORY_MAX_MESSAGES 8` + same summary path.
- History is dual-written Redis+DB already; add `get_conversation_summary(tenant, conv_id)` cache.

**D4. Token saving that preserves accuracy**
- **Query-aware budget:** Classify query length: ≤8 words yes/no → `top_k 3` `max_context 800` `max_tokens 120`; 9-25 words → `top_k 5` `1500/250`; >25 or image → `top_k 10` `4500/500`. Implement in `routes.py:532` `final_top_k` branch.
- **Prefix cache:** Hash stable prefix `system_prompt head = agent_prompt + DELIVERY_RULES` (~400 tokens). Store in `cache.prompt_prefix_cache` LRU 128. On `generate_*`, if prefix hit and provider supports prompt caching (Groq does), attach via `prompt_cache_key`.
- **Semantic answer cache:** Key `(tenant_id, normalized_query, top_k, document_ids_hash, style_rules)` → `answer + citations` TTL 5 min for high-freq FAQs ("what are your hours"). Saves full `rerank + LLM` on repeat.
- **Rerank economy:** `limit max(top_k*2, 15)` not `*3,20` (audit suggestion) → ~30→15 vectors for chat top 10, reranker 15×512 tokens not 30.
- **Context cap per voice:** Already `3` excerpts `220w` each (~330 tokens) good — keep.
- **Image economy:** `max_images 3` but downscale to 512px if `!has_text_context` (question not about image).
- **Markdown not generated:** Already prevented for voice, saving ~5%.

**D5. Accuracy guardrails**
- Keep hierarchical `[N.M]` + `VALID CITATION IDS` + refusal sentence (`rag_pipeline.py:221`). Add confidence: if `reranker top score < 0.15` → answer `I don't have enough information in your documents...` without LLM call (save tokens).
- Log `citation_valid_rate` per tenant: `valid_ids used / total claims`.

---

## 4. Implementation Steps

### Phase 0 — Prep (no UI change)
- [ ] Add `CACHE_TTL`/`prompt_prefix_cache` in `backend/app/services/cache.py`.
- [ ] Regression test: capture 10 fixture (query, docs, agent config) → snapshot `system_prompt` + retrieved chunks before change.

### Phase 1 — Design tokens & skeletons (1-2 days, fixes mismatched UI)
- [ ] `frontend/app/styles/design-system.css` canonicalize: delete `globals.css:14-37` duplicate warm block, make `globals.css` alias to DS or delete DS override confusion.
- [ ] `frontend/app/styles/owner.css`: alias `--owner-bg/surface/border/text/muted` to `--claude-*`, keep only `--owner-rail` dark.
- [ ] `frontend/app/dashboard/page.tsx:205` replace hardcoded `background:#fdf2f8` per card with token tints (reuse `S.iconWrap` but derive from `var(--claude-accent-soft)` etc).
- [ ] `frontend/app/dashboard/page.tsx:287-302`, `links/page.tsx:453`, `agent/page.tsx:324` replace custom skeletons with `.ds-skeleton` + `ai-shimmer-bar`.
- [ ] Verify responsive polish already handles 360px nav squeeze.

### Phase 2 — Dashboard loading (1 day)
- [ ] `backend/app/api/contact_routes.py:147-254` parallelize `gather`, push counts to SQL, add `?page&limit`, add `Cache-Control`.
- [ ] `frontend/app/dashboard/page.tsx:113-141` implement SWR pattern: show cache instantly, background revalidate without `setLoading(true)` if cache hit, dedupe `usage` into overview payload.
- [ ] `frontend/app/api/v1/[...path]/route.ts:64` allow `next.revalidate` for owner paths (whitelist).

### Phase 3 — Agent Studio guided mode (2-3 days)
- [ ] `frontend/app/agent/page.tsx:479-743` refactor: keep `AgentConfig` shape, add `StudioMode: "guided"|"advanced"` toggle, new `GuidedVoiceBuilder.tsx`/`GuidedChatBuilder.tsx` that compile to `voice_script/chat_script` via `compileScript(blocks)`.
- [ ] `frontend/app/agent/templates.ts` expose `compileDuties(category, businessName)` helper.
- [ ] `backend/app/api/owner_routes.py:391-418` accept `autodraft` flag or new `POST /workspace/agent/autodraft` that drafts from docs.
- [ ] Show per-channel readiness from `GET /workspace/channels` on enable button.

### Phase 4 — Human-like + token engine (2-3 days)
- [ ] `backend/app/services/rag_pipeline.py:245-262` replace `_build_history` with salient+summary.
- [ ] `backend/app/api/routes.py:532-563` add query-aware `top_k/max_context/max_tokens` branch + prefix cache key + answer cache check + confidence gate + rerank limit `*2,15`.
- [ ] `backend/app/services/voice/config.py` confirm `VOICE_DELIVERY` temperature/cap; add `HUMAN_FILLER` selection via LLM not random list (optional).

### Phase 5 — Measure
- [ ] Log dashboard p50/p95 load (before ~800ms → after <300ms).
- [ ] Log per-turn `input_tokens = prefix(×cached)+context+history` for 20 real calls, `citation_valid_rate` target >0.95.

---

## 5. Risks & Mitigations
- **Cache invalidation on agent/doc update** — `repositories/__init__.py:31 _invalidate(tenant)` already does; extend to `prompt_prefix_cache` + `answer_cache` on `upsert_agent`/`save_document`.
- **History summary drift** — summary is advisory only; last 4 turns verbatim still sent, so core context not lost.
- **Small model hallucination** — confidence gate + top 3 reranked excerpts still cited; no LLM call when score low saves tokens and prevents hallucination.
- **Token budget mis-classification** — fallback to full `10/4500` if `query length` heuristic fails; safe default.

---

## 6. What we will demo
- `/dashboard` loads instantly on second visit (cache), first cold <400ms, no spinner text flicker, stat cards share one tint system with Overview/Assistant/People.
- `/agent` shows guided blocks; owner types 20 words, picks 2 doc bullets, hits `Go Live` → preview voice says spec accurately without reading whole sheet verbatim; Toggle live/offline shows reason if blocked.
- Voice call transcript shows 2-sentence human reply with contracted filler, cited ` [1.2]` when grounded, short when not; token log shows voice input ~600 vs prior ~4200.

---

## 7. Alternatives considered
- **Full dark owner theme everywhere** — rejected; Landing is light and converting; light cards test better for reading transcripts.
- **Single model for both channels** — rejected; voice needs 8B latency <600ms TTF, chat benefits from 20B reasoning; routing wins.
- **No RAG for small model** — rejected; docs are the product; better to give small model *less* perfect context than no context.

---

## 8. Open questions for you
1. Confirm palette keeper: keep warm Claude manuscript (`#F0EEE6`) or adopt cool slate (`#f8fafc`) everywhere? This plan adopts cool slate to match existing DS + Owner slate (least churn).
2. Keep rail dark or make entire console light? Plan keeps dark rail (focus) + light content.
3. Approve `answer cache TTL 5m` for repeat FAQs (privacy: per-tenant, not cross-tenant)?

**Next action:** On approval, start Phase 1 token cleanup (30 min) → Phase 2 dashboard parallelization (60 min) in same PR, then guided studio.
