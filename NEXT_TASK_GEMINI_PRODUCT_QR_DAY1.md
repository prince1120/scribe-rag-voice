# Next Task for Gemini 3.8 Flash — Product QR Validation Sprint, Days 1–2

Copy everything below into the Gemini task.

---

You are the market-validation research operator for Scribe's Product QR direction.

Repository: `D:\work\New folder`

Read these files completely before doing anything:

1. `PRODUCT_QR_VALIDATION_EXECUTION_PACK.md` — evidence rules and decision gates.
2. `MARKET_VALIDATION_DECISION.md` — selected Product QR wedge.
3. `TECHNICAL_REALITY_AND_SHARED_FOUNDATION.md` — verified technical boundary.
4. `PRODUCT_DIRECTION_AND_STAGE1_PLAN.md` — competing direction and unresolved risks.

## Coordination update

The M0.2 hybrid infrastructure milestone is complete:

- Docker infrastructure only: PostgreSQL, Redis, Qdrant, LiveKit.
- FastAPI, Next.js, and the voice worker run directly on Windows.
- Current scope is localhost browser voice/chat only.
- No phone, SIP, PSTN, Twilio, LAN-device access, or telephony.
- Worker admission now returns HTTP 503 when no healthy worker exists instead of issuing a silent LiveKit session.
- Do not modify infrastructure, application code, frontend code, Docker files, `.env` files, or existing strategy documents.

## Objective

Execute the research and preparation portion of Validation Days 1–2. Produce a verified target roster and a truthful demo-input pack. Do not claim that outreach, interviews, pilots, commitments, or customer validation occurred.

## Selected hypothesis

Target Indian D2C consumer hardware/appliance brands where customers need setup help, error-code troubleshooting, warranty guidance, or technician/service requests. Initial categories:

- kitchen appliances;
- water purifiers;
- residential EV chargers;
- solar inverters or adjacent home-energy hardware;
- other repairable consumer hardware only when the support use case is clearly stronger.

## Required research

Use current public web sources. Record the source URL and access date for every material fact.

### 1. Build a 30-brand qualified roster

For each brand, record:

- brand and legal/company name when publicly available;
- official website;
- product category;
- India operating evidence;
- approximate company stage/size only when supported by a source;
- public support channels;
- whether downloadable manuals or support documents exist;
- one example product/SKU;
- one observed support symptom, such as setup complexity, error codes, warranty registration, installation, filter replacement, or technician booking;
- likely economic-buyer role, not a guessed person's private contact details;
- public professional contact page or publicly listed business profile;
- qualification score from 0–5 using the rubric in `PRODUCT_QR_VALIDATION_EXECUTION_PACK.md`;
- inclusion/exclusion decision and reason;
- source URLs.

Do not invent ticket volumes, support costs, conversion rates, employee counts, email addresses, or willingness to pay. Mark unavailable facts as `Unknown — requires interview`.

### 2. Select the best five targets

Choose five brands using explicit scoring:

- clear repetitive support problem;
- public, text-searchable manual;
- repairable product with safe user-level troubleshooting;
- plausible access to a founder/support/operations decision maker;
- pilot can begin without ERP, SAP, factory-line, or deep CRM integration;
- low safety/liability risk for the initial demonstration.

Explain why each was chosen and the strongest disqualifying risk.

### 3. Select two public manuals for the demo

For each manual:

- use the official brand/domain source when available;
- record exact product and model;
- record PDF/document URL, document title, language, page count, and whether text is selectable;
- list ten realistic questions answerable directly from the document;
- list five out-of-scope or unsafe questions the assistant must refuse/escalate;
- list any error codes, maintenance schedules, warranty conditions, and technician-escalation points present in the document;
- explicitly flag copyright/licensing uncertainty. Public availability is not permission for commercial reuse.

Do not download or ingest a document when the website terms prohibit it. Do not bypass access controls.

### 4. Prepare—but do not fabricate—the evaluation sheet

Create a 30-question evaluation set across the two manuals:

- 16 grounded factual questions;
- 4 exact error-code questions;
- 4 multilingual/Hinglish variants;
- 3 deliberately unanswerable questions;
- 3 safety-sensitive questions.

For every question include:

- expected answer or expected abstention;
- exact supporting page/section when available;
- severity if answered incorrectly;
- pass criteria;
- result field left as `NOT RUN` unless you actually ran the local product and captured evidence.

If the local product is not running, do not start Docker or application services and do not mark tests as passed. Leave a precise founder-run command/checklist instead.

### 5. Prepare the outreach queue

Produce customized permission-first opening lines for the best five brands. These are drafts only.

Do not send email, LinkedIn messages, WhatsApp messages, forms, or any external communication. Do not claim a contact responded. The founder must approve and send outreach.

## Required output files

Create only these new files:

1. `validation/product_qr/BRAND_TARGET_ROSTER.md`
2. `validation/product_qr/BRAND_TARGET_ROSTER.csv`
3. `validation/product_qr/MANUAL_DEMO_INPUTS.md`
4. `validation/product_qr/PRODUCT_QR_EVAL_30.csv`
5. `validation/product_qr/FOUNDER_OUTREACH_QUEUE.md`
6. `validation/product_qr/DAY1_DAY2_EVIDENCE_REPORT.md`

Create the directories if absent. Do not edit any other file.

## Evidence labels

Every important statement must use one of:

- `VERIFIED — public source`
- `OBSERVED — repository/local test`
- `ASSUMPTION — interview required`
- `NOT RUN`
- `UNKNOWN`

Never use `validated`, `customer confirmed`, `production ready`, `safe`, `accurate`, or `pilot ready` unless direct evidence in this task supports the exact statement.

## Completion report

At completion report:

- files created;
- number of qualified, borderline, and rejected brands;
- five shortlisted brands;
- two selected manuals;
- source count and inaccessible sources;
- anything marked assumption or unknown;
- whether any local demo/evaluation was actually run;
- `git status --short` limited to the six authorized files;
- confirmation that no outreach was sent and no application/infrastructure file changed.

Stop after Days 1–2. Do not implement Product QR models, SKU routing, warranty registration, QR generation, public visitor sessions, ERP integration, or UI changes. M1 engineering is authorized only after the evidence gate: at least six completed discovery interviews, at least four qualified decision makers, at least two brands providing manuals, and at least one written Phase A commitment.
