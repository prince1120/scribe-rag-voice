"""Product QR voice retrieval must stay product-scoped.

Spark owns backend voice retrieval. Regression for the P0 defect where the
token endpoint put `document_ids` into dispatch metadata but the worker
dropped them, so a Product QR voice caller could retrieve any document in
the tenant instead of only the product's assigned documents.

Covers:
- no document_ids -> owner's enabled set (unchanged behavior)
- document_ids -> intersection with owner's enabled set (product scoping)
- document_ids with no overlap -> empty chunks, no search call (no leak)
- forged ids outside the enabled set are ignored, never widen retrieval
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


def _chunk(doc_id, tenant="t-qr"):
    return {
        "id": f"{doc_id}-chunk",
        "score": 0.9,
        "payload": {"content": f"text from {doc_id}", "document_id": doc_id},
    }


def _client():
    return AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    )


@pytest.mark.asyncio
async def test_retrieve_without_scope_uses_owner_enabled_set():
    seen = {}

    def fake_search(**kwargs):
        seen.update(kwargs)
        return [_chunk("docA"), _chunk("docB")]

    with patch(
        "app.api.routes.selected_document_ids",
        AsyncMock(return_value=["docA", "docB"]),
    ), patch(
        "app.api.routes.embedding_service.encode_query", return_value=[0.1]
    ), patch(
        "app.api.routes.sparse_encoder.encode_query", return_value=([0], [1.0])
    ), patch(
        "app.api.routes.vector_store.search", side_effect=fake_search
    ):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/voice/retrieve",
                json={"query": "price?", "tenant_id": "t-qr"},
            )
    assert resp.status_code == 200
    assert [c for c in resp.json()["chunks"]]
    assert sorted(seen["document_ids"]) == ["docA", "docB"]


@pytest.mark.asyncio
async def test_retrieve_with_product_scope_intersects_enabled_set():
    seen = {}

    def fake_search(**kwargs):
        seen.update(kwargs)
        return [_chunk("docA")]

    with patch(
        "app.api.routes.selected_document_ids",
        AsyncMock(return_value=["docA", "docB", "docC"]),
    ), patch(
        "app.api.routes.embedding_service.encode_query", return_value=[0.1]
    ), patch(
        "app.api.routes.sparse_encoder.encode_query", return_value=([0], [1.0])
    ), patch(
        "app.api.routes.vector_store.search", side_effect=fake_search
    ):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/voice/retrieve",
                json={
                    "query": "price?",
                    "tenant_id": "t-qr",
                    "document_ids": ["docA", "docB"],
                },
            )
    assert resp.status_code == 200
    # Only the intersection reaches the vector store — never the whole tenant.
    assert sorted(seen["document_ids"]) == ["docA", "docB"]


@pytest.mark.asyncio
async def test_retrieve_with_forged_ids_returns_empty_without_search():
    search = MagicMock(side_effect=AssertionError("must not search on empty scope"))
    with patch(
        "app.api.routes.selected_document_ids",
        AsyncMock(return_value=["docA", "docB"]),
    ), patch(
        "app.api.routes.embedding_service.encode_query", return_value=[0.1]
    ), patch(
        "app.api.routes.sparse_encoder.encode_query", return_value=([0], [1.0])
    ), patch("app.api.routes.vector_store.search", search):
        async with _client() as client:
            resp = await client.post(
                "/api/v1/voice/retrieve",
                json={
                    "query": "price?",
                    "tenant_id": "t-qr",
                    "document_ids": ["foreign-doc", "other-tenant-doc"],
                },
            )
    assert resp.status_code == 200
    assert resp.json() == {"chunks": []}
    search.assert_not_called()


@pytest.mark.asyncio
async def test_worker_params_preserve_product_document_ids():
    """Dispatch metadata -> SessionParams must not drop the product scope."""
    from app.services.voice import worker

    ctx = MagicMock()
    ctx.job.metadata = (
        '{"tenant_id": "t-qr", "rag_enabled": true, '
        '"document_ids": ["docA", "docB"], "product_id": "p1"}'
    )
    params = worker._params_for_job(ctx)
    assert params.document_ids == ["docA", "docB"]
    assert params.tenant_id == "t-qr"


@pytest.mark.asyncio
async def test_worker_params_without_scope_stays_none():
    from app.services.voice import worker

    ctx = MagicMock()
    ctx.job.metadata = '{"tenant_id": "t-qr", "rag_enabled": true}'
    params = worker._params_for_job(ctx)
    assert params.document_ids is None


@pytest.mark.asyncio
async def test_worker_params_ignores_malformed_document_ids():
    from app.services.voice import worker

    ctx = MagicMock()
    ctx.job.metadata = (
        '{"tenant_id": "t-qr", "document_ids": "not-a-list"}'
    )
    params = worker._params_for_job(ctx)
    assert params.document_ids is None
