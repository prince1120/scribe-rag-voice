# PRODUCT QR VALIDATION EXECUTION PACK (Version 2.0 — Evidence-Safe)

> [!IMPORTANT]
> **This validation pack tests demand. It is not evidence that the Product QR features are already implemented.**
> All numerical baselines, market sizes, and operational savings listed below are unverified working hypotheses. Capabilities described as part of the future offering are subject to technical development, empirical benchmarking, and legal validation.

---

## 1. Evidence versus Assumption Matrix

Before undertaking outreach or discovery interviews, the founder must distinguish verified repository facts from unverified commercial assumptions:

| Claim / Hypothesis | Present Evidence Status | Evidence Source | Confidence | Experiment Needed | Strategic Decision Affected |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **"35%–55% of appliance support calls are routine manual/error questions"** | **Unverified hypothesis — validate during interviews.** | Aggregator marketing blogs & anecdotal industry claims. | **Low** | Discovery Interview Question 2 (Support ticket classification). | Core problem severity; if false, self-service troubleshooting has low value. |
| **"Consumers throw away or lose paper manuals within 14 days"** | **Unverified hypothesis — validate during interviews.** | Consumer behavior assumption; common anecdotal observation. | **Medium** | Discovery Interview Question 4 (Manual loss & registration rate). | Justifies placing the QR directly on product chassis vs relying on printed booklet. |
| **"Indian brands pay ₹35–₹70 per human voice ticket"** | **Unverified hypothesis — validate during interviews.** | BPO standard rate cards in Tier-1/2 cities; unverified for target brands. | **Low** | Discovery Interview Question 3 (Current support cost structure). | Sets pricing ceiling; software fee must be lower than displaced operational cost. |
| **"15%–25% of technician visits are false faults"** | **Unverified hypothesis — validate during interviews.** | Anecdotal service manager feedback. | **Low** | Discovery Interview Question 5 (False technician dispatches). | Technician triage value proposition; determines if booking triage is worth building. |
| **"D2C brands will pay ₹4,999/mo per SKU for a QR assistant"** | **Unverified hypothesis — validate during interviews.** | Pricing hypothesis formulated in Stage-1 planning. | **Low** | Pilot Closing Pitch & Pricing Discovery Questions. | Business model viability; determines whether product can sustain SaaS margins. |
| **"Sarvam Saaras & Bulbul handle mixed Hindi/English speech"** | **Implemented in repository — operational verification required.** | Present in repository (`sarvam_stt.py:14`, `sarvam_tts.py:32`); transcribes and synthesizes Hinglish audio. | **Medium** | End-to-end appliance terminology golden evaluation set. | Technical foundation for vernacular customer interaction. |
| **"Qdrant hybrid dense + sparse retrieval accurately cites source pages"** | **Implemented in repository — operational verification required.** | Present in `vector_store.py:234` (RRF k=60) and `rag_pipeline.py:199` (citation allowlisting). | **Medium** | Document-specific grounded-answer benchmark on appliance PDFs. | Defensibility against ungrounded troubleshooting advice. |
| **"System supports serialized product tracking & warranty registration"** | **Future engineering requirement.** | Architecture verified; database models and business logic currently absent. | **None (0%)** | Technical development Milestone M1 (after demand validation). | Scope boundary: must not be promised as live during initial demos. |

---

## 2. Ideal Customer Profile (ICP) & Disqualification Criteria

### 2.1 Target Enterprise Profile
* **Company Type:** Indian Consumer Hardware, Small Domestic Appliance (SDA), or Electrical Equipment Brands selling through D2C websites and marketplaces (Amazon.in, Flipkart, Blinkit).
* **Target Categories:**
  1. *Kitchen & Countertop Appliances:* Air fryers, induction cooktops, OTGs, digital blenders, espresso machines, bread makers.
  2. *Water & Environmental Tech:* RO/UV water purifiers, air purifiers, dehumidifiers, smart water heaters.
  3. *Clean Energy & Power Hardware:* Solar hybrid inverters, home UPS systems, EV residential AC chargers.
  4. *Personal Fitness & Health Hardware:* Motorized treadmills, smart exercise bikes, multi-node body massagers.
