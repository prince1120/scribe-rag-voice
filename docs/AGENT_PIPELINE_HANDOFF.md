# Scribe agent pipeline — handoff

Updated: 2026-10-05. Redesign implemented in source; not deployed or measured in a live call.

## Project

Scribe is a FastAPI/Python backend and Next.js/React frontend for business
assistants, document-grounded chat, LiveKit voice calls, customer links, and
Product QR support. SQLite is supported locally; PostgreSQL is used in production.
The voice worker is a separate process. Provider keys are encrypted server-side.
There are many pre-existing staged/unstaged edits; preserve them.

## User-approved design

- One LLM connection per agent, shared by voice and chat; separate prompts remain.
- New agents default to Sarvam LLM (`sarvam-105b-conversations`), STT (`saaras:v3`),
  and TTS (`bulbul:v3`). Users can choose another LLM.
- Settings owns the shared Sarvam/Groq keys. Custom LLM URL/model/key belong to
  the agent. Calls never ask owners to re-enter saved keys.
- Show masked keys, their source, models, and editing links on the Agent page.
- Save draft → test draft → publish. Draft edits must not change customer calls.
- Switching agents restores the complete configuration, including encrypted keys.
- Resolve model and matching key together. Never borrow another endpoint's key.
- Freeze credentials per call during startup; no secrets in dispatch metadata.
- Optimize measured startup/turn delays; do not promise zero latency.
- Keep changes efficient, use only relevant skills, avoid repeated broad reads.

## Implementation map

- `backend/app/services/owner_service.py`: shared runtime resolver, masked summary,
  draft editing, validation, publishing readiness.
- `backend/app/services/agent_configuration.py`: full config serialization and
  published configuration view.
- `backend/app/services/llm_connection.py`: endpoint validation, Sarvam defaults,
  and one connection verification implementation for testing and publishing.
- `backend/app/repositories/owners.py`: drafts, published snapshots, agent switching.
- `backend/app/models/db_models.py`, `backend/app/database.py`: additive migration
  list; existing installations require both model columns and migration entries.
- `backend/app/api/common.py`, `query_routes.py`: chat runtime selection.
- `backend/app/api/voice_routes.py`: token admission/routing, internal credentials.
- `backend/app/repositories/business.py`: encrypted call startup credentials,
  tenant-scoped retrieval, expiry and cleanup.
- `backend/app/services/voice/{worker,rag_client,config,registry}.py`: worker config,
  internal credential fetch, streaming provider assembly.
- `backend/app/api/product_qr_public_routes.py`: must use the same resolver for
  Product QR chat and voice.
- `frontend/app/agent/{page,ChannelModelPicker,AgentVoiceTest,AgentTest}.tsx`:
  owner editor, model/key controls, tests, publishing.
- `frontend/app/settings/page.tsx`: shared keys only; agent model selection lives
  on the Agent page.

## Current state

Implemented: shared resolver; canonical agent LLM columns;
published config storage; encrypted per-call keys; worker call-ID credential fetch;
Sarvam streaming LLM default; simplified model picker; masked connection summary;
Settings duplicate model fields removed; full snapshot restore draft logic;
Product QR and customer routes use published configuration; legacy custom keys
migrate on matching endpoints; publishing verifies the configured connection;
Settings supports replacing/removing shared keys; selected startup credentials
are cached briefly to avoid an extra database read.

Follow-up: Sarvam's API rejects retired `sarvam-30b` models. Agent LLM now has
a supported-model selector, a recommended-default action for legacy selections,
and a visible read-only automatic Sarvam endpoint. Connection verification gives
a specific retirement message before sending retired models. Existing saved or
published selections are not silently rewritten; save/test/publish the replacement.
Source: https://docs.sarvam.ai/api-reference/chat/chat-completions-v1

Voice model decision (2026-10-03): use `sarvam-105b-conversations` for both
default channel fallbacks. Voice factory, chat requests and connection tests
explicitly send `reasoning_effort: null`; voice already streams. Do not replace
this with `sarvam-30b` (retired), or claim the 105B variant is a small model.
Gemma 4 31B (`gemma4`) on Sarvam is smaller and non-reasoning, but beta with
per-key access and not specifically tuned for Indian languages; it is not the
production default. No latency benchmark or database model rewrite performed.
Sources: https://docs.sarvam.ai/api/getting-started/models/sarvam-105b and
https://docs.sarvam.ai/api/getting-started/models/openweight/gemma-4-31b

