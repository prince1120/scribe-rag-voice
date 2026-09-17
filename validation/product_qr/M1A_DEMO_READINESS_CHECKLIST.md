# Milestone M1A — Product QR Demo Readiness & Verification Checklist

**Milestone:** M1A (Product QR Internal Web Demo Foundation)
**Status:** FULLY VERIFIED ON LOCAL DEMO
**Scope:** Browser-based text troubleshooting, grounded RAG citations, safety guardrails, WebRTC voice fallback, and multi-visitor link access.

---

## 1. Milestone M1A Implementation Summary

| Phase | Deliverable | Status | Verification Evidence |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Implementation Audit & Architecture Spec | COMPLETE | `validation/product_qr/M1A_IMPLEMENTATION_AUDIT.md` |
| **Phase 2** | DB Models & Feature Flag | COMPLETE | `backend/app/config.py` (`PRODUCT_QR_ENABLED=false`), `backend/app/models/db_models.py` (`ProductRecord`, `ProductDocumentRecord`, `ProductQrLinkRecord`, `ProductVisitorSessionRecord`), `backend/app/repositories/product_qr.py` |
| **Phase 3** | Owner Management APIs | COMPLETE | `backend/app/api/product_qr_owner_routes.py` (CRUD, document assignment, QR link generation & revocation) |
| **Phase 4** | Public Visitor Session & Entry | COMPLETE | `backend/app/api/product_qr_public_routes.py` (`/p/{token}/open`, HMAC-signed visitor cookie, no device lockout) |
| **Phase 5** | Grounded Document Scoping & Abstention | COMPLETE | RAG retrieval strictly scoped to product-assigned documents. Returns authoritative abstention if no matching chunks found. |
| **Phase 6** | Safety Guardrail & Hazard Escalation | COMPLETE | `backend/app/services/product_safety.py` (deterministic regex catching high voltage, thermal fuse bypass, gas leaks, pressure valves) |
| **Phase 7** | Owner & Consumer Web Interfaces | COMPLETE | `frontend/app/products/page.tsx`, `frontend/app/products/[productId]/page.tsx`, `frontend/app/p/[token]/page.tsx`, `OwnerShell.tsx` |
| **Phase 8** | Automated Test Suite | COMPLETE | `backend/tests/test_product_qr.py` (unit & integration tests) |
| **Phase 9** | Demo Readiness & Operator Guide | COMPLETE | This checklist |

---

## 2. Security, Isolation & Multi-Visitor Guarantees

1. **Feature Flag Default (`PRODUCT_QR_ENABLED=false`):**
   - When set to `false`, all `/api/v1/product-qr/*` endpoints return HTTP 404. Existing workspace and contact links (`/t/[token]`) operate without any behavioral change.
2. **Token Security:**
   - QR access tokens are returned in plaintext **only once** upon generation.
   - The database stores strictly `token_hash` (SHA-256 hex digest). Stolen database dumps cannot leak working QR tokens.
3. **No Device Lockout (Anti-Lockout Guarantee):**
   - Unlike private contact links that bind `Contact.bound_device`, physical Product QR links printed on boxes are scanned by thousands of independent consumers.
   - Each scan mints an isolated `ProductVisitorSessionRecord` and signs a dedicated `scribe_product_session` cookie. Multiple devices can scan the same link concurrently without device conflicts.
4. **Strict Document Isolation:**
   - Public chat cannot accept caller-specified `document_ids`. The backend strictly resolves document IDs assigned to the specific `product_id` and tenant.
5. **Deterministic Life-Safety Abstention:**
   - Hallucinated DIY repair on lethal hardware (microwaves, water heaters, 230V mains, gas lines) is blocked pre-generation with an authoritative safety warning directing users to authorized brand service technicians.

---

## 3. Local Operator Demo Walkthrough

### Step 1: Start the Local Product QR Demo
From the repository root in PowerShell:
```powershell
cd "D:\work\New folder"
.\start_product_demo.ps1
```
This enables Product QR only for the launched demo process. Docker runs PostgreSQL, Redis, Qdrant, and LiveKit; backend and frontend run directly on Windows. Verify ports `55432`, `6479`, `6433`, `7880`, `8000`, and `3100`. Navigate to `http://127.0.0.1:3100`.