* **Stage & Scale:**
  * Annual Revenue: ₹10 Cr to ₹150 Cr *(Unverified hypothesis — validate during interviews.)*
  * Monthly Unit Volume: 1,500 to 20,000 units shipped per month across 3–10 active SKUs. *(Unverified hypothesis — validate during interviews.)*
  * Headcount: 20 to 180 employees.
  * In-house or outsourced support desk: 4 to 20 support agents fielding phone calls, emails, and marketplace messages. *(Unverified hypothesis — validate during interviews.)*

### 2.2 Customer-Support Symptoms (Validation Entry Signals)
* **High Repetitive Ticket Ratio:** Support teams anecdotally report significant time spent on basic setup questions (*"How to pair Wi-Fi"*, *"Initial water flush procedure"*) or standard error codes (*E01*, *E04*, beep patterns). *(Unverified hypothesis — validate during interviews.)*
* **Low Warranty Registration Rate:** Brands report that fewer than 15% of marketplace buyers register warranties, leaving them blind to customer contact info. *(Unverified hypothesis — validate during interviews.)*
* **Costly False-Fault Technician Dispatches:** Service heads report regular technician home visits for operational non-faults (e.g., unprimed pumps, loose plugs, dirty sensors), incurring unnecessary dispatch costs. *(Unverified hypothesis — validate during interviews.)*

### 2.3 Economic Buyer & Champion Personas
* **Primary Economic Buyer:** Founder / Co-Founder (in brands <₹50 Cr revenue); Head of Customer Support / VP Operations (in brands >₹50 Cr revenue).
* **Key Champion:** After-Sales Operations Manager / Service Network Lead.

### 2.4 Disqualifying Characteristics (DO NOT PITCH)
* ❌ **Conglomerates / Tier-1 MNCs (Samsung, LG, Philips, Havells, Bajaj):** 12–18 month enterprise procurement cycles, strict IT security reviews, enterprise SAP/Salesforce lock-in.
* ❌ **Unbranded Importers / White-Label Drop-Shippers:** Low-margin imported goods without localized manuals, brand accountability, or warranty infrastructure.
* ❌ **Commodity Low-Value Gadgets (<₹800 Retail Price):** Cables, basic chargers, USB hubs. Customer support cost per unit does not justify software spend.
* ❌ **High-Hazard Industrial Equipment (Gas geysers, high-voltage industrial switchgear):** Severe liability risk where DIY user troubleshooting could cause fire, explosion, or fatal electrocution.

---

## 3. Zero-Cost List-Building Method: Sourcing 30 Qualified Brands

The founder can build a targeted 30-brand pipeline without paid tools using public channels:

1. **Step 1: Amazon.in Category Scraping (Manual):**
   * Navigate to `Amazon.in -> Bestsellers -> Home & Kitchen -> Kitchen Appliances` and `Heating & Cooling Appliances`.
   * Identify Indian challenger brands with 200 to 3,000 reviews (e.g., Agaro, Lifelong, Inalsa, Atomberg, Livpure, Wipro Smart, Wonderchef, Green Soul, Borosil).
2. **Step 2: Support Reality Check (Manual Verification):**
   * Visit the brand’s official website. Check if they have a `/support` or `/downloads` section.
   * Verify they provide downloadable PDF user manuals and an official support telephone or email address.
   * Download 1 user manual (e.g., Digital Air Fryer or Water Purifier). Note down 2 common error codes (e.g., "E01: Sensor open circuit", "Filter Change Indicator").
3. **Step 3: Professional Contact Discovery (Zero Spam):**
   * Run targeted Google queries to find personal business profiles:
     * `site:linkedin.com/in ("Head of Customer Support" OR "Head of Customer Experience" OR "After Sales" OR "Founder") "BrandName"`
     * `site:linkedin.com/in ("Director of Operations" OR "Service Head" OR "Partnerships") "BrandName" India`
   * Check official D2C company listings, press releases, or MCA public filings for executive contact names.
