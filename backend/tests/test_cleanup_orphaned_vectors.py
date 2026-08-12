"""Keeping Qdrant and the database from drifting apart.

A document lives in three stores. The database row is the only record that it
exists, so once that row is gone nothing is left pointing at its vectors — and
those vectors stay searchable. The failure is invisible in exactly the wrong
way: the document list shows nothing, deleting it is impossible because there
is nothing to delete, and chat keeps quoting it.

This was not hypothetical. On the development database this suite runs against,
Postgres held 0 document rows while Qdrant held 37 chunks across 4 tenants, and
a retrieval for "what is Spotzero about?" returned real content from a file the
app believed had been deleted.

Two halves, tested here:

  - `_purge` must not delete the row when the vector delete fails. That
    swallowed failure is how the vectors got stranded.
  - `find_orphaned_vectors` must find chunks whose row is gone, without ever
    touching a document that is merely mid-ingestion.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import cleanup


def _indexed(document_id, tenant_id="t1", filename="a.pdf", chunks=3, age_hours=48.0):
    stamp = datetime.now(timezone.utc) - timedelta(hours=age_hours)
    return {
        "document_id": document_id,
        "tenant_id": tenant_id,
        "filename": filename,
        "chunks": chunks,
        "upload_timestamp": stamp.isoformat(),
    }


@pytest.fixture
def fake_vector_store(monkeypatch):
    """Stand in for the module-level vector_store `cleanup` imports lazily."""
    store = SimpleNamespace(
        indexed=[],
        deleted=[],
        delete_should_fail=False,
    )

    def list_indexed_documents(page_size=512):
        return list(store.indexed)

    def delete_by_document(document_id, tenant_id):
        if store.delete_should_fail:
            raise RuntimeError("Qdrant unreachable")
        store.deleted.append((document_id, tenant_id))

    store.list_indexed_documents = list_indexed_documents
    store.delete_by_document = delete_by_document

    import app.api.routes as routes

    monkeypatch.setattr(routes, "vector_store", store)
    return store


@pytest.fixture
def no_document_rows(monkeypatch):
    """Every lookup misses — the state that produced the real bug."""
    async def fake_get(document_id, tenant_id):
        return None

    monkeypatch.setattr(cleanup.repositories, "get_document_record", fake_get)


class TestPurgeKeepsTheRowWhenVectorsSurvive:
    async def test_row_is_not_deleted_when_the_vector_delete_fails(
        self, monkeypatch, fake_vector_store
    ):
        """The regression. Deleting the row here is what stranded 37 chunks."""
        fake_vector_store.delete_should_fail = True
        deleted_rows = []

        async def fake_delete_row(document_id, tenant_id):
            deleted_rows.append(document_id)

        async def fake_delete_file(key):
            pass

        monkeypatch.setattr(
            cleanup.repositories, "delete_document_record", fake_delete_row
        )
        monkeypatch.setattr(cleanup.storage, "delete", fake_delete_file)

        result = await cleanup._purge("doc-1", "t1", "a.pdf")

        assert result is False, "purge should report that it did not complete"
        assert deleted_rows == [], (
            "the row must survive a failed vector delete, so the next sweep "
            "retries instead of orphaning the vectors forever"
        )

    async def test_row_is_deleted_once_the_vectors_are_gone(
        self, monkeypatch, fake_vector_store
    ):
        deleted_rows = []

        async def fake_delete_row(document_id, tenant_id):
            deleted_rows.append(document_id)

        async def fake_delete_file(key):
            pass

        monkeypatch.setattr(
            cleanup.repositories, "delete_document_record", fake_delete_row
        )
        monkeypatch.setattr(cleanup.storage, "delete", fake_delete_file)

        result = await cleanup._purge("doc-1", "t1", "a.pdf")

        assert result is True
        assert deleted_rows == ["doc-1"]
        assert fake_vector_store.deleted == [("doc-1", "t1")]

    async def test_a_failed_file_delete_does_not_block_the_row(
        self, monkeypatch, fake_vector_store
    ):
        """A stray file is inert — it cannot be retrieved or quoted — so it must
        not hold up reclaiming the row the way stranded vectors do."""
        deleted_rows = []

        async def fake_delete_row(document_id, tenant_id):
            deleted_rows.append(document_id)

        async def fake_delete_file(key):
            raise RuntimeError("storage unreachable")

        monkeypatch.setattr(
            cleanup.repositories, "delete_document_record", fake_delete_row
        )
        monkeypatch.setattr(cleanup.storage, "delete", fake_delete_file)

        assert await cleanup._purge("doc-1", "t1", "a.pdf") is True
        assert deleted_rows == ["doc-1"]


class TestFindingOrphans:
    async def test_vectors_without_a_row_are_reported(
        self, fake_vector_store, no_document_rows
    ):
        fake_vector_store.indexed = [
            _indexed("doc-1", chunks=7, filename="Spotzero.docx"),
            _indexed("doc-2", chunks=10),
        ]
        orphans = await cleanup.find_orphaned_vectors()
        assert {o["document_id"] for o in orphans} == {"doc-1", "doc-2"}
        assert sum(o["chunks"] for o in orphans) == 17

    async def test_a_document_with_a_row_is_left_alone(
        self, monkeypatch, fake_vector_store
    ):
        fake_vector_store.indexed = [_indexed("doc-1"), _indexed("doc-2")]

        async def fake_get(document_id, tenant_id):
            return SimpleNamespace(document_id=document_id) if document_id == "doc-1" else None

        monkeypatch.setattr(cleanup.repositories, "get_document_record", fake_get)

        orphans = await cleanup.find_orphaned_vectors()
        assert [o["document_id"] for o in orphans] == ["doc-2"]

    async def test_a_document_still_being_ingested_is_not_an_orphan(
        self, fake_vector_store, no_document_rows
    ):
        """Ingestion upserts vectors before it writes the row. Without the grace
        period this sweep would delete whatever was uploading at the time."""
        fake_vector_store.indexed = [_indexed("uploading-now", age_hours=0.01)]
        assert await cleanup.find_orphaned_vectors(grace_hours=1.0) == []

    async def test_an_unreadable_timestamp_is_treated_as_recent(
        self, fake_vector_store, no_document_rows
    ):
        """Skipping a real orphan costs one more sweep. Deleting a live document
        costs the document — so ambiguity resolves towards not deleting."""
        entry = _indexed("no-stamp")
        entry["upload_timestamp"] = None
        fake_vector_store.indexed = [entry]
        assert await cleanup.find_orphaned_vectors() == []

        entry["upload_timestamp"] = "not-a-date"
        assert await cleanup.find_orphaned_vectors() == []


class TestPurgingOrphans:
    async def test_dry_run_deletes_nothing(self, fake_vector_store, no_document_rows):
        fake_vector_store.indexed = [_indexed("doc-1"), _indexed("doc-2")]
        reported = await cleanup.purge_orphaned_vectors(dry_run=True)
        assert len(reported) == 2
        assert fake_vector_store.deleted == [], "dry run must not delete"

    async def test_dry_run_is_the_default(self, fake_vector_store, no_document_rows):
        """This is the only sweep that destroys data the database cannot
        describe, so a caller who forgets the flag must lose nothing."""
        fake_vector_store.indexed = [_indexed("doc-1")]
        await cleanup.purge_orphaned_vectors()
        assert fake_vector_store.deleted == []

    async def test_live_run_deletes_the_orphans(
        self, fake_vector_store, no_document_rows
    ):
        fake_vector_store.indexed = [_indexed("doc-1"), _indexed("doc-2", tenant_id="t2")]
        removed = await cleanup.purge_orphaned_vectors(dry_run=False)
        assert len(removed) == 2
        assert set(fake_vector_store.deleted) == {("doc-1", "t1"), ("doc-2", "t2")}

    async def test_one_failure_does_not_stop_the_rest(
        self, monkeypatch, fake_vector_store, no_document_rows
    ):
        fake_vector_store.indexed = [_indexed("bad"), _indexed("good")]
        calls = []

        def flaky(document_id, tenant_id):
            calls.append(document_id)
            if document_id == "bad":
                raise RuntimeError("Qdrant unreachable")

        fake_vector_store.delete_by_document = flaky

        removed = await cleanup.purge_orphaned_vectors(dry_run=False)
        assert [r["document_id"] for r in removed] == ["good"]
        assert calls == ["bad", "good"]
