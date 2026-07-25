"""Tests for document cleanup.

This is the only code in the app that deletes user data without being asked,
so the cases that matter most are the ones where it must NOT delete: a
document still inside its TTL, and the owner's library when they have not
opted in.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.config import settings
from app.services import cleanup
from app.session import OWNER_TENANT_ID


def _record(document_id: str, tenant_id: str = "demo-abc", filename: str = "a.pdf"):
    return SimpleNamespace(
        document_id=document_id, tenant_id=tenant_id, filename=filename
    )


@pytest.fixture
def purged(monkeypatch):
    """Capture what would be deleted instead of deleting it."""
    calls: list[str] = []

    async def fake_purge(document_id, tenant_id, filename):
        calls.append(document_id)

    monkeypatch.setattr(cleanup, "_purge", fake_purge)
    return calls


class TestExpiry:
    async def test_expired_documents_are_purged(self, monkeypatch, purged):
        monkeypatch.setattr(settings, "DOCUMENT_TTL_HOURS", 24)

        async def fake_list(cutoff, include_owner, owner_tenant_id):
            return [_record("old-1"), _record("old-2")]

        monkeypatch.setattr(cleanup.repositories, "list_expired_documents", fake_list)
        assert await cleanup.purge_expired_documents() == 2
        assert purged == ["old-1", "old-2"]

    async def test_zero_ttl_disables_expiry(self, monkeypatch, purged):
        """A misread config must not become an unintended mass delete."""
        monkeypatch.setattr(settings, "DOCUMENT_TTL_HOURS", 0)

        async def fail(*args, **kwargs):
            raise AssertionError("must not query for expired documents")

        monkeypatch.setattr(cleanup.repositories, "list_expired_documents", fail)
        assert await cleanup.purge_expired_documents() == 0
        assert purged == []

    async def test_cutoff_matches_configured_ttl(self, monkeypatch, purged):
        monkeypatch.setattr(settings, "DOCUMENT_TTL_HOURS", 6)
        seen = {}

        async def fake_list(cutoff, include_owner, owner_tenant_id):
            seen["cutoff"] = cutoff
            return []

        monkeypatch.setattr(cleanup.repositories, "list_expired_documents", fake_list)
        await cleanup.purge_expired_documents()

        expected = datetime.now(timezone.utc) - timedelta(hours=6)
        assert abs((seen["cutoff"] - expected).total_seconds()) < 5

    @pytest.mark.parametrize("include_owner", [True, False])
    async def test_owner_exemption_is_passed_through(
        self, monkeypatch, purged, include_owner
    ):
        """The owner curates a library; a visitor uploads for one session.
        Deleting the former by default would be an unpleasant surprise."""
        monkeypatch.setattr(settings, "DOCUMENT_TTL_HOURS", 24)
        monkeypatch.setattr(settings, "CLEANUP_INCLUDES_OWNER", include_owner)
        seen = {}

        async def fake_list(cutoff, include_owner, owner_tenant_id):
            seen["include_owner"] = include_owner
            seen["owner_tenant_id"] = owner_tenant_id
            return []

        monkeypatch.setattr(cleanup.repositories, "list_expired_documents", fake_list)
        await cleanup.purge_expired_documents()

        assert seen["include_owner"] is include_owner
        assert seen["owner_tenant_id"] == OWNER_TENANT_ID


class TestOrphans:
    async def test_documents_without_a_file_are_purged(self, monkeypatch, purged):
        """The redeploy case: the disk was wiped but rows and vectors survived,
        leaving documents that look present and fail only when touched."""
        async def fake_list(cutoff, include_owner, owner_tenant_id):
            return [_record("gone", filename="a.pdf"), _record("kept", filename="b.pdf")]

        async def fake_exists(key):
            return "kept" in key

        monkeypatch.setattr(cleanup.repositories, "list_expired_documents", fake_list)
        monkeypatch.setattr(cleanup.storage, "exists", fake_exists)

        assert await cleanup.purge_orphaned_documents() == 1
        assert purged == ["gone"]

    async def test_documents_with_a_file_are_left_alone(self, monkeypatch, purged):
        async def fake_list(cutoff, include_owner, owner_tenant_id):
            return [_record("present")]

        async def fake_exists(key):
            return True

        monkeypatch.setattr(cleanup.repositories, "list_expired_documents", fake_list)
        monkeypatch.setattr(cleanup.storage, "exists", fake_exists)

        assert await cleanup.purge_orphaned_documents() == 0
        assert purged == []

    async def test_orphan_sweep_covers_the_owner(self, monkeypatch, purged):
        """Owner documents are exempt from the TTL, but a missing file is not a
        retention decision — the document is already broken either way."""
        seen = {}

        async def fake_list(cutoff, include_owner, owner_tenant_id):
            seen["include_owner"] = include_owner
            return []

        monkeypatch.setattr(cleanup.repositories, "list_expired_documents", fake_list)
        monkeypatch.setattr(settings, "CLEANUP_INCLUDES_OWNER", False)
        await cleanup.purge_orphaned_documents()

        assert seen["include_owner"] is True


class TestResilience:
    async def test_a_failed_store_still_reclaims_the_row(self, monkeypatch):
        """Deletion order is vectors, file, row. A Qdrant or storage outage must
        not leave the row behind forever — every step is idempotent and retried
        on the next sweep."""
        deleted_rows: list[str] = []

        async def failing_delete(key):
            raise RuntimeError("storage unavailable")

        async def fake_delete_record(document_id, tenant_id):
            deleted_rows.append(document_id)

        monkeypatch.setattr(cleanup.storage, "delete", failing_delete)
        monkeypatch.setattr(
            cleanup.repositories, "delete_document_record", fake_delete_record
        )

        await cleanup._purge("doc-1", "demo-abc", "a.pdf")
        assert deleted_rows == ["doc-1"]
