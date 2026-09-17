"""Health liveness / readiness split.

Spark owns the health-check section of `backend/app/api/routes.py`:
- GET /api/v1/health/live  – fast liveness, no external I/O
- GET /api/v1/health/ready – dependency-aware readiness
- GET /api/v1/health       – legacy, delegates to readiness

Gemini owns Product QR, identity, workspace, RAG, voice. These tests must
not touch those areas except via HTTP.
"""
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _mock_db_healthy():
    """Patch repositories.async_session to simulate a healthy DB."""
    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(return_value=None)
    # async with ... as session:  -> __aenter__ returns mock_session
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=mock_session)
    cm.__aexit__ = AsyncMock(return_value=False)
    return patch("app.api.routes.repositories.async_session", return_value=cm)


def _mock_db_unhealthy():
    """Patch repositories.async_session to raise – DB unavailable."""
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(side_effect=Exception("db down: postgres://scribe:supersecret@db:5432"))
    cm.__aexit__ = AsyncMock(return_value=False)
    return patch("app.api.routes.repositories.async_session", return_value=cm)


async def _get(client, path):
    resp = await client.get(path)
    return resp


# ---------------------------------------------------------------------------
# liveness
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_liveness_returns_success():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/health/live")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert data["components"]["api"] == "healthy"
    assert data["version"] == "1.0.0"
    # small stable payload – only api component
    assert set(data["components"].keys()) == {"api"}


@pytest.mark.asyncio
async def test_liveness_does_not_call_external_dependencies():
    """If liveness touched Qdrant/DB/Redis it would be too slow for a probe."""
    with patch("app.api.routes.vector_store.get_collection_info", side_effect=AssertionError("liveness must not call vector_store")) as m_vs, \
         patch("app.api.routes.rag_pipeline.count_tokens", side_effect=AssertionError("liveness must not call llm_client")) as m_llm, \
         patch("app.api.routes.conversation_service.ping", side_effect=AssertionError("liveness must not call redis")) as m_redis, \
         patch("app.api.routes.repositories.async_session", side_effect=AssertionError("liveness must not call DB")) as m_db:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/health/live")
        assert resp.status_code == 200
        m_vs.assert_not_called()
        m_llm.assert_not_called()
        m_redis.assert_not_called()
        m_db.assert_not_called()


@pytest.mark.asyncio
async def test_liveness_is_fast():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        start = time.perf_counter()
        resp = await client.get("/api/v1/health/live")
        elapsed_ms = (time.perf_counter() - start) * 1000
    assert resp.status_code == 200
    # target <50 ms under normal local conditions; allow generous headroom in CI
    assert elapsed_ms < 200, f"liveness too slow: {elapsed_ms:.1f}ms"


# ---------------------------------------------------------------------------
# readiness – healthy
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_readiness_reports_healthy_dependencies(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "test-internal-key")
    with patch("app.api.routes.vector_store.get_collection_info", return_value={"status": "ok"}), \
         patch("app.api.routes.rag_pipeline.count_tokens", return_value=2), \
         patch("app.api.routes.conversation_service.ping", return_value=True), \
         _mock_db_healthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/health/ready")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert data["components"]["vector_store"] == "healthy"
    assert data["components"]["llm_client"] == "healthy"
    assert data["components"]["database"] == "healthy"
    assert data["components"]["redis"] == "healthy"
    assert data["components"]["api"] == "healthy"


# ---------------------------------------------------------------------------
# readiness – unhealthy required dependency
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_readiness_reports_unhealthy_required_dependency():
    with patch("app.api.routes.vector_store.get_collection_info", side_effect=Exception("qdrant down")), \
         patch("app.api.routes.rag_pipeline.count_tokens", return_value=2), \
         patch("app.api.routes.conversation_service.ping", return_value=True), \
         _mock_db_healthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/health/ready")
    # Unhealthy readiness must be HTTP 503 so orchestrators detect unready.
    assert resp.status_code == 503
    data = resp.json()
    assert data["status"] == "unhealthy"
    assert data["components"]["vector_store"] == "unhealthy"
    # must not leak exception trace
    assert "qdrant down" not in str(data)


@pytest.mark.asyncio
async def test_readiness_database_failure_is_unhealthy():
    with patch("app.api.routes.vector_store.get_collection_info", return_value={"status": "ok"}), \
         patch("app.api.routes.rag_pipeline.count_tokens", return_value=2), \
         patch("app.api.routes.conversation_service.ping", return_value=True), \
         _mock_db_unhealthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/health/ready")
    assert resp.status_code == 503
    data = resp.json()
    assert data["status"] == "unhealthy"
    assert data["components"]["database"] == "unhealthy"
    # secret from exception must not appear
    assert "supersecret" not in str(data)
    assert "postgres://" not in str(data)