Operational follow-up: restart API and voice worker to load changes and additive
migrations. Confirm real microphone/audio flow and measure latency with configured
services. Existing unrelated lint errors remain. Preserve encryption secrets.

## Verification

From `backend`: `../venv/Scripts/python.exe -m pytest -q --tb=short`.
Python requires sandbox approval because its base installation is outside the
workspace. Tests isolate stores via `backend/tests/conftest.py`; do not run against
hosted infrastructure. Some old tests depend on earlier DB setup. The user asked
to avoid excessive testing: prefer targeted checks and do not repeatedly run suites.

From `frontend`: `npx.cmd tsc --noEmit`, `npm.cmd run lint`, `npm.cmd run build`.
Use `.cmd` wrappers because PowerShell script execution is disabled.

Baseline before redesign: 480 backend tests passed; TypeScript passed. Frontend
lint had 87 errors and 67 warnings before this work. Production frontend build
and TypeScript checks passed after the redesign, before the final small Settings
key-removal controls. Latest full backend run: 494 passed, one worker-admission
test failed because its fixture omitted the newly required internal service key.
The fixture now explicitly configures credentials and LiveKit; its targeted
recheck passed (1 test). The full suite was not repeated. Final Sarvam chat
reasoning configuration was reviewed without another test run.
`backend/tests/test_agent_pipeline.py` covers saved key routing, Sarvam defaults,
published isolation, encrypted call credentials, tenant isolation, switching,
legacy migration, endpoint validation and ignoring browser model/key overrides.
No live end-to-end voice latency or external deployment has been verified.

Manual Sarvam diagnosis: direct POSTs using the server key succeeded for both
supported models (HTTP 200 with text), with Bearer and subscription-key auth.
The configured database connection in the diagnostic shell failed with an
upstream tenant-not-found error; stored owner credentials could not be inspected.
The screenshot's retirement message was our local guard with the old saved
`sarvam-30b`, not a response from Sarvam for all models. The editor now upgrades
retired Sarvam draft selections on load, leaves initial/published config intact,
and asks to save/test/publish. Test results name the actual model tested.
Root and backend `.env` voice provider/model defaults were updated (authorized)
to Sarvam / conversational model; credentials and database settings preserved.
`backend/scripts/check_sarvam_connection.py --server-key --verify` tests the exact
application verifier without displaying credentials. Optional raw diagnostics
compare native and Bearer authentication with minimal requests.
Exact application verifier recheck: both `sarvam-105b-conversations` and
`sarvam-105b` passed using the server key. Frontend TypeScript recheck passed.

Customer-call follow-up: reproduced backend `/voice/voices` 200 vs frontend proxy
401. Frontend lacked `BACKEND_API_KEY`. Configured gitignored `.env.local` with
server-only backend origin/key; proxy now returns 200. `start_frontend.ps1` loads
the matching backend key using the existing env reader and uses npm.cmd.
Proxy maps backend service-key rejection to an actionable 503, preserving real
session 401s. The local hybrid database (launcher overrides the cloud env DSN)
contained draft conversational model but published retired 30B. Verified the
stored owner's Sarvam key via the application verifier, then changed ONLY the
published model/endpoint fields. Reread confirms draft and published now use
the supported conversational model; other published settings preserved. Worker
health reports available. This does not prove a microphone-to-speaker live call.

Mic/privacy/UI: device enumeration remains passive. Removed idle getUserMedia
preview; level meter samples ONLY the call's existing mic track and never stops
that shared track. The orb is decorative; only Start Voice Call initiates capture.
Setup content scrolls from its top when it overflows, with compact orb/padding;
customer channel tabs and call content share the viewport height. Retry button
and alert semantics added. Browser automation surfaces were unavailable, so no
visual browser screenshot or real microphone verification was performed.

## Booking, dialogs and voice prompt follow-up (2026-10-03)

- Shared `ModalPortal` moves owner dialogs to the body, above scrolled/transformed
  containers, with viewport bounds, focus trapping/restoration and body scroll lock.
  People & Calls, Calendar, Products and Agent dialogs use it; SiteAgentModal
  already had its own working portal. Removed redundant nested portal in Agent.
- Calendar now opens owner-only, tenant-scoped booking details: caller name/phone,
  full request, service, business/team, dates, created time, source and status.
  No individual staff assignment is fabricated. Legacy missing phone stays blank.