4. **Strict Ethical Outreach Rule:**
   * **NEVER** send cold sales pitches to customer-support WhatsApp numbers, support email addresses (`support@brand.com`), or toll-free help lines. Those lines are reserved for paying consumers. Outreach must go strictly to business/executive contacts via LinkedIn, executive email, or professional networking channels.

### Seed Target Roster Structure

| # | Brand Name | Product Category | Downloadable Manual Found? | Target Contact Role | Contact Channel |
| :---: | :--- | :--- | :---: | :--- | :--- |
| 1 | *Brand Alpha* | Digital Air Fryers & OTGs | Yes (PDF on site) | Founder / Head of CX | LinkedIn / Professional Email |
| 2 | *Brand Beta* | RO & UV Water Purifiers | Yes (Warranty PDF) | Service Head / Operations Lead | Professional Email / LinkedIn |
| 3 | *Brand Gamma* | Residential EV Chargers | Yes (Installation Guide) | VP Operations / Partnerships | LinkedIn / Mutual Intro |
| 4 | *Brand Delta* | Smart Inverters & UPS | Yes (User Guide) | Customer Service Head | Professional Email |

---

## 4. Professional Outreach Variants (Permission-First, Zero Spam)

### 4.1 Founder Cold Email

**Subject:** `Question regarding [Brand Name] [Product Category] user manuals & after-sales support`

> Hi [First Name],
> 
> I noticed [Brand Name] is scaling rapidly in [Product Category, e.g., Countertop Appliances] with products like your [Specific Product Model].
> 
> We are conducting research with Indian consumer hardware founders on after-sales ticket drivers. Several operations leads have told us that a significant portion of tier-1 support tickets stem from misplaced paper manuals, routine setup confusion, or standard error codes.
> 
> We are developing an interactive Product QR concept: customers scan a QR on the appliance to ask questions in natural Hindi or English, receiving verified answers grounded directly in your official PDF manual, with options to register warranties or request service.
> 
> I tested your public [Product Model] manual against our retrieval prototype to see how accurately it cites error codes.
> 
> Would you be open to a brief 45-second screen recording showing how your manual performs?
> 
> Best regards,  
> [Founder Name]  
> Founder, Scribe  
> [LinkedIn Profile URL / Contact Details]

---

### 4.2 LinkedIn Direct Message / InMail (Under 400 Characters)

> Hi [First Name] — congratulations on [Brand Name]’s momentum in [Product Category].
> 
> We are studying post-purchase support bottlenecks for Indian appliance brands. We've built an interactive prototype where customers scan a QR on the product to troubleshoot errors in spoken Hindi/English directly from the official PDF manual.
> 
> I indexed your [Product Model] guide to test citation accuracy. May I share a 45-second demo video with you?

---

### 4.3 Warm-Introduction Request (Forwardable Email)

> Hi [Mutual Connection],
> 
> Could you connect me with [Target Name], who leads [Operations / Support / Product] at [Brand Name]?
> 
> We are researching after-sales support automation for Indian hardware brands. We have built an interactive Product QR prototype that lets consumers speak or type in natural Hindi or English to troubleshoot appliances directly from verified PDF manuals, deflecting basic inquiries before they turn into calls or technician dispatches.
> 
> I have already tested their public [Product Model] manual on our prototype and would value 10 minutes of their perspective on whether this addresses a real support pain point.
> 
> Thanks,  
> [Founder Name]

---

### 4.4 Multi-Touch Follow-Up Cadence

* **Day 2 Follow-Up (Value-Add Note):**
  > *"Hi [First Name], following up briefly. I noticed on your public marketplace listings that customers occasionally raise questions about [specific setup issue, e.g., first-time cleaning or E02 code]. If after-sales triage is on your roadmap this quarter, I'd welcome your feedback on our prototype teardown."*
* **Day 5 Follow-Up (Case Context):**
  > *"Hi [First Name], checking in. We are exploring a low-touch pilot with two hardware brands to test whether digital manual access reduces incoming support load. If this aligns with your team's goals, would you be open to a 10-minute feedback conversation this week?"*
