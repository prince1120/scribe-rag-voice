# Scribe business release: continuation handoff

## User intent and constraints

Finish Scribe as a usable browser-based business AI voice/chat product with an investor-presentable owner/caller workflow. The user approved implementing a customer request inbox, reliable call summaries and session persistence, booking confirmations/hardening, and a good customer-facing UI. The user then asked to stop and give the next AI a continuation prompt because their usage limit was running out.

- NO telephony, phone-number provisioning, paid messaging, billing, or paid infrastructure. Customers talk over browser links through the existing LiveKit/Sarvam stack. Provider quotas still apply.
- Use the business's Mistral/OpenAI-compatible API key, base URL and selected model. Do not require Groq for summaries or charge an unrelated platform key.
- Preserve the existing visual system and personal workspace. Focus on working business outcomes with actual data; do not fabricate metrics or claim production readiness without verification.
- Demo video is explicitly for later. Do not create it now.
- Do not discard the dirty worktree. No commits, deployment, or external publishing have occurred.
- No subagents unless explicitly authorized by the user or applicable instructions.

## Environment

Workspace: `D:\work\New folder`, Windows/PowerShell.
Frontend: Next.js 16 / React 19, existing `frontend/node_modules`.
Backend: FastAPI / SQLAlchemy async, SQLite locally or Postgres, Qdrant, Redis; separate LiveKit voice worker.
Python launcher `venv/Scripts/python.exe` exists but executing it failed with Access is denied in this session. Locate a working interpreter or use the permitted escalation mechanism if required. Do not bypass a permission boundary.
Do not print `.env` secrets. Tests must use a temporary SQLite DB and mocks; don't run fixtures/cleanup against the user's configured database or spend real provider credits unintentionally.

## Changes implemented, but NOT fully verified

New backend files:

- `backend/app/repositories/business.py`: canonical call creation/save, scoped requests, paginated call/request listing, summary job leasing and completion. Uses PostgreSQL transaction advisory locks / SQLite BEGIN IMMEDIATE.
- `backend/app/services/business_calls.py`: bounded transcript request models, structured summary validation, public call serialization, OpenAI-compatible summary client, durable DB queue loop with 3 attempts and leases.
- `backend/app/api/business_routes.py`: owner request/call inbox endpoints, caller request submission, caller booking list, dedicated caller chat wrapper.

New tables in `backend/app/models/db_models.py`:

- `VoiceCallRecord` (`voice_calls`): server-issued UUID, tenant/contact/conversation, transcript/source, duration, completion, summary/status/attempts/tokens/lease.
- `BusinessRequestRecord` (`business_requests`): idempotent UUID, tenant/contact/call, message/reply contact, open/in_progress/resolved and private owner notes.
- `CalendarSettingsRecord` (`calendar_settings`): per-business IANA timezone. Defaults UTC to preserve previous booking instants. UI can explicitly set Asia/Kolkata.

Backend wiring and modifications:

- `main.py`: business router + summary-loop lifecycle.
- `models/schemas.py`: voice token response includes call_id.
- `api/voice_routes.py`: creates canonical call at token issuance, puts call_id in dispatch metadata; replaced uncommitted fake-quality-score analysis with idempotent `/voice/record_session` and scoped `/voice/calls/{call_id}` retrieval.
- `api/contact_routes.py`: legacy token transcript endpoint now requires caller cookie and canonical call ID, validates ownership and link usability.
- `services/voice/worker.py`: parses call_id; sets assistant contact_id/call_id; captures only committed new conversation items; checkpoints every 15 seconds; finalizes same call at shutdown/disconnect. This SDK behavior has NOT been tested live.
- `services/voice/agent.py`: inbox message tool requiring explicit caller request and contact details; contact scoping for cancellation/rescheduling; canonical booking idempotency key; timezone-aware booking creation; uses existing `_get_room()` for confirmation events.
- `services/calendar_service.py`: exact service matching instead of silent first-service fallback; future/business-hours availability checks; timezone conversion and DST rejection; transaction locking and idempotent create; reschedule checks; notification failure no longer turns committed booking into a reported failure.
- `api/calendar_routes.py`: timezone GET/PUT; full-week/valid-hour validation; idempotency header for create; UTC-aware API booking timestamps.
- `services/owner_service.py`: previously ignored mistral_key now maps to encrypted custom provider slot with `https://api.mistral.ai/v1` and `mistral-small-latest` defaults, unless custom settings are provided.
- `repositories/__init__.py`: contact deletion verifies tenant before deleting sessions; cleans new request/call data and canonical transcripts.

