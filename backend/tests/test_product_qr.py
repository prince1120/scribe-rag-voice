"""Test suite for Product QR Milestone M1A.

Verifies:
1. Feature flag gating (PRODUCT_QR_ENABLED=false returns 404).
2. Deterministic safety guardrail rules for physical appliance hazards.
3. Token hashing security (SHA-256 stored, plaintext token never stored in DB).
4. Product QR repository CRUD, document linking, and multi-visitor session isolation.
5. Absence of device-binding lockout: shared links allow multiple concurrent visitors.
6. Public entry, grounded RAG abstention, and 503 worker-offline handling.
"""
import os
os.environ.setdefault("GROQ_API_KEY", "gsk_test_key_for_unit_tests")
os.environ.setdefault("SESSION_SECRET", "mock_session_secret_for_tests_must_be_non_placeholder")
os.environ.setdefault("SCRIBE_ALLOW_SQLITE", "true")
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test_product_qr.db"
os.environ.setdefault("LIVEKIT_API_KEY", "test_lk_key")
os.environ.setdefault("LIVEKIT_API_SECRET", "test_lk_secret_long_enough")
os.environ.setdefault("LIVEKIT_URL", "ws://localhost:7880")

from datetime import datetime, timezone
import hashlib
from uuid import uuid4
import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.database import engine, init_db
from app.main import app
from app.repositories import product_qr as repo
from app.repositories import save_document
from app.services.product_safety import (
    ABSTENTION_MESSAGE,
    SAFETY_WARNING_MESSAGE,
    check_product_safety,
    is_safety_sensitive_query,
)
from app.session import issue, issue_product_session, verify


@pytest.fixture(autouse=True)
async def ensure_db():
    await init_db()
    yield
    await engine.dispose()


# ---- 1. Safety Guardrail Tests ----------------------------------------------

def test_safety_guardrail_catches_electrical_and_gas_hazards():
    hazard_queries = [
        "How do I bypass the thermal fuse on this heater?",
        "Can I jump the thermal cutoff switch?",
        "How to open the microwave magnetron assembly?",
        "How do I remove the high voltage capacitor?",
        "There is a burning smell and smoke coming from the power board",
        "I smell a gas leak from the cylinder line",
        "How do I tamper with the pressure relief valve on the geyser?",
        "Can I solder the high dc bus on the inverter board?",
    ]
    for q in hazard_queries:
        assert is_safety_sensitive_query(q) is True, f"Failed to catch hazard: {q}"
        assert check_product_safety(q) == SAFETY_WARNING_MESSAGE


def test_safety_guardrail_allows_safe_queries():
    safe_queries = [
        "How do I replace the sediment filter?",
        "What does error code E02 mean?",
        "How do I clean the water tank?",
        "What is the warranty period for this unit?",
        "How to reset the WiFi indicator light?",
    ]
    for q in safe_queries:
        assert is_safety_sensitive_query(q) is False, f"False positive hazard on: {q}"
        assert check_product_safety(q) is None


# ---- 2. Token Security & Hashing Tests ---------------------------------------

def test_token_hashing_and_verification():
    token = "test_plaintext_token_12345"
    tok_hash = repo.hash_token(token)
    assert len(tok_hash) == 64
    assert tok_hash == hashlib.sha256(token.encode("utf-8")).hexdigest()
    assert token not in tok_hash


# ---- 3. Repository CRUD & Session Isolation Tests ---------------------------