* **Day 8 Follow-Up (Graceful Close-Out):**
  > *"Hi [First Name], assuming after-sales automation isn't a priority right now, I'll close out my follow-ups. If you ever want to explore interactive multilingual manuals or warranty triage, feel free to reach out. Wishing [Brand Name] continued growth."*

---

## 5. Non-Leading Discovery Interview Script (15 Minutes)

*Strict Rule:* Do NOT describe the proposed QR solution until Sections 1 through 6 have fully established the customer's current reality, pain severity, costs, authority, and attempted alternatives.

```
┌────────────────────────────────────────────────────────┐
│             DISCOVERY INTERVIEW PROTOCOL               │
│                                                        │
│   Part 1: Current Process & Channel Architecture       │
│   Part 2: Frequency & Top Ticket Drivers               │
│   Part 3: Cost Structure & Unit Economics              │
│   Part 4: Urgency & Operational Priorities             │
│   Part 5: Decision Authority & Stakeholders            │
│   Part 6: Attempted Alternatives & Past Failures       │
│   Part 7: Solution Exploration (Conditional Only)      │
└────────────────────────────────────────────────────────┘
```

### Questions

1. **Current Process:**  
   *"When a customer unboxes your appliance and encounters a problem, what are the primary paths they take to get help today?"*
2. **Frequency & Top Drivers:**  
   *"Across calls, emails, and messages, what are the top 3 specific questions or complaints your support team answers repeatedly?"*  
   *"What proportion of those questions are already answered in the printed user manual?"*
3. **Cost & Unit Economics:**  
   *"How does your business measure the cost of after-sales support—per call, per agent, or as a percentage of revenue?"*  
   *"When a customer requests a technician visit or replacement for an issue that turns out to be user error, what does that trip cost the brand?"*
4. **Urgency & Priorities:**  
   *"Where does reducing after-sales support costs or improving first-contact resolution rank among your operational priorities for this quarter?"*
5. **Authority & Stakeholders:**  
   *"If a solution demonstrated clear call deflection or captured customer warranty data, who inside the company evaluates, tests, and approves it?"*
6. **Attempted Alternatives:**  
   *"What have you already tried to solve this—such as YouTube setup videos, printed quick-start guides, WhatsApp chatbots, or website FAQs? What worked and what fell short?"*
7. **Solution Concept (Only introduced if high pain is confirmed):**  
   *"If a customer could scan a QR on the appliance and immediately receive verified troubleshooting in spoken Hindi or English directly from your manual, would that materially alter your support load, or would customers still call anyway?"*

---

## 6. Realistic Demo Script & Capability Tiering

### 6.1 Honest Capability Tiering Matrix

The founder must know exactly what is implemented versus what requires future engineering:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DEMO CAPABILITY TIERS                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ TIER 1: Implemented in repository — operational verification required       │
│   • Document ingestion via POST /api/v1/documents/upload                    │
│   • Hybrid dense/sparse Qdrant RRF retrieval with exact page citations      │
│   • Sarvam saaras:v3 STT (streaming Hindi/English speech-to-text)           │
│   • Sarvam bulbul:v3 TTS (streaming text-to-speech audio)                   │
│   • Mistral Small streaming with citation guardrails                        │
│   • Text chat fallback with markdown source badges                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ TIER 2: Future engineering requirement                                      │
│   • Serialized product QR tokens & SKU binding schema                       │
│   • Multi-visitor public session resolution without device lockout (M0)     │
│   • Digital warranty registration form & database persistence               │
│   • Technician service ticket dispatch schema & CRM push                    │
│   • Product/serial-specific analytics dashboard                             │
│   • Automated email, SMS, or WhatsApp outbound alerts                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ TIER 3: Founder-defined experimental threshold                              │
│   • Sub-800ms mobile page load (unmeasured on mobile 4G; requires audit)   │
│   • 1.4-second end-of-speech to audio response (waterfall variance exists)  │
│   • Grounded-answer precision target (must be evaluated empirically)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Step-by-Step 5-Minute Demonstration Flow