New frontend files:

- `/inbox` page: Requests / Call summaries tabs, status filters, paging, 15-second visible-tab refresh, private notes/status editor, transcript viewer, suggested follow-ups/unanswered questions, empty/loading/error states.
- `components/business/CallerActions.tsx`: own booking receipts and explicit leave-message form. No email/SMS is sent. Requests appear in owner inbox.
- `components/business/CallerChat.tsx`: dedicated cookie-authenticated customer chat with message retention on failure, markdown answer rendering, request form. Uses `/business/chat`.
- `components/business/CalendarTimezone.tsx`: saved IANA timezone control.
- `styles/business.css`: uses existing warm neutral/indigo tokens; responsive inbox and caller components.

Frontend integration:

- OwnerShell adds Inbox navigation.
- CallScreen: canonical call save/beacon, summary polling, honest saving/retry text, request form and bookings; clears recap state on new call; obsolete fake quality score removed. Its detailed telemetry UI is currently hidden by the showTelemetryDetails condition; review this implementation (no visible control to initially enable it).
- `/t/[token]/page.tsx`: all guest modes stay on the business surface; both mode has talk/type switch instead of redirecting to personal landing page.
- SessionGate skips owner passcode UI for public link/signin/directory surfaces; actual APIs retain auth.
- Calendar page: timezone control, timezone-aware display/reschedule input conversion.
- voiceEvents type supports unknown sentiment, suggested follow-up and unanswered questions.

## Verification performed and immediate blocker

Ran `frontend/node_modules/.bin/tsc.cmd --noEmit` in frontend. It FAILED with ONE reported error:

```
app/t/[token]/page.tsx(181,10): error TS2367:
This comparison appears to be unintentional because the types
'"error" | "opening" | "pin"' and '"ready"' have no overlap.
```

Cause: the new early `if (state === "ready") return ...` makes the old later JSX branch `{state === "ready" && mode !== "voice" && (...)}` unreachable. Remove the obsolete branch and re-run TypeScript.

Attempted `..\venv\Scripts\python.exe -m compileall -q app` in backend: launcher failed with Access is denied. No backend compilation/tests were run successfully. No new tests have yet been added. No frontend lint/build or browser QA has been completed. NO live calls were verified.

## Finish in priority order

1. Fix the TypeScript blocker, obtain a working permitted Python runtime, and perform import/compile checks. Review all patches, including correctness of apply_patch context matches.
2. Add meaningful isolated tests for the following, then fix failures:
   - Browser save + worker save + repeated beacon yield ONE conversation/session; worker snapshot wins; calls stay linked to the right caller rather than the latest session; empty calls; late writes after completion.
   - Caller A cannot read/update caller B's calls, bookings or requests. Revoked/expired/blocked links and token-without-PIN/session are refused. Owner request/status APIs reject pure contacts.
   - Request submission idempotency, bounded fields, daily cap, private notes, status transitions, scoped pagination, contact deletion isolation.
   - Summary lease recovery, bounded retries, invalid JSON, unavailable credentials, transcript revisions during analysis, no fake success/scores. Mock AsyncOpenAI and assert Mistral URL/key/model are used and no platform key fallback.
   - Two concurrent bookings of one slot allow only one. Idempotent repeat returns same record. Unknown service, wrong contact, past/closed/out-of-hours slots, timezone conversion, DST, reschedule ownership and notification failure.