@pytest.mark.asyncio
async def test_readiness_llm_failure_is_unhealthy():
    with patch("app.api.routes.vector_store.get_collection_info", return_value={"status": "ok"}), \
         patch("app.api.routes.rag_pipeline.count_tokens", side_effect=Exception("tokenizer boom: GROQ_API_KEY=sk-secret123")), \
         patch("app.api.routes.conversation_service.ping", return_value=True), \
         _mock_db_healthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/health/ready")
    assert resp.status_code == 503
    data = resp.json()
    assert data["status"] == "unhealthy"
    assert data["components"]["llm_client"] == "unhealthy"
    assert "sk-secret123" not in str(data)
    assert "GROQ_API_KEY" not in str(data)


# ---------------------------------------------------------------------------
# readiness – redis degraded (existing rule)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_redis_failure_is_degraded_not_unhealthy():
    with patch("app.api.routes.vector_store.get_collection_info", return_value={"status": "ok"}), \
         patch("app.api.routes.rag_pipeline.count_tokens", return_value=2), \
         patch("app.api.routes.conversation_service.ping", return_value=False), \
         _mock_db_healthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/health/ready")
    # Degraded (redis-only) readiness stays HTTP 200 – the app still serves.
    assert resp.status_code == 200
    data = resp.json()
    # Redis down must be degraded, not unhealthy – app still works via in-memory fallback
    assert data["status"] == "degraded"
    assert data["components"]["redis"] == "degraded (using in-memory fallback)"
    assert data["components"]["vector_store"] == "healthy"


@pytest.mark.asyncio
async def test_redis_exception_is_degraded():
    with patch("app.api.routes.vector_store.get_collection_info", return_value={"status": "ok"}), \
         patch("app.api.routes.rag_pipeline.count_tokens", return_value=2), \
         patch("app.api.routes.conversation_service.ping", side_effect=Exception("redis timeout")), \
         _mock_db_healthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/health/ready")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "degraded"
    assert "degraded" in data["components"]["redis"]


# ---------------------------------------------------------------------------
# legacy /health – backward compat
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_legacy_health_still_works_and_delegates_to_readiness():
    with patch("app.api.routes.vector_store.get_collection_info", return_value={"status": "ok"}), \
         patch("app.api.routes.rag_pipeline.count_tokens", return_value=2), \
         patch("app.api.routes.conversation_service.ping", return_value=True), \
         _mock_db_healthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            ready = await client.get("/api/v1/health/ready")
            legacy = await client.get("/api/v1/health")
    assert legacy.status_code == 200
    assert legacy.json() == ready.json()


@pytest.mark.asyncio
async def test_legacy_health_reports_unhealthy_when_readiness_does():
    with patch("app.api.routes.vector_store.get_collection_info", side_effect=Exception("qdrant down")), \
         patch("app.api.routes.rag_pipeline.count_tokens", return_value=2), \
         patch("app.api.routes.conversation_service.ping", return_value=True), \
         _mock_db_healthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/health")
    assert resp.status_code == 503
    assert resp.json()["status"] == "unhealthy"


@pytest.mark.asyncio
async def test_legacy_health_healthy_stays_200(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "test-internal-key")
    with patch("app.api.routes.vector_store.get_collection_info", return_value={"status": "ok"}), \
         patch("app.api.routes.rag_pipeline.count_tokens", return_value=2), \
         patch("app.api.routes.conversation_service.ping", return_value=True), \
         _mock_db_healthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "healthy"


# ---------------------------------------------------------------------------
# no secret leakage
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_responses_do_not_expose_secrets_or_traces():
    secret_vector = Exception("QDRANT_API_KEY=secret_qdrant_123 postgres://scribe:dbpass@host/db")
    secret_llm = Exception("GROQ_API_KEY=gsk_secret_xyz traceback at /app/api/routes.py:344")
    with patch("app.api.routes.vector_store.get_collection_info", side_effect=secret_vector), \
         patch("app.api.routes.rag_pipeline.count_tokens", side_effect=secret_llm), \
         patch("app.api.routes.conversation_service.ping", return_value=True), \
         _mock_db_unhealthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            for path in ["/api/v1/health/ready", "/api/v1/health", "/api/v1/health/live"]:
                resp = await client.get(path)
                body = resp.text  # raw text to catch any leakage
                assert "secret_qdrant_123" not in body
                assert "dbpass" not in body
                assert "gsk_secret_xyz" not in body
                assert "GROQ_API_KEY" not in body
                assert "QDRANT_API_KEY" not in body
                assert "traceback" not in body.lower()
                assert "postgres://" not in body
                # liveness should never be unhealthy even when deps are down
                if path == "/api/v1/health/live":
                    assert resp.json()["status"] == "healthy"