- Booking has nullable customer_name/customer_phone snapshots and additive
  migrations. Voice asks only for missing name/phone before booking; validates
  normalized 7-15 digits with optional international +, without guessing country.
  Manual API remains backward compatible; new fields are optional there.
- Booking workflow owns one brief acknowledgement and one actual result.
  StopResponse prevents the SDK's competing automatic model follow-up. Removed
  artificial delay; write runs alongside acknowledgement. Pending requests are
  deduplicated; existing DB locks/idempotency prevent slot collisions. Booking
  control packets update the caller banner, not duplicate assistant transcript.
  Availability tools read live DB; cancellation makes the slot available again.
- Both call screens synchronously stop microphone tracks on teardown, even if
  signalling fails. Capture checks room state and active-call identity around
  asynchronous processor loading/enabling, preventing setup from reviving an
  ended call. Fresh processor per track; imports remain lazy. Idle controls do
  not capture. Analyser resources are cleaned on teardown.
- Compact shared VOICE_DELIVERY plus VOICE_CALENDAR remove conflicting 'keep
  talking' advice. Natural, brief replies, one clarification at a time, corrections,
  language matching, verified actions, no repeated offers or fake human identity.
  Website/upload generation now caps voice prompts at 4500 chars; concise facts
  plus on-demand knowledge fallback enabled for newly created source agents.
  Existing owner scripts are preserved. Generation prefers workspace Sarvam key
  and conversational model with reasoning_effort=null; Groq fallback is async.
- Guidance: https://docs.livekit.io/agents/start/prompting/ and
  https://docs.vapi.ai/prompting-guide . No promise of zero latency or parity with
  another vendor; actual audio/provider timings still need a live call.
- Verification: 37 focused booking/prompt regressions passed; frontend TypeScript
  passed; diff whitespace check passed. Local hybrid DB name/phone columns verified
  ready. Browser automation surfaces unavailable: no visual or real microphone QA.

## Voice, source prompts and permanent sharing (2026-10-05)

- Shared speech rules allow restrained acknowledgements, hesitation and natural
  punctuation pauses, with calm emotional matching and clear names/prices/digits.
  Avoid repeated stutters, staged emotion tags and fake human identity. Bulbul
  infers delivery from text; no unsupported SSML/emotion API parameters were added.
- Source generation is now a deterministic compiler: zero generation LLM calls,
  both channel prompts embed the complete extracted source as JSON. Removed
  4k upload cuts, page text cuts, title/prefix-based deduplication, lossy summaries
  and creation-time fallback indexing. New source agents have RAG disabled;
  existing owner scripts/RAG settings are preserved. Missing extracted uploads
  fail visibly. 20,000-character prompt capacity returns 422 instead of silently
  cutting facts; owners must reduce larger sources explicitly. This covers only
  successfully extracted pages/document text, not inaccessible pages, images
  without extraction, or unlimited websites. Crawling still has its existing
  page/network limits. Edited previews remain owner-controlled.
- Stable system instructions precede the changing date/time and caller suffix
  in voice and chat, preserving the largest exact reusable prefix. Voice model
  metrics and chat usage log input/cached-input/output token counts without
  content or credentials. Streams tolerate usage-only chunks. Sarvam v1 does
  not document a cache-control/retention switch; do not send invented parameters
  or claim a guaranteed cache hit. Provider usage/billing must establish savings;
  SDK voice cached-token defaults can be zero when details are absent.
- `agent_addresses` is a new table created by normal init_db/create_all. Opaque
  link handles and unique eight-digit numeric codes belong to an agent snapshot
  (or the manual agent), separate from editable config. Allocation is locked,
  database-unique, bounded-retry and idempotent. Codes are public addresses, not
  authentication. Addresses stay reserved after deletion and are never reassigned.
  Inactive/draft agents cannot answer; their addresses cannot drift to another
  active agent. Existing workspace handles remain compatible workspace aliases.
  One published agent per workspace remains the supported architecture.
- Owner API: `/workspace/agents/{snapshot_id}/address`; existing
  `/workspace/directory-handle` returns the selected agent's handle and code.
  Public `/directory/agents/{address}` and `/directory/connect` resolve either
  code or handle and enforce publication/channel checks. Existing guest/session,
  tenant, velocity, duration and daily-budget admission remains. Documents are
  optional for prompt-based chat and sharing.