* **Minute 1: Context & Source Material:**  
  * Show the brand's official public PDF manual uploaded to `/api/v1/documents/upload`.  
  * State clearly: *"The assistant answers based on retrieved context from this verified manual."*
* **Minute 2: Spoken Vernacular Query (Tier 1 Implemented):**  
  * Trigger a voice turn in conversational Hinglish:  
    *"Air fryer screen pe E01 error aa raha hai aur beep ho raha hai. Kya karna chahiye?"*  
  * Demonstrate streaming response: Saaras STT -> Mistral RAG -> Bulbul TTS.
* **Minute 3: Grounded Answer & Citation Check (Tier 1 Implemented):**  
  * Highlight the source citation badge: `[Source: User Manual Page 12, Table 3]`.  
  * Show that the AI refrained from guessing and cited the exact manual section.
* **Minute 4: Explaining the Product QR Concept (Transparent Roadmap):**  
  * Transparently explain: *"Today, our core engine processes multilingual retrieval and voice. In Phase 1 of our product roadmap, we are adding serialized QR routing, warranty capture, and direct service ticket logging."*
* **Minute 5: Feedback & Next Step:**  
  * Ask: *"Does this citation accuracy match how your senior support agents would answer this error code?"*

---

## 7. Demo-Readiness Checklist (Pre-Flight Verification)

Before scheduling or recording any demo, the founder must execute this verification checklist on the local or staging environment:

- [ ] **Document Ingest:** Target PDF uploaded cleanly via `POST /api/v1/documents/upload` without parsing errors.
- [ ] **Retrieval Verification:** Run 5 test questions covering error codes, maintenance, and setup. Confirm top citations point to the exact pages.
- [ ] **Abstention Verification:** Ask 2 out-of-scope questions (e.g., *"How do I bake a cake?"* or *"Can I bypass the thermal fuse?"*). Confirm the system refuses to guess and cites absence of information.
- [ ] **Audio Stability:** LiveKit audio session connects cleanly with working mic and speaker streams.
- [ ] **Latency Sanity Check:** End-of-speech to audio output feels natural and conversational (no infinite spinning or timeout).
- [ ] **Zero False Claims:** Ensure the demo narrative does NOT promise live ERP integration, warranty database sync, sub-800ms mobile performance, or zero hallucinations.

---

## 8. Measurable Grounded-Answer Evaluation Framework

Replace claims of "zero hallucination" with this objective evaluation rubric. Test 30 domain-specific questions per brand manual:

| Metric Category | Definition | Target Threshold (Pilot Readiness) |
| :--- | :--- | :---: |
| **Answer Supported** | Response is completely grounded in retrieved text chunks with accurate page citations. | $\ge 85\%$ of test questions *(Founder-defined experimental threshold)* |
| **Answer Partially Supported** | Core instruction is correct, but minor general phrasing is added that does not conflict with manual. | $\le 10\%$ of test questions *(Founder-defined experimental threshold)* |
| **Unsupported / Hallucinated** | Response contains claims, steps, or numbers not present in the manual. | $\mathbf{0\%}$ on critical safety/electrical steps |
| **Proper Refusal (Abstention)** | Assistant correctly states it cannot verify unlisted information and recommends support. | $\ge 95\%$ of out-of-scope questions *(Founder-defined experimental threshold)* |
| **Unsafe Response** | Assistant recommends unauthorized chassis opening, wiring bypass, or hazardous tampering. | **Strictly 0% (Hard Gate)** |
| **Citation Accuracy** | Displayed page number and source excerpt accurately match the official PDF document. | $\ge 90\%$ of answers *(Founder-defined experimental threshold)* |

*Note on Retrieval Thresholds:* Universal cosine similarity cutoffs (such as 0.78) are scientifically invalid across diverse embedding spaces. Retrieval similarity, top-k parameters, and abstention cutoffs cannot be set globally; they must be calibrated per document collection using an evaluation set.

---

## 9. Pilot Operating Agreement & Phased Pilot Framework

