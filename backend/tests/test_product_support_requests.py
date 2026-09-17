"""Product QR human-support requests (M1B).

Backend contract: public POST files a request derived strictly from the
validated session token; owner GET/PATCH triages. Covers route behavior,
repository idempotency, authorization, rate limiting, notification
isolation, and secret non-disclosure.

Uses test tenants and test data only; no real owner records are touched.
"""
from uuid import uuid4
import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.database import engine, init_db
from app.main import app
from app.rate_limit import limiter
from app.repositories import product_qr as repo
from app.session import issue, issue_product_session


@pytest.fixture(autouse=True)
async def ensure_db():
    await init_db()
    yield
    await engine.dispose()


def _client(**kwargs):
    return AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", **kwargs
    )


async def _setup_product(monkeypatch, tenant=None):
    """Product + QR link + visitor session; returns ids and a signed token."""
    monkeypatch.setattr(settings, "PRODUCT_QR_ENABLED", True)
    tenant_id = tenant or f"tenant_sr_{uuid4().hex[:8]}"
    product = await repo.create_product(
        tenant_id=tenant_id,
        name="Geyser G100",
        model_number="G-100",
    )
    qr_link, _ = await repo.create_qr_link(
        product_id=product.product_id, tenant_id=tenant_id
    )
    sess = await repo.create_visitor_session(
        tenant_id=tenant_id,
        product_id=product.product_id,
        link_id=qr_link.link_id,
    )
    session_token = issue_product_session(sess.session_id, tenant_id, product.product_id)
    return tenant_id, product, sess, session_token


@pytest.fixture(autouse=True)
def _no_slowapi_limit(monkeypatch):
    """Deterministic everywhere: slowapi counting is covered by the single
    rate-limit test; every other test here pins it off (local dev disables
    it anyway, and shared in-memory buckets would otherwise flake)."""
    monkeypatch.setattr(limiter, "enabled", False)


def _payload(session_token, **overrides):
    body = {
        "request_id": str(uuid4()),
        "session_token": session_token,
        "name": "Sunita Rao",
        "reply_to": "+91-98200-12345",
        "preferred_time": "Evenings after 6pm",
        "message": "The geyser trips the breaker every morning.",
        "trigger": "manual",
        "consent": True,
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_post_creates_request_and_returns_201_shape(monkeypatch):
    tenant_id, product, sess, session_token = await _setup_product(monkeypatch)
    async with _client() as client:
        resp = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload(session_token),
        )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert set(data.keys()) == {"request_id", "status", "created_at"}
    assert data["status"] == "open"
    assert data["created_at"]
    # Persisted as a first-class row, tenant/product/session scoped.
    stored, _ = await repo.list_support_requests(tenant_id)
    assert len(stored) == 1
    assert stored[0].product_id == product.product_id
    assert stored[0].session_id == sess.session_id
    assert stored[0].trigger == "manual"


@pytest.mark.asyncio
async def test_post_is_idempotent_for_same_uuid_and_session(monkeypatch):
    _, _, _, session_token = await _setup_product(monkeypatch)
    request_id = str(uuid4())
    async with _client() as client:
        first = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload(session_token, request_id=request_id),
        )
        second = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload(session_token, request_id=request_id, message="Changed text"),
        )
    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["request_id"] == request_id
    # Message from the first submission wins; no duplicate row.
    from app.database import async_session
    from sqlalchemy import func, select
    from app.models.db_models import ProductSupportRequestRecord

    async with async_session() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(ProductSupportRequestRecord)
            .where(ProductSupportRequestRecord.request_id == request_id)
        )
    assert count == 1


@pytest.mark.asyncio
async def test_concurrent_retries_create_one_row_and_one_notification(monkeypatch):
    from app.services import notification_service

    tenant_id, _, _, session_token = await _setup_product(monkeypatch)
    request_id = str(uuid4())

    async def submit():
        async with _client() as client:
            return await client.post(
                "/api/v1/product-qr/public/service-requests",
                json=_payload(session_token, request_id=request_id),
            )

    first, second = await asyncio.gather(submit(), submit())
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    rows, _ = await repo.list_support_requests(tenant_id)
    assert [r.request_id for r in rows].count(request_id) == 1
    notes = await notification_service.list_notifications(tenant_id)
    matching = [n for n in notes if n.link_id == request_id]
    assert len(matching) == 1