- Gallery Share / QR controls and Settings sharing panel use the same component,
  with local QR generation/download, copy feedback and stable `/link/{handle}`.
  Links open `/talk?agent={handle}`; `/talk` is public numeric-code entry, with
  optional name and voice/chat choices. Home and Directory link to the dialler.
  Existing customer session/call UI owns microphone consent and call startup.
  Internet/browser access is required; bookmark/home-screen access is suggested.
- Shared idle watcher asks once after 20 seconds of continuous inactivity (caps
  legacy longer metadata values), then gives 13 seconds after check-in playback
  to respond. Caller speech during or after the check-in resets it; the agent's
  own speech does not count as an answer. Speaking/thinking suppress idle nudges.
  Fixed the old watcher closure's missing nonlocal activity timer. No reply:
  spoken goodbye, client end packet, room disconnect and session close. Existing
  maximum-duration ceiling remains. Follow-up requests use the existing consented
  owner-message tool; this is not an automatic outbound callback/SMS service.
- Public rates checked 2026-10-05: STT Rs30/hour (Rs0.50/audio minute), Bulbul v3
  Rs30/10k characters, conversational LLM Rs29.28 input / Rs10.98 cached input /
  Rs73.20 output per million tokens. Formula: STT_seconds/120 + TTS_chars*0.003
  + uncached_input*0.00002928 + cached_input*0.00001098 + output*0.0000732,
  plus LiveKit/hosting/tax. E.g. 60 STT seconds + 300 TTS characters already cost
  Rs1.40 before LLM/hosting. Cached input is cheaper, not fewer transmitted
  tokens. Sub-Rs1/min is a target, not verified or guaranteed at these rates.
  Sources: https://docs.sarvam.ai/api/getting-started/pricing,
  https://docs.sarvam.ai/api-reference/chat/chat-completions-v1,
  https://docs.sarvam.ai/api/getting-started/models/bulbul.
- Verification: main focused regression run 46 passed; additional run 28 passed
  and one stale header assertion failed (updated to check actual delivery rules).
  TypeScript passed; new sharing/dialler ESLint passed. Final rechecks recorded
  below. Final prompt/identity recheck: 16 passed. Production frontend build
  passed, including TypeScript and /talk static output, after allowing the
  existing Google Fonts network fetch. No deployment, real microphone/audio measurement or billed cache hit
  has been verified. Restart API/worker to load code and create the address table.

## Per-agent offline pages and owner messages (2026-10-05)

- Every newly created source agent allocates its own permanent address/code;
  sharing another saved/duplicated agent allocates a separate identity once.
  Editing, publishing, disabling and switching never reassign that address.
  Legacy manual agents are archived into an actual snapshot on first sharing
  or before a new source agent replaces them. Existing manual addresses migrate
  to that snapshot without changing their handle/code. Earlier content remains
  available in the saved-agent gallery and can be activated again.
- Public lookup now returns known offline agents with `online:false` and the
  exact saved agent name, instead of returning an unavailable 404. Deleted or
  unknown identities still return 404. `/talk` offers calls/chat only when online;
  offline visitors see Agent offline and a message/contact form. Connect failures
  caused by a status change refresh the same agent's availability. No substitution
  with the newly selected workspace agent occurs.
- `/directory/agents/{address}/messages` saves an offline visitor's name, issue
  and reply contact directly into the existing tenant-scoped owner Inbox. The
  message includes the targeted agent name and code. No model call, microphone,
  guest session, outbound notification or callback promise is involved. Contact
  and request insert atomically, with per-workspace locks, retry idempotency,
  bounded/trimmed inputs, 3/minute IP admission and 100/workspace/day intake cap.
  An agent that became online returns 409 so the visitor can refresh and connect.
- New directory guest contacts bind to `agent_snapshot_id`; additive contacts
  column migration included. Link opening, chat prompt resolution and voice
  admission refuse a guest link when its original agent is no longer published
  and selected. A prior /t/ guest link cannot switch to a different agent even
  when the workspace changes between page lookup and call startup. Existing
  owner-created/legacy unbound links retain their prior workspace behavior.
- Verification: initial focused offline/address/directory checks 3 passed;
  frontend TypeScript and dialler lint passed. Final bound-session regression
  results: 26 passed; final dialler lint passed. API restart runs the additive contact migration.
  Real browser/microphone flow and deployment remain unverified.

## Site structure and UI correctness review (2026-10-05)

- Preserved earlier uncommitted voice/sharing changes. No wholesale page rewrite,
  dependency additions, provider changes, deployment or production data edits.