To de-risk the trial, physical sticker printing is made completely optional:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PHASED PILOT ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ PHASE A: Internal Brand & Support Team Testing (Days 1–5)                   │
│   • Digital QR links and sandbox access for brand support leads.            │
│   • Evaluation of retrieval accuracy across 30 real customer call scenarios.│
│   • Zero consumer exposure; validates grounding and staff trust.            │
├─────────────────────────────────────────────────────────────────────────────┤
│ PHASE B: Controlled Customer / Service Unit Trial (Days 6–14)               │
│   • 10 to 20 customer interactions on return units or service center desks. │
│   • Digital QR cards or temporary adhesive labels.                          │
│   • Measure actual consumer self-resolution and vernacular voice usage.     │
├─────────────────────────────────────────────────────────────────────────────┤
│ PHASE C: Production Line Deployment (Future Milestone — Post-Pilot)         │
│   • Factory chassis sticker printing evaluated only after Phase A/B succeed.│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.1 Concise Pilot Operating Agreement

**Purpose:** This Agreement defines the operational framework for a 14-day design-partner evaluation of Scribe Product QR between Scribe ("Provider") and the brand ("Brand Partner").

#### 1. Brand Responsibilities
* Provide official digital PDF user manuals, installation guides, and warranty terms for 1 selected appliance SKU within 48 hours of execution.
* Supply a designated list of Top 10 customer inquiry scenarios and verified answers for evaluation benchmarking.
* Assign 1 designated point of contact (Head of Customer Experience or Service Lead) to complete Phase A evaluation testing (30 test queries).
* For Phase B (optional), facilitate 10 to 20 controlled customer or service-desk test interactions.

#### 2. Scribe Responsibilities
* Ingest and configure the supplied documentation in a private, tenant-isolated staging environment within 48 hours of receipt.
* Provide digital access links and test QR codes configured for Hindi and English voice/text retrieval.
* Deliver an objective Grounded-Answer Evaluation Report assessing retrieval accuracy and abstention behavior across the 30 benchmark queries.
* Maintain complete confidentiality of all non-public technical and operational documentation provided by the Brand.

#### 3. Proposed Privacy Controls (Subject to Legal & Technical Validation)
> [!WARNING]
> The following are proposed privacy controls requiring legal and technical validation—they are not verified current behavior in the codebase:
> * Automatic audio deletion following session completion.
> * Transcript anonymization scrubbing PII identifiers.
> * Automated safety blocklists and hazardous-query escalation.
> * Brand-specific STT glossary adaptation.
> Full compliance with India's Digital Personal Data Protection (DPDP) Act 2023 requires formal legal counsel and production audit prior to commercial release.

#### 4. Termination and Requested Data-Deletion Procedures
* Either party may terminate this pilot evaluation immediately upon written notice (via email or message) without cause or financial penalty.
* Upon termination or pilot conclusion, Scribe shall, within 48 hours of written request, execute complete deletion of all uploaded brand manuals, vector embeddings, customer session transcripts, and operational logs from its staging databases and persistent storage.

---

### 9.2 Written Phase A Commitment Template

```markdown
CONFIRMATION OF PHASE A DESIGN-PARTNER PILOT

Date: [Date]
Brand Partner: [Brand Name]
Brand Representative: [Name, Title]
Provider: Scribe (Represented by [Founder Name])

1. Scope: Brand Partner agrees to participate in Phase A internal testing of the Scribe Product QR assistant for SKU: [Product Model Name].
2. Testing Protocol: Brand Partner agrees to provide the official PDF manual and test 30 simulated customer inquiry scenarios using private digital links over a 5-day evaluation window.
3. Cost & Commercials: Phase A testing is conducted at zero financial charge. Neither party is bound to commercial terms or production sticker deployment.
4. Data Deletion: Scribe agrees to permanently delete all uploaded documentation and testing records within 48 hours upon written request.

Agreed by:
For Brand Partner: _______________________ (Signature / Email Confirmation)
For Scribe: ______________________________
```

---

## 10. Pricing Discovery & Validated Hypotheses

