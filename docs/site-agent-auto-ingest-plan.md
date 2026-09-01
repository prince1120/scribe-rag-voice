# Site-Link Auto Voice Agent — Plan

**Goal:** Owner pastes `https://example.com`, we crawl, extract sections, auto-create a voice+text assistant grounded on that site. Editable after. No manual document uploads.

## User Journey
1. `/agent` → `Add from website` button (next to `Add a document`)
2. Modal: `Site URL` + `Sections` checklist (auto-detected: `Home, Pricing, FAQ, Contact, Blog` etc) + `Depth: 1 level / 2 levels` 
3. `Create` → job crawls, chunk, ingest → `AgentDocuments` shows as `🌐 example.com/faq (12 sections)` grouped
4. Agent `voice_script/chat_script` auto-seeded from site title+description, owner edits in Studio
5. `Test` + `Deploy` as today

## Architecture
- **Crawler service** `backend/app/services/site_ingest.py` — `httpx` + `beautifulsoup4` + `readability` to extract main content per page, strip nav/footer, respect `robots.txt`, max `10 pages, 500KB each`, timeout `8s` per page.
- **Chunk & embed** reuse `document_processor.py` + `embedding_service.py` pipeline: each page = one document with `url`, `title`, `chunk_count`, `agent_enabled` (section-level enable/disable)
- **Auto prompt** `backend/app/services/site_prompt.py` — LLM (`gpt-oss-20b low reasoning`) summarizes site into `voice_script` (~120 words, human spoken) + `chat_script` (~200 words) with business name + category inferred.
- **API** `POST /api/v1/site/ingest {url, sections[], depth}` → `202 {job_id}` + `GET /api/v1/site/jobs/{id}` poll; reuses `repositories.py` DocumentRecord (add `source_url`, `site_job_id`)
- **UI** `frontend/app/agent/SiteIngestModal.tsx` — URL input, section picker, progress bar, error per-page, edit prompt inline.

## Data Model (additive, no migration break)
- `DocumentRecord.source` enum `upload|site` (default `upload`)
- `DocumentRecord.source_url`, `site_section` nullable
- `SiteJobRecord {id, tenant_id, url, status, pages[], error}` for polling

## Studio Integration
- `AgentDocuments` groups `🌐 Site` vs `📄 Upload` — per-section toggle `agent_enabled` already exists.
- Studio header shows `Synced from example.com · 12 sections · Refresh` button → re-crawl diff (add new, mark removed, keep edits).
- Mobile: modal full-screen bottom sheet, progress shimmer.

## Auto-end & Voice
- Site agent inherits current voice pipeline: `unknown STT + semantic + hi-IN mirror + aap + auto-end on bye` — no change.

## Security / Costs
- URL allowlist `https only`, block `localhost/private IP`, size cap prevents bill bomb.
- Per-tenant job cap `3 concurrent`, daily site ingest cap `5`.

## Phased Build
1. Crawler + chunk ingest (backend)
2. Modal UI + polling
3. Auto prompt seeding
4. Refresh diff + edit

## Open Decision
- Crawl sitemap if present vs link follow? Propose sitemap first, fallback follow.