3. Inspect/fix these known follow-up risks before calling this production-ready:
   - `api/voice_routes.py` AND existing `_chat_overrides` build calendar summaries with `s.name`/`s.duration_mins`, but `calendar_service.list_services()` returns dictionaries. This existed before this work and can break normal business calls/chat.
   - Voice token `has_custom_llm` check examines body/workspace base URL before per-channel config; verify a voice-channel-only Mistral endpoint works with no Groq key. Ensure model/key/URL precedence never sends the wrong provider's key. Existing provider-wide fallback behavior needs an isolation audit.
   - Summary provider is resolved from current owner/voice settings, not a per-call snapshot. Ensure channel-model/default-endpoint combinations are valid; never mix Groq model ID and Mistral URL. Consider provider snapshot metadata without storing plaintext secrets.
   - `save_call` currently allows new browser transcript revisions to reset summary_attempts. Bound revisions/finalization and abuse spend; avoid unlimited model calls from malicious edits. A late server correction should supersede a browser snapshot once. Worker is authoritative but a process crash can leave a checkpointed call incomplete; add stale-call recovery using durable heartbeat/timestamps, and ensure jobs do not overwrite newer transcripts.
   - Worker `conversation_item_added`/`item.text_content` and lifecycle callbacks must match installed LiveKit. Validate actual transcript capture, interrupted speech, checkpoint shutdown, and failure retry. Existing callbacks on disconnect can race. SDK import/live checks required.
   - `require_caller` currently accepts any identity with contact_id and verifies contact ownership. Existing identity combines owner and contact cookies. Verify owner testing their own link and two different businesses in one browser; do not grant owner privileges to a mismatched guest context.
   - `business_routes.caller_chat` delegates to existing query_documents. It creates a conversation before generation; review failure idempotency, chat-history ownership and session counters. Existing generic query endpoints retrieve history by supplied conversation ID; audit authorization before fetching history. Don't introduce a new cross-contact history leak.
   - CallerChat currently renders answers but not source citations; add usable citations or accurately avoid unresolved citation markers. It does not execute booking tools; copy says to use voice or leave a request for appointments.
   - Calendar list_bookings date filtering/reports still use UTC-day logic; convert to business timezone consistently. `_slots` zone is read before acquiring calendar lock; verify concurrent timezone changes. Unknown service now returns None instead of silently picking a service; adapt UX as needed.
   - Booking idempotency key is derived from call + slot. A retry after cancellation can return a cancelled record; the English tool reply reports status but the Hindi reply and confirmation event may still say booked. Ensure all paths reflect the actual database status. Reschedule/cancel tools should require explicit confirmation as well.
   - Frontend CallScreen needs obsolete telemetry block cleanup, correct save/summary statuses, and visible unavailable/pending summary copy after polling ends. Guard stale room callbacks from modifying a new call. Confirm request form and booking receipts fit mobile viewport and remain reachable during a call.
   - CallerActions reads bookings but does not show an initial loading state. Add sensible loading/empty/error and prevent a misleading "no bookings" before the fetch resolves. Its network timeout handling and idempotency after editing/retrying deserve tests.
   - AgentVoiceTest and general VoiceCall modal rely on worker persistence; verify canonical call lifecycle there too. No browser fallback was added to those components in this turn.
   - API/main still uses existing create_all/manual schema additions. New tables are additive, but proper versioned migration/backup validation is still outstanding. Do not apply migrations against user production data without review/backup.
4. Run frontend TypeScript, lint and production build; run backend targeted tests then existing relevant tests in a TEMP database. Do not claim all old tests are green without running them. Locate runtime through supported workspace dependencies if necessary.
5. Browser QA: desktop/mobile owner inbox, new request -> in_progress -> resolved, summary processing/failure/ready, caller link voice/chat/both, PIN access, booking receipt, text fallback. Mock external services only in an isolated local test environment and label mocks; do not put fake records into real workspace data.
6. With working configured providers, do one explicitly permitted end-to-end browser call to test actual voice, persistence, Mistral summary and booking. If credentials/environment or human microphone access prevent this, report it precisely; code checks are not live production certification.
7. Produce a concise release note and investor demo script (not a video): customer opens link -> asks real business question -> books OR leaves request -> owner sees real result in inbox -> owner resolves request. Use actual measured outcomes only.

## Worktree ownership

Before this turn the user already had uncommitted changes in:
`backend/app/api/voice_routes.py`, `services/voice/agent.py`, `domain/interfaces.py`, `speech_clean.py`, `turn_metrics.py`, `worker.py`, `docs/VOICE_ENGINE_ARCHITECTURE.md`, `frontend/app/VoiceCall.tsx`, `components/voice/voiceEvents.ts`, and `t/[token]/CallScreen.tsx`.

Some of those files were extended/reworked in this turn. Preserve unrelated existing voice performance work. Do not reset or restore the entire files from git. Inspect diffs before editing.

## Honest current status

Substantial backend/frontend implementation is present and uncommitted. It is unfinished and unverified, with the explicit TypeScript failure above. The next agent's job is to finish and validate this implementation, not restart the feature work or merely propose another roadmap.