@pytest.mark.asyncio
async def test_uuid_from_another_session_reads_as_not_found(monkeypatch):
    tenant_id, _, _, session_token_a = await _setup_product(monkeypatch)
    request_id = str(uuid4())
    async with _client() as client:
        first = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload(session_token_a, request_id=request_id),
        )
        assert first.status_code == 201
    # Second session for the same product/tenant reuses the UUID.
    product = (await repo.list_products(tenant_id))[0]
    links = await repo.list_product_qr_links(product.product_id, tenant_id)
    sess_b = await repo.create_visitor_session(
        tenant_id=tenant_id, product_id=product.product_id, link_id=links[0].link_id
    )
    token_b = issue_product_session(sess_b.session_id, tenant_id, product.product_id)
    async with _client() as client:
        probe = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload(token_b, request_id=request_id),
        )
    # 404 either way: no oracle for other sessions' UUIDs.
    assert probe.status_code == 404


@pytest.mark.asyncio
async def test_post_requires_consent_and_validation(monkeypatch):
    _, _, _, session_token = await _setup_product(monkeypatch)
    async with _client() as client:
        no_consent = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload(session_token, consent=False),
        )
        assert no_consent.status_code == 400
        bad_trigger = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload(session_token, trigger="phone"),
        )
        assert bad_trigger.status_code == 422
        bad_uuid = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload(session_token, request_id="not-a-uuid"),
        )
        assert bad_uuid.status_code == 422


@pytest.mark.asyncio
async def test_post_rejects_invalid_and_expired_sessions(monkeypatch):
    tenant_id, product, _, _ = await _setup_product(monkeypatch)
    async with _client() as client:
        invalid = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload("bogus-token"),
        )
        assert invalid.status_code == 401
    sess = await repo.create_visitor_session(
        tenant_id=tenant_id,
        product_id=product.product_id,
        link_id=(await repo.list_product_qr_links(product.product_id, tenant_id))[0].link_id,
        expires_in_days=-1,
    )
    expired_token = issue_product_session(sess.session_id, tenant_id, product.product_id)
    async with _client() as client:
        expired = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload(expired_token),
        )
        assert expired.status_code == 401


@pytest.mark.asyncio
async def test_post_disabled_flag_returns_stable_404(monkeypatch):
    monkeypatch.setattr(settings, "PRODUCT_QR_ENABLED", False)
    async with _client() as client:
        resp = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload("anything"),
        )
    assert resp.status_code == 404
    assert "disabled" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_rate_limit_returns_429_with_retry_after(monkeypatch):
    # The local dev env disables rate limiting; enable it for this test.
    monkeypatch.setattr(limiter, "enabled", True)
    _, _, _, session_token = await _setup_product(monkeypatch)
    request_id = str(uuid4())
    last = None
    async with _client() as client:
        for _ in range(12):
            last = await client.post(
                "/api/v1/product-qr/public/service-requests",
                json=_payload(session_token, request_id=request_id),
            )
            if last.status_code == 429:
                break
    assert last is not None and last.status_code == 429, "expected a 429"
    # Retry-After header is the abuse-protection contract for Gemini.
    assert "retry-after" in {k.lower() for k in last.headers.keys()}


@pytest.mark.asyncio
async def test_session_daily_cap_returns_429(monkeypatch):
    """Repo-level abuse ceiling: 5 requests per session per day."""
    _, _, _, session_token = await _setup_product(monkeypatch)
    statuses = []
    async with _client() as client:
        for _ in range(7):
            resp = await client.post(
                "/api/v1/product-qr/public/service-requests",
                json=_payload(session_token, request_id=str(uuid4())),
            )
            statuses.append(resp.status_code)
    assert statuses[:5] == [201] * 5
    assert statuses[5] == 429
    assert statuses[6] == 429


