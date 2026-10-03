# Scribe agent pipeline — handoff

Updated: 2026-10-03. Redesign implemented in source; not deployed or measured in a live call.

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

## Deployment prerequisites

API and worker must share `INTERNAL_API_KEY` and the correct backend URL. Preserve
`SESSION_SECRET`, which protects saved keys. LiveKit URL/key/secret are required.
`infra/Initialize-ProductionSecrets.ps1` already exists from prior edits; do not
run it or rotate existing secrets casually. Never store plaintext keys in this file.