### Questions to Test Willingness to Pay
* *"How does your finance team currently evaluate the ROI of customer support software or BPO contracts?"*
* *"If this assistant demonstrably reduced your monthly phone ticket volume by 25%, what pricing structure would align best with your budgeting—a fixed monthly SaaS fee, or a per-unit fee tied to manufacturing volume?"*
* *"What is an example of a customer support tool you recently evaluated and rejected because of price?"*

### Three Pricing Hypotheses (For Exploration Only)
* **Hypothesis 1 (Subscription SaaS per SKU):** ₹3,999 to ₹5,999 / month per active appliance model. *(Unverified hypothesis — validate during interviews.)*  
  *Assumption:* Brand treats software as a predictable operating overhead similar to Shopify apps.
* **Hypothesis 2 (Per-Unit Manufacturing Fee):** ₹1.50 to ₹3.00 per unit shipped with a printed QR code. *(Unverified hypothesis — validate during interviews.)*  
  *Assumption:* Brand absorbs software directly into the bill of materials (BOM) packaging cost.
* **Hypothesis 3 (Pay-per-Resolved Outcome):** ₹12 to ₹20 per successfully resolved self-service session. *(Unverified hypothesis — validate during interviews.)*  
  *Assumption:* Brand only pays when a verifiable support ticket is deflected away from human agents.

---

## 11. Evidence-Based CRM & Discovery Tracker

Record all brand interactions in this structured matrix:

| Date | Target Brand | Contact Name & Title | Current Support Volume | Top Call Drivers | Measured Ticket Cost | Pilot Interest (1-5) | Main Objections Raised | Evidence Score (0-5) | Next Scheduled Action |
| :---: | :--- | :--- | :--- | :--- | :--- | :---: | :--- | :---: | :--- |
| *Ex* | *Apex Appliances* | *VP Operations* | *1,200 calls/mo* | *E01, Wi-Fi pairing* | *₹50 / call* | *4 / 5* | *"Need to verify Hindi accuracy"* | *3 / 5 (Sent manual)* | *Phase A staging demo (Thu)* |

### Objective Evidence Scoring Rubric
* **Score 0:** Rejection, no response, or explicit statement that support automation is not a priority.
* **Score 1:** Polite verbal interest (*"Great technology"*), but refuses to share data or schedule follow-up.
* **Score 2:** Completes 15-minute discovery interview and shares verified operational ticket data.
* **Score 3:** Provides official PDF user manual and top-10 complaint log for grounding testing.
* **Score 4:** Agrees to participate in Phase A internal testing with support staff.
* **Score 5:** Completes Phase B trial on 10+ live units and requests commercial pricing terms.

---

## 12. Strategic Decision Gates (Evidence-Driven)

```
                            30 TARGETED EXECUTIVE OUTREACHES
                                          │
            ┌─────────────────────────────┼─────────────────────────────┐
            ▼                             ▼                             ▼
   [GATE 1: PROCEED]             [GATE 2: AUDIT & REVISE]        [GATE 3: STOP PRODUCT QR]
   • ≥6 Discovery Calls          • Low response rate (<3 calls)  • ≥6 calls completed, but
   • At least 4 of 6 qualified   • Step: Audit messaging &       brands say: "Customers
     decision-maker interviews     channel; test new category      refuse QRs; call costs trivial"
   • ≥2 Brands Send Manuals      • Action: Re-run outreach       • Action: Stop Product QR work
   • ≥1 Phase A Pilot Agreement
   • Action: Build M1 Features
```

1. **Gate 1: PROCEED TO PHASE 1 DEVELOPMENT (Green Light)**
   * *Threshold:* $\ge 6$ completed discovery interviews with **at least 4 of 6 qualified decision-maker interviews** + $\ge 2$ brands provide PDF manuals + $\ge 1$ brand signs the Phase A commitment template.
   * *Action:* Authorize technical implementation of Product QR SKU routing and multi-visitor sessions.
2. **Gate 2: AUDIT & REVISE OUTREACH (Yellow Light)**
   * *Condition:* Fewer than 3 responses from 30 initial outreaches.
   * *Action:* **Do NOT kill the project.** Low response rate reflects messaging or channel mismatch. Audit the value proposition, switch from cold email to warm introductions or LinkedIn InMail, and test an adjacent hardware vertical (e.g., residential EV chargers or solar inverters).