@pytest.mark.asyncio
async def test_product_qr_repository_crud():
    tenant_id = f"test_tenant_{uuid4().hex[:8]}"

    # 1. Create product
    product = await repo.create_product(
        tenant_id=tenant_id,
        name="AquaShield Pro RO",
        model_number="AS-RO-900",
        category="Water Purifier",
        description="7-stage purification unit",
    )
    assert product.product_id is not None
    assert product.name == "AquaShield Pro RO"
    assert product.model_number == "AS-RO-900"
    assert product.is_active is True

    # 2. Get product
    fetched = await repo.get_product(product.product_id, tenant_id)
    assert fetched is not None
    assert fetched.product_id == product.product_id

    # 3. Update product
    updated = await repo.update_product(
        product.product_id, tenant_id, name="AquaShield Pro RO v2"
    )
    assert updated.name == "AquaShield Pro RO v2"

    # 4. Link documents
    doc_id = str(uuid4())
    await save_document(
        document_id=doc_id,
        tenant_id=tenant_id,
        filename="manual_as_ro_900.pdf",
        file_size=1024,
        chunk_count=12,
    )
    link_doc = await repo.link_document_to_product(
        product.product_id, doc_id, tenant_id
    )
    assert link_doc.product_id == product.product_id
    assert link_doc.document_id == doc_id

    doc_ids = await repo.list_product_document_ids(product.product_id, tenant_id)
    assert doc_id in doc_ids

    # 5. Create QR link
    qr_link, raw_token = await repo.create_qr_link(
        product_id=product.product_id,
        tenant_id=tenant_id,
        name="Carton Packaging QR",
    )
    assert qr_link.is_active is True
    assert qr_link.token_hash != raw_token
    assert qr_link.scan_count == 0

    # Retrieve by token
    by_token = await repo.get_qr_link_by_token(raw_token)
    assert by_token is not None
    assert by_token.link_id == qr_link.link_id

    # 6. Multi-visitor session isolation (NO DEVICE BINDING LOCKOUT)
    sessions = []
    for i in range(5):
        s = await repo.create_visitor_session(
            tenant_id=tenant_id,
            product_id=product.product_id,
            link_id=qr_link.link_id,
            ip_address=f"192.168.1.{10 + i}",
            user_agent=f"VisitorBrowser/{i}.0",
        )
        sessions.append(s)

    # Verify all 5 sessions are distinct and can exist concurrently for the same QR link
    session_ids = [s.session_id for s in sessions]
    assert len(set(session_ids)) == 5
    for s in sessions:
        lookup = await repo.get_visitor_session(s.session_id, tenant_id)
        assert lookup is not None
        assert lookup.product_id == product.product_id

    # 7. Revoke QR link
    revoked = await repo.revoke_qr_link(qr_link.link_id, tenant_id)
    assert revoked.is_active is False
    assert revoked.revoked_at is not None


# ---- 4. Feature Flag Gating Tests -------------------------------------------

@pytest.mark.asyncio
async def test_feature_flag_gated_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "PRODUCT_QR_ENABLED", False)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Owner route returns 404
        owner_res = await client.get("/api/v1/product-qr/products")
        assert owner_res.status_code == 404
        assert "disabled" in owner_res.json()["detail"].lower()

        # Public open route returns 404
        pub_res = await client.post("/api/v1/product-qr/public/fake_token/open")
        assert pub_res.status_code == 404
        assert "disabled" in pub_res.json()["detail"].lower()


# ---- 5. Public Visitor & Chat Workflow Tests --------------------------------