- Shared workspace revalidation now coalesces concurrent consumers and uses
  generation checks so old responses cannot restore signed-out data or replace
  local edits/new agent selections. Forced refresh invalidates pending response
  reuse. Either workspace or agent 401 clears cached owner data. Owner fetch
  compares credential identity privately in memory and invalidates response reuse
  when keys change; secret values never enter reusable response cache keys.
- Gallery selection now says Load in Studio, navigates to the editor, refreshes
  shared status/config and correctly describes draft restoration. It does not
  claim activation publishes an agent. Existing test/publish controls remain the
  only publishing flow. Removed stale generated-fallback-document claims, fixed
  the empty gallery creation link, added sorting and accessible search/refresh.
- Selected snapshots cannot be deleted: UI disables the action and backend
  performs a tenant-scoped conditional DELETE excluding the selected snapshot,
  returning 409 without cascading documents. Permanent addresses stay intact.
- Agent document deletion checks HTTP failure, retains its retryable dialog,
  prevents duplicate submissions and supports Escape. Uploads/toggles block
  overlapping operations; partial uploads refresh the actual document list and
  display sanitized errors. Upload keyboard controls also support Space.
- Personal document editor ignores superseded/closed-editor load responses.
  Save completion only updates its own editor and marks the submitted content
  saved, preserving newer unsaved edits. Document-list requests ignore responses
  after their session effect is cleaned up.
- Passcode gate starts checking on protected routes to avoid an initial content
  flash; privacy and terms are public entries.
- Verification: 9 standalone client regressions passed (`node --test
  tests/client-cache.test.cjs` from frontend); 18 focused backend tests passed
  (delete guard, pipeline, addresses); TypeScript and production build passed.
  Full lint baseline in this turn: 80 errors / 67 warnings, primarily existing
  React hook/ref patterns and loose types; this review does not claim a lint-clean
  repository. Browser inventory was empty, so visual responsive/browser/audio
  verification remains unavailable. API restart is needed for the deletion guard.

## Voice functionality review (2026-10-05)

- Added shared `useCallAttempt` startup cancellation/deduplication to personal
  VoiceCall, owner AgentVoiceTest, customer CallScreen and Product QR voice.
  Closing/unmounting cancels a pending token request; late responses cannot
  construct a room or start capture. Room/mic setup checks current attempt
  around async connection and processor loading. Teardown removes listeners
  before disconnect, stops microphone tracks synchronously and releases audio
  elements/analysers. Old room events cannot tear down a replacement call.
- Owner tests and Product QR voice now handle end-call/recovery packets and
  remote worker departure. Product QR supports interrupt cutoff/resume too.
  Retries reset mute/speaking status; failed mute/unmute operations stay visible
  instead of rejecting an unhandled event promise. Consent still precedes
  Product QR calls and no idle device control opens a microphone.
- Customer audio hooks use reactive active-room state, synchronize SDK device
  changes and rebuild the meter when microphone tracks change. Failed device
  switches retain the prior UI selection and show an error. Removed document-wide
  speaker routing: the SDK switches this room's output only.
- Hangup tool checks the latest caller intent in code; the model cannot close a
  call on its own. Explicit hang-up commands work; negated/quoted farewells,
  topic closers and information requests do not trigger hangup. Speech scheduling
  and playback for silence nudge/goodbye are bounded (10s maximum, nudge also
  bounded by remaining call time); stalled TTS cannot block the termination
  sequence forever. Existing 20s silence + 13s after-nudge grace remains.
- Verification: initial focused backend run 98 passed / 2 failed. Both failures
  were credential-test ASGITransport fixtures missing lifespan/database setup;
  corrected those fixtures and all 13 credential checks passed independently.
  Final silence/hangup checks 26 passed, including failed-speech scenarios.
  Six actual owner-startup/device client regressions passed; the nine previous
  cache/editor checks also passed. TypeScript, production build and targeted
  owner-test/new-hook lint passed. Existing unrelated lint errors remain.
  No real microphone, provider billing/latency measurement or deployment has
  been performed. Restart API/worker to load backend speech/hangup changes.

## Deployment prerequisites

API and worker must share `INTERNAL_API_KEY` and the correct backend URL. Preserve
`SESSION_SECRET`, which protects saved keys. LiveKit URL/key/secret are required.
`infra/Initialize-ProductionSecrets.ps1` already exists from prior edits; do not
run it or rotate existing secrets casually. Never store plaintext keys in this file.