3. **Gate 3: STOP PRODUCT QR INVESTMENT (Red Light)**
   * *Condition:* At least 6 discovery interviews completed, but brands consistently report:
     * Support costs are too low to justify software.
     * Customers overwhelmingly bypass self-service and demand telephone calls regardless of incentives.
     * After-sales support is on fixed-fee BPO contracts with zero marginal savings from call deflection.
   * *Action:* **Stop investment in the Product QR direction.** Do NOT delete or archive the repository. Preserve the underlying conversational RAG, Sarvam voice, and calendar infrastructure for other validated use cases.

---

## 13. Comprehensive Risk Register & Concrete Mitigations

| # | Risk Factor | Probability | Impact | Proposed Mitigation *(Requires Engineering / Validation)* |
| :-: | :--- | :---: | :---: | :--- |
| **R1** | **Customer Phone Bias** (Users ignore QR and call helpline) | High | High | Test prominent sticker messaging during Phase B: *"⚡ Instant Audio Help in Hindi & English (Zero wait time vs typical phone queue delays)"*. |
| **R2** | **Hallucinated Troubleshooting** (AI invents incorrect repair steps) | Med | Critical | Proposed abstention rule: When manual does not contain verifiable answer, assistant must state: *"This is not listed in the manual. Connecting to brand support."* |
| **R3** | **Unsafe Repair Advice Liability** (User opens live electrical chassis) | Low | Fatal | Proposed safety blocklists & hazardous-query escalation: Queries mentioning chassis tampering trigger warning: *"DANGER: High voltage hazard. Do not open casing. Schedule certified service."* |
| **R4** | **Fragmented or Scanned Manuals** (Poor PDF formatting degrades RAG) | High | Med | Require clean, text-searchable digital PDFs for Phase A onboarding; assist brand with manual re-formatting if needed. |
| **R5** | **Multilingual Dialect Confusion** (STT misinterprets technical terms) | Med | Med | Proposed brand-specific STT glossaries injected into context for accurate technical term transcription. |
| **R6** | **Weak Long-Term WtP** (Brand refuses to convert after pilot) | High | Critical | Quantify exact call deflection metrics during Phase B trial before quoting commercial software subscription. |

---

## 14. Seven-Day Manual Founder Action Plan

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          7-DAY VALIDATION SPRINT                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ DAY 1: Sourcing (Identify 30 Indian Appliance Brands & Public Manuals)      │
│ DAY 2: Grounding Sanity Check (Ingest 2 Manuals via /api/v1/documents/upload)│
│ DAY 3: First Outreach Wave (15 Emails + 15 LinkedIn InMails to Executives)  │
│ DAY 4: Discovery Interviews 1–2 & Day 2 Follow-Ups                          │
│ DAY 5: Discovery Interviews 3–5 & Present Phase A Pilot Framework           │
│ DAY 6: Day 5 Follow-Ups, Manual Testing, & Objection Analysis               │
│ DAY 7: Evaluate Decision Gates (Proceed / Audit & Revise / Stop Product QR) │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 15. Founder Safe Action Checklist (Current Product Only)

The founder can safely execute these operational actions today using **only the existing capabilities** in the repository:

- [ ] **Ingest Public Manuals:** Upload 2 publicly available appliance PDF manuals using the working endpoint: `POST /api/v1/documents/upload`.
- [ ] **Verify Citations:** Use existing text chat or voice worker on `localhost:8000` to test 10 realistic appliance troubleshooting queries.
- [ ] **Audit Grounding:** Confirm that citations display correct page numbers and that the assistant refuses to answer questions outside the manual.
- [ ] **Conduct Problem Discovery:** Execute 15-minute non-leading discovery interviews using Section 5 without promising unbuilt features.
- [ ] **Record Primary Evidence:** Log all customer operational data, ticket volumes, and objections in the Section 11 CRM Tracker.
- [ ] **Tally Decision Gates:** On Day 7, evaluate Gate 1, Gate 2, or Gate 3 based strictly on primary interview evidence.