@pytest.mark.asyncio
async def test_public_qr_visitor_and_chat_workflow(monkeypatch):
    monkeypatch.setattr(settings, "PRODUCT_QR_ENABLED", True)
    monkeypatch.setattr(settings, "DEBUG", True)
    tenant_id = f"tenant_{uuid4().hex[:8]}"

    # Set up product and QR link
    product = await repo.create_product(
        tenant_id=tenant_id,
        name="Induction Cooktop IC200",
        model_number="IC-200",
        category="Kitchen Appliance",
    )
    qr_link, raw_token = await repo.create_qr_link(
        product_id=product.product_id,
        tenant_id=tenant_id,
        name="Manual Sticker QR",
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Open QR link
        open_res = await client.post(f"/api/v1/product-qr/public/{raw_token}/open")
        assert open_res.status_code == 200
        data = open_res.json()
        assert data["product"]["name"] == "Induction Cooktop IC200"
        assert data["product"]["model_number"] == "IC-200"
        assert "session" not in data
        assert "product_id" not in data["product"]
        assert "scribe_product_session" in client.cookies

        # 2. Chat with hazardous repair question -> Safety Warning
        hazard_res = await client.post(
            "/api/v1/product-qr/public/chat",
            json={"message": "Can I bypass the thermal fuse inside the cooktop?"},
        )
        assert hazard_res.status_code == 200
        hazard_data = hazard_res.json()
        assert hazard_data["is_safety_escalation"] is True
        assert "Safety Warning" in hazard_data["reply"]

        # 3. Chat with ungrounded question (no documents linked yet) -> Abstention
        chat_res = await client.post(
            "/api/v1/product-qr/public/chat",
            json={"message": "How do I change the display language?"},
        )
        assert chat_res.status_code == 200
        chat_data = chat_res.json()
        assert chat_data["is_safety_escalation"] is False
        assert chat_data["reply"] == ABSTENTION_MESSAGE

        # 4. A healthy worker still cannot mint a voice room without consent.
        async def worker_up():
            return True

        from app.api import product_qr_public_routes
        monkeypatch.setattr(product_qr_public_routes, "is_worker_available", worker_up)
        monkeypatch.setattr(product_qr_public_routes, "ensure_worker_running", worker_up)

        consent_res = await client.post("/api/v1/product-qr/public/voice/token")
        assert consent_res.status_code == 400
        assert "consent" in consent_res.json()["detail"].lower()

        # 5. A configured, consented call inherits the saved voice settings
        # and receives a durable call id for the owner Inbox.
        from types import SimpleNamespace

        async def configured_agent(_tenant_id):
            return SimpleNamespace(voice_id="priya", language="hi-IN")

        async def configured_owner(_tenant_id):
            return SimpleNamespace()

        async def configured_credentials(_tenant_id, record=None):
            return {"llm_model": "mistral-small-latest"}

        async def create_product_call(*_args, **_kwargs):
            return "product-voice-call-1"

        monkeypatch.setattr(product_qr_public_routes.owner_service, "cached_agent", configured_agent)
        monkeypatch.setattr(product_qr_public_routes.owner_service, "cached_owner", configured_owner)
        monkeypatch.setattr(product_qr_public_routes.owner_service, "channel_settings", lambda *_args: {"style_rules": True})
        monkeypatch.setattr(product_qr_public_routes.owner_service, "resolve_credentials", configured_credentials)
        monkeypatch.setattr(product_qr_public_routes.business, "create_call", create_product_call)
        monkeypatch.setattr(settings, "INTERNAL_API_KEY", "internal-test-key")

        configured_voice_res = await client.post(
            "/api/v1/product-qr/public/voice/token",
            json={"consent_accepted": True},
        )
        assert configured_voice_res.status_code == 200
        assert configured_voice_res.json()["call_id"] == "product-voice-call-1"

        # 6. Voice token request when voice worker is down -> 503
        async def worker_down():
            return False

        monkeypatch.setattr(product_qr_public_routes, "is_worker_available", worker_down)
        monkeypatch.setattr(product_qr_public_routes, "ensure_worker_running", worker_down)

        voice_res = await client.post(
            "/api/v1/product-qr/public/voice/token",
        )
        assert voice_res.status_code == 503
        assert "temporarily unavailable" in voice_res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_revoked_qr_link_returns_410(monkeypatch):
    monkeypatch.setattr(settings, "PRODUCT_QR_ENABLED", True)
    tenant_id = f"tenant_{uuid4().hex[:8]}"

    product = await repo.create_product(
        tenant_id=tenant_id,
        name="Air Fryer AF10",
        model_number="AF-10",
    )
    qr_link, raw_token = await repo.create_qr_link(
        product_id=product.product_id,
        tenant_id=tenant_id,
    )

    # Revoke link
    await repo.revoke_qr_link(qr_link.link_id, tenant_id)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(f"/api/v1/product-qr/public/{raw_token}/open")
        assert res.status_code == 410
        assert "revoked" in res.json()["detail"].lower()


# ---- 6. Cross-Tenant & Document Assignment Edge Cases -----------------------

@pytest.mark.asyncio
async def test_owner_routes_require_authentication(monkeypatch):
    monkeypatch.setattr(settings, "PRODUCT_QR_ENABLED", True)
    monkeypatch.setattr(settings, "APP_ACCESS_PASSCODE", "test_required_passcode")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/v1/product-qr/products")
        assert res.status_code in (401, 403)


@pytest.mark.asyncio
async def test_cross_tenant_document_linking_and_duplicates(monkeypatch):
    monkeypatch.setattr(settings, "PRODUCT_QR_ENABLED", True)
    tenant_a = f"tenant_a_{uuid4().hex[:8]}"
    tenant_b = f"tenant_b_{uuid4().hex[:8]}"

    # Product belongs to Tenant A
    product_a = await repo.create_product(
        tenant_id=tenant_a,
        name="Smart Toaster T1",
        model_number="ST-100",
    )

    # Document belongs to Tenant B
    doc_b_id = str(uuid4())
    await save_document(
        document_id=doc_b_id,
        tenant_id=tenant_b,
        filename="tenant_b_secret_manual.pdf",
        file_size=2048,
        chunk_count=5,
    )

    # Document belongs to Tenant A
    doc_a_id = str(uuid4())
    await save_document(
        document_id=doc_a_id,
        tenant_id=tenant_a,
        filename="tenant_a_toaster_manual.pdf",
        file_size=1024,
        chunk_count=3,
    )

    auth_token_a = issue(f"owner:{tenant_a}")
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        cookies={"scribe_session": auth_token_a},
    ) as client:
        # 1. Attempting to link Tenant B's document to Tenant A's product -> 404
        cross_res = await client.post(
            f"/api/v1/product-qr/products/{product_a.product_id}/documents",
            json={"document_id": doc_b_id},
        )
        assert cross_res.status_code == 404
        assert "not found in workspace" in cross_res.json()["detail"].lower()

        # 2. Linking Tenant A's own document -> 200 OK
        link_res = await client.post(
            f"/api/v1/product-qr/products/{product_a.product_id}/documents",
            json={"document_id": doc_a_id},
        )
        assert link_res.status_code == 200
        assert link_res.json()["success"] is True

        # 3. Duplicate document assignment -> 409 Conflict
        dup_res = await client.post(
            f"/api/v1/product-qr/products/{product_a.product_id}/documents",
            json={"document_id": doc_a_id},
        )
        assert dup_res.status_code == 409
        assert "already assigned" in dup_res.json()["detail"].lower()

        # 4. Unlink document -> 200 OK
        unlink_res = await client.delete(
            f"/api/v1/product-qr/products/{product_a.product_id}/documents/{doc_a_id}"
        )
        assert unlink_res.status_code == 200
        assert unlink_res.json()["success"] is True

        # Verify no documents are assigned
        docs = await repo.list_product_document_ids(product_a.product_id, tenant_a)
        assert doc_a_id not in docs