### Step 4: Register Demo Hardware SKU
1. Log in to the Owner Console (`http://127.0.0.1:3100/signin`).
2. Open **Products & QRs** in the sidebar (`http://127.0.0.1:3100/products`).
3. Click **Register Product** and fill in:
   - **Product Title:** `PureFlow Pro RO+UV Purifier`
   - **Model Number:** `PF-RO-700`
   - **Category:** `Water Purifier`
   - **Description:** `7-stage residential water purifier with mineral booster and TDS controller.`
4. Click **Register Product**.

### Step 5: Assign Support Documentation
1. Click on the registered product to enter its detail view (`/products/[productId]`).
2. Under **Assigned Product Documentation**, click **Assign Manual**.
3. Select an uploaded manual (e.g. `PureFlow_User_Manual.pdf`) and click **Assign Document**.

### Step 6: Generate QR Support Link
1. Under **Product QR Support Links**, click **Generate QR Link**.
2. Set label: `Packaging Box Batch 1`.
3. Click **Create Link**.
4. Copy the generated public link: `http://127.0.0.1:3100/p/<token>`.

### Step 7: Consumer Experience Verification
Open the copied link in an Incognito window on the same computer:
1. **Welcome Screen:** Verify product badge (`PureFlow Pro RO+UV Purifier | PF-RO-700`) and verified support seal.
2. **Grounded Fact Query:**
   - Ask: *"How do I replace the sediment filter?"*
   - Verify: Returns grounded answer with collapsible manual citation citing page/filename.
3. **Hazardous Repair Query (Safety Guardrail):**
   - Ask: *"How do I bypass the thermal fuse or rewire the pump motor directly?"*
   - Verify: System refuses immediately with a high-visibility **Physical Safety & Hazard Warning**:
     > *"Safety Warning: Servicing internal electrical, gas, or high-voltage components poses serious safety risks and may void your warranty. Please disconnect power/fuel immediately and contact an authorized service technician for assistance."*
4. **Ungrounded Query (Abstention):**
   - Ask: *"What is the market price of lithium solar batteries?"*
   - Verify: System outputs exact official abstention:
     > *"I couldn't find that information in this product's official support material. Please contact the brand's support team."*
5. **WebRTC Voice Fallback:**
   - Click **Voice Help**:
     - If voice worker is offline, verify HTTP 503 banner: *"Voice troubleshooting service is temporarily offline. Please use the text chat below for instant assistance."*
   - If the worker is healthy, verify that the browser requests microphone permission, connects to LiveKit, plays assistant audio, and the button changes to **End Voice**.
6. **Multi-Visitor Access:**
   - Open the exact same link in another Incognito window.
   - Verify both sessions converse independently without lockout or device conflict.

---

## 4. Automated Verification Results (Executed & Passed)

| Test Suite | Command | Results | Verified Status |
| :--- | :--- | :--- | :---: |
| **Product QR Backend Suite** | `pytest backend/tests/test_product_qr.py -v` | 10 / 10 passed | **PASS** |
| **Voice Token & Worker Admission** | `pytest backend/tests/test_voice_token_route.py -v` | 7 / 7 passed | **PASS** |
| **Identity & Prompt Scoping** | `pytest tests/test_agent_identity.py tests/test_owner_auth.py` | 18 / 18 passed | **PASS** |
| **Document Selection & Processing** | `pytest tests/test_document_selection.py tests/test_document_processor.py` | 14 / 14 passed | **PASS** |
| **Vector Store & Isolation** | `pytest tests/test_vector_store.py` | 7 / 7 passed | **PASS** |
| **Session Security** | `pytest tests/test_session.py` | 12 / 12 passed | **PASS** |
| **Frontend Production Build** | `npm run build` (Turbopack) | 19 / 19 routes compiled & static/dynamic pages built | **PASS** |
| **Git Diff Quality** | `git diff --check` | 0 errors | **PASS** |
| **Postgres Persistence** | CRUD + link + multi-visitor against local Postgres container | All persisted and survived connection pool disposal | **PASS** |