# ---------------------------------------------------------------------------
# route ordering regression – /health must not shadow /health/live or /health/ready
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_readiness_logs_class_name_never_secret_values(caplog):
    """Routine warning logs must not contain provider keys, connection
    strings, or passwords — dependency name + exception class only."""
    secret = "postgres://scribe:dbpass-sup3rsecret@db.internal:5432/scribe"
    with patch(
        "app.api.routes.vector_store.get_collection_info",
        side_effect=Exception(secret),
    ), patch("app.api.routes.rag_pipeline.count_tokens", return_value=2), patch(
        "app.api.routes.conversation_service.ping", return_value=True
    ), _mock_db_healthy():
        with caplog.at_level("WARNING"):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get("/api/v1/health/ready")
    assert resp.status_code == 503
    assert "dbpass-sup3rsecret" not in caplog.text
    assert "postgres://" not in caplog.text
    assert "Exception" in caplog.text


@pytest.mark.asyncio
async def test_readiness_voice_credentials_healthy_when_internal_set(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "test-internal-key")
    with patch("app.api.routes.vector_store.get_collection_info", return_value={"status": "ok"}), \
         patch("app.api.routes.rag_pipeline.count_tokens", return_value=2), \
         patch("app.api.routes.conversation_service.ping", return_value=True), \
         _mock_db_healthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/health/ready")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert data["components"]["voice_credentials"] == "healthy"


@pytest.mark.asyncio
async def test_readiness_voice_credentials_degraded_without_internal_but_defaults(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "")
    monkeypatch.setattr(settings, "GROQ_API_KEY", "test-groq")
    monkeypatch.setattr(settings, "SARVAM_API_KEY", "test-sarvam")
    with patch("app.api.routes.vector_store.get_collection_info", return_value={"status": "ok"}), \
         patch("app.api.routes.rag_pipeline.count_tokens", return_value=2), \
         patch("app.api.routes.conversation_service.ping", return_value=True), \
         _mock_db_healthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/health/ready")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "degraded"
    assert data["components"]["voice_credentials"].startswith("degraded")


@pytest.mark.asyncio
async def test_readiness_voice_credentials_unhealthy_never_topples_service(monkeypatch):
    """Voice-only misconfiguration is degraded service, not a 503: chat,
    docs, and booking stay servable (same philosophy as the Redis rule)."""
    from app.config import settings

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "")
    monkeypatch.setattr(settings, "GROQ_API_KEY", "")
    monkeypatch.setattr(settings, "SARVAM_API_KEY", "")
    with patch("app.api.routes.vector_store.get_collection_info", return_value={"status": "ok"}), \
         patch("app.api.routes.rag_pipeline.count_tokens", return_value=2), \
         patch("app.api.routes.conversation_service.ping", return_value=True), \
         _mock_db_healthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/api/v1/health/ready")
    assert resp.status_code == 200
    data = resp.json()
    assert data["components"]["voice_credentials"] == "unhealthy"
    assert data["status"] == "degraded"


@pytest.mark.asyncio
async def test_route_ordering_no_ambiguity():
    """Regression: FastAPI must distinguish /health, /health/live, /health/ready."""
    with patch("app.api.routes.vector_store.get_collection_info", return_value={"status": "ok"}), \
         patch("app.api.routes.rag_pipeline.count_tokens", return_value=2), \
         patch("app.api.routes.conversation_service.ping", return_value=True), \
         _mock_db_healthy():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            live = await client.get("/api/v1/health/live")
            ready = await client.get("/api/v1/health/ready")
            legacy = await client.get("/api/v1/health")
            # all three must be distinct endpoints, none 404
            assert live.status_code == 200
            assert ready.status_code == 200
            assert legacy.status_code == 200
            # live is minimal, ready/legacy are full
            assert set(live.json()["components"].keys()) == {"api"}
            assert "vector_store" in ready.json()["components"]
            assert "vector_store" in legacy.json()["components"]
            # unknown sub-path should 404, not be swallowed by /health
            not_found = await client.get("/api/v1/health/unknown")
            assert not_found.status_code == 404