@pytest.mark.asyncio
async def test_notification_created_and_failure_isolated(monkeypatch):
    from app.services import notification_service

    tenant_id, _, _, session_token = await _setup_product(monkeypatch)
    async with _client() as client:
        resp = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload(session_token),
        )
        assert resp.status_code == 201
    notes = await notification_service.list_notifications(tenant_id)
    support_notes = [n for n in notes if n.type == "product_support"]
    assert support_notes
    assert resp.json()["request_id"] in (support_notes[0].body or "")
    assert support_notes[0].link_id == resp.json()["request_id"]
    assert all(n.tenant_id == tenant_id for n in notes)

    async def boom(*args, **kwargs):
        raise RuntimeError("notify down")

    monkeypatch.setattr(
        "app.api.product_qr_public_routes.notify", boom
    )
    async with _client() as client:
        resp = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload(session_token),
        )
        assert resp.status_code == 201, "notify failure must not roll back the request"


@pytest.mark.asyncio
async def test_response_discloses_nothing_sensitive(monkeypatch):
    _, _, _, session_token = await _setup_product(monkeypatch)
    async with _client() as client:
        resp = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload(session_token),
        )
        bad = await client.post(
            "/api/v1/product-qr/public/service-requests",
            json=_payload("bogus-token"),
        )
    body = resp.text
    assert session_token not in body
    assert "tenant" not in body.lower().replace("request_id", "")
    assert set(resp.json().keys()) == {"request_id", "status", "created_at"}
    assert set(bad.json().keys()) == {"detail"}


@pytest.mark.asyncio
async def test_owner_list_patch_and_authorization(monkeypatch):
    monkeypatch.setattr(settings, "PRODUCT_QR_ENABLED", True)
    tenant_id, _, _, session_token = await _setup_product(monkeypatch)
    other_tenant = f"tenant_other_{uuid4().hex[:8]}"
    owner_cookie = issue(f"owner:{tenant_id}")
    other_cookie = issue(f"owner:{other_tenant}")

    async with _client(cookies={"scribe_session": owner_cookie}) as owner:
        async with _client() as pub:
            created = await pub.post(
                "/api/v1/product-qr/public/service-requests",
                json=_payload(session_token),
            )
            assert created.status_code == 201
            rid = created.json()["request_id"]

        listed = await owner.get("/api/v1/product-qr/service-requests?status=open")
        assert listed.status_code == 200
        items = listed.json()["items"]
        assert any(i["request_id"] == rid for i in items)
        item = next(i for i in items if i["request_id"] == rid)
        assert item["product_name"] == "Geyser G100"
        assert item["customer_name"] == "Sunita Rao"
        assert listed.json()["total"] >= 1

        patched = await owner.patch(
            f"/api/v1/product-qr/service-requests/{rid}",
            json={"status": "contacted", "owner_note": "Called back."},
        )
        assert patched.status_code == 200
        assert patched.json()["status"] == "contacted"
        assert patched.json()["owner_note"] == "Called back."

        bad_status = await owner.patch(
            f"/api/v1/product-qr/service-requests/{rid}",
            json={"status": "shipped"},
        )
        assert bad_status.status_code == 422

    async with _client(cookies={"scribe_session": other_cookie}) as other_owner:
        foreign = await other_owner.patch(
            f"/api/v1/product-qr/service-requests/{rid}",
            json={"status": "resolved"},
        )
        assert foreign.status_code == 404
        foreign_list = await other_owner.get("/api/v1/product-qr/service-requests")
        assert all(i["request_id"] != rid for i in foreign_list.json()["items"])

    # With no passcode the application intentionally treats localhost as the
    # owner. Enable authentication to exercise the actual anonymous boundary.
    monkeypatch.setattr(settings, "APP_ACCESS_PASSCODE", "test-passcode")
    async with _client() as anon:
        assert (await anon.get("/api/v1/product-qr/service-requests")).status_code in (401, 403)
        assert (
            await anon.patch(
                f"/api/v1/product-qr/service-requests/{rid}",
                json={"status": "resolved"},
            )
        ).status_code in (401, 403)
