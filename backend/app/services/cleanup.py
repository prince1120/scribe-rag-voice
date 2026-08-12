"""Keeps the three stores from drifting apart.

A document exists in three places at once: its file in storage, its metadata
row in Postgres, and its chunks and vectors in Qdrant. Uploads are
session-scoped, and the file lives on a disk a redeploy wipes — but the row
and the vectors survive. Left alone, the app keeps listing documents whose
file is gone: chat still answers from the indexed text, so it looks healthy,
and only download, editing, and image questions fail. A document that looks
present and breaks on touch is worse than one that disappeared.

Two sweeps, both idempotent and both safe to run while serving traffic:

  expired  — anything past DOCUMENT_TTL_HOURS
  orphaned — anything whose file is already missing

Deletion order is always vectors, then file, then row. The row is the only
record that a document exists, so removing it first would strand the other
two with nothing pointing at them.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app import repositories
from app.config import settings
from app.services.storage import build_key, storage

logger = logging.getLogger(__name__)


async def _purge(document_id: str, tenant_id: str, filename: str) -> bool:
    """Remove one document from all three stores. True if it is fully gone.

    Deletion order is vectors, then file, then row, and the row is only removed
    once the vectors are actually gone. That last part is the whole point: the
    row is the only record that a document exists, so deleting it while its
    vectors survive strands them permanently — nothing walks Qdrant looking for
    chunks whose document no longer exists, because until now nothing could.

    This previously logged a warning on a failed vector delete and deleted the
    row anyway. One Qdrant timeout was therefore enough to leave a document
    invisible in the UI and still answerable in chat, forever. Keeping the row
    instead means the next sweep retries it — every step here is idempotent, so
    retrying costs nothing.

    A failed *file* delete does not block the row: a stray file is inert, it
    cannot be retrieved or quoted, and it is reclaimed by the orphan sweep.
    """
    try:
        # Imported lazily to reuse the singleton the API server already built,
        # and to avoid a circular import at module load (routes imports
        # services, not the other way round).
        from app.api.routes import vector_store

        # Synchronous client; run in a thread so the sweep does not block the
        # event loop while serving requests.
        await asyncio.to_thread(vector_store.delete_by_document, document_id, tenant_id)
    except Exception:
        logger.warning(
            "Could not delete vectors for %s — keeping its row so the next "
            "sweep retries. Deleting the row now would strand the vectors and "
            "leave the document answerable in chat.",
            document_id, exc_info=True,
        )
        return False

    try:
        await storage.delete(build_key(document_id, filename))
    except Exception:
        logger.warning("Could not delete file for %s", document_id, exc_info=True)

    await repositories.delete_document_record(document_id, tenant_id)
    return True


async def purge_expired_documents() -> int:
    """Delete documents past their TTL. Returns how many were removed."""
    if settings.DOCUMENT_TTL_HOURS <= 0:
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(hours=settings.DOCUMENT_TTL_HOURS)
    from app.session import OWNER_TENANT_ID

    expired = await repositories.list_expired_documents(
        cutoff=cutoff,
        include_owner=settings.CLEANUP_INCLUDES_OWNER,
        owner_tenant_id=OWNER_TENANT_ID,
    )

    for record in expired:
        await _purge(record.document_id, record.tenant_id, record.filename)

    if expired:
        logger.info("Cleanup: removed %d expired document(s)", len(expired))
    return len(expired)


async def purge_orphaned_documents() -> int:
    """Delete documents whose file no longer exists.

    This is the redeploy case: the container's disk was wiped but the row and
    vectors survived. Catches it immediately rather than waiting out the TTL.
    """
    from app.session import OWNER_TENANT_ID

    # Everything, by asking for records older than "now".
    records = await repositories.list_expired_documents(
        cutoff=datetime.now(timezone.utc),
        include_owner=True,
        owner_tenant_id=OWNER_TENANT_ID,
    )

    removed = 0
    for record in records:
        if await storage.exists(build_key(record.document_id, record.filename)):
            continue
        logger.info(
            "Cleanup: %s (%s) has no file — removing its row and vectors",
            record.document_id, record.filename,
        )
        await _purge(record.document_id, record.tenant_id, record.filename)
        removed += 1

    return removed


async def find_orphaned_vectors(grace_hours: float = 1.0) -> list[dict]:
    """Documents that exist in Qdrant but have no row in the database.

    These are searchable and quotable while being invisible everywhere else —
    the document list does not show them, deleting them is impossible because
    there is nothing to delete, and chat answers from them as if nothing were
    wrong. That is strictly worse than a document that disappeared.

    `grace_hours` protects an ingestion that is still in progress: vectors are
    upserted before the row is written (see `_ingest_file`), so a document
    indexed seconds ago has no row yet and is not an orphan. Anything without a
    readable timestamp is treated as recent and left alone — the conservative
    direction, since the cost of skipping a real orphan is one more sweep and
    the cost of deleting a live document is the document.
    """
    from app.api.routes import vector_store

    indexed = await asyncio.to_thread(vector_store.list_indexed_documents)
    if not indexed:
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(hours=grace_hours)
    orphans: list[dict] = []

    for entry in indexed:
        record = await repositories.get_document_record(
            entry["document_id"], entry["tenant_id"]
        )
        if record is not None:
            continue

        raw = entry.get("upload_timestamp")
        try:
            stamp = datetime.fromisoformat(raw) if raw else None
        except (TypeError, ValueError):
            stamp = None
        if stamp is not None and stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        if stamp is None or stamp > cutoff:
            # No usable timestamp, or too recent to be sure. Skip it.
            continue

        orphans.append(entry)

    return orphans


async def purge_orphaned_vectors(
    *, dry_run: bool = True, grace_hours: float = 1.0
) -> list[dict]:
    """Delete vectors whose document row is gone. Returns what it acted on.

    Defaults to `dry_run=True`. This is the one sweep that destroys data the
    database cannot describe, so the default has to be the one that cannot lose
    anything — the caller says otherwise explicitly.
    """
    orphans = await find_orphaned_vectors(grace_hours=grace_hours)
    if not orphans:
        return []

    if dry_run:
        for entry in orphans:
            logger.info(
                "Orphaned vectors (dry run): %s '%s' tenant=%s chunks=%d",
                entry["document_id"], entry.get("filename"),
                entry["tenant_id"], entry["chunks"],
            )
        return orphans

    from app.api.routes import vector_store

    removed = []
    for entry in orphans:
        try:
            await asyncio.to_thread(
                vector_store.delete_by_document,
                entry["document_id"], entry["tenant_id"],
            )
        except Exception:
            logger.warning(
                "Could not delete orphaned vectors for %s",
                entry["document_id"], exc_info=True,
            )
            continue
        logger.info(
            "Removed orphaned vectors: %s '%s' tenant=%s chunks=%d",
            entry["document_id"], entry.get("filename"),
            entry["tenant_id"], entry["chunks"],
        )
        removed.append(entry)
    return removed


async def run_cleanup_loop() -> None:
    """Sweep on startup, then on an interval, for the process lifetime.

    Startup matters most: it is the moment right after a redeploy, when the
    orphan set is largest.
    """
    if settings.CLEANUP_INTERVAL_MINUTES <= 0:
        logger.info("Document cleanup is disabled (CLEANUP_INTERVAL_MINUTES=0).")
        return

    while True:
        try:
            await purge_orphaned_documents()
            await purge_expired_documents()
            # Reports only. Everything above deletes documents the database
            # knows about; this one deletes data the database cannot describe,
            # so it is not something a background loop should do unattended —
            # a transient database failure that made every lookup miss would
            # otherwise wipe the entire index. Logging the drift is what makes
            # it visible at all, which is the part that was missing: the first
            # time this condition occurred, nothing anywhere reported it.
            orphans = await purge_orphaned_vectors(dry_run=True)
            if orphans:
                logger.warning(
                    "%d document(s) have vectors but no database row (%d chunks). "
                    "They are invisible in the UI and still answerable in chat. "
                    "Run purge_orphaned_vectors(dry_run=False) to reclaim them.",
                    len(orphans), sum(o["chunks"] for o in orphans),
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            # A failed sweep must never take the API server down with it.
            logger.exception("Document cleanup sweep failed; will retry")

        await asyncio.sleep(settings.CLEANUP_INTERVAL_MINUTES * 60)