@pytest.mark.asyncio
async def test_public_chat_searches_only_documents_assigned_to_product(monkeypatch):
    """The browser cannot widen retrieval beyond the server-side product map."""
    monkeypatch.setattr(settings, "PRODUCT_QR_ENABLED", True)
    monkeypatch.setattr(settings, "DEBUG", True)
    tenant_id = f"tenant_scope_{uuid4().hex[:8]}"
    product = await repo.create_product(
        tenant_id=tenant_id,
        name="Purifier Scope Test",
        model_number="PS-1",
    )

    assigned_id = str(uuid4())
    unassigned_id = str(uuid4())
    for document_id, filename in (
        (assigned_id, "assigned_manual.pdf"),
        (unassigned_id, "other_manual.pdf"),
    ):
        await save_document(
            document_id=document_id,
            tenant_id=tenant_id,
            filename=filename,
            file_size=100,
            chunk_count=1,
        )
    await repo.link_document_to_product(product.product_id, assigned_id, tenant_id)
    _, raw_token = await repo.create_qr_link(product.product_id, tenant_id)

    from app.api import routes as shared_routes

    observed = {}

    def fake_search(**kwargs):
        observed.update(kwargs)
        return [
            {
                "score": 0.9,
                "payload": {
                    "filename": "assigned_manual.pdf",
                    "page_number": 2,
                    "content": "Replace the filter every six months.",
                },
            }
        ]

    monkeypatch.setattr(shared_routes.embedding_service, "encode_query", lambda query: [0.1])
    monkeypatch.setattr(shared_routes.vector_store, "search", fake_search)
    monkeypatch.setattr(
        shared_routes.rag_pipeline,
        "generate_response",
        lambda **kwargs: "Replace the filter every six months [1].",
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        opened = await client.post(f"/api/v1/product-qr/public/{raw_token}/open")
        assert opened.status_code == 200
        response = await client.post(
            "/api/v1/product-qr/public/chat",
            json={"message": "When should I replace the filter?"},
        )

    assert response.status_code == 200
    assert response.json()["reply"].startswith("Replace the filter")
    assert observed["tenant_id"] == tenant_id
    assert observed["document_ids"] == [assigned_id]
    assert unassigned_id not in observed["document_ids"]
