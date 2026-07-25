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


async def _purge(document_id: str, tenant_id: str, filename: str) -> None:
    """Remove one document from all three stores.

    Each step is independently guarded: a Qdrant outage must not leave the row
    and file behind forever, and a storage failure must not stop the row being
    reclaimed. Anything that fails here is retried on the next sweep, because
    every step is idempotent.
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
        logger.warning("Could not delete vectors for %s", document_id, exc_info=True)

    try:
        await storage.delete(build_key(document_id, filename))
    except Exception:
        logger.warning("Could not delete file for %s", document_id, exc_info=True)

    await repositories.delete_document_record(document_id, tenant_id)


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
        except asyncio.CancelledError:
            raise
        except Exception:
            # A failed sweep must never take the API server down with it.
            logger.exception("Document cleanup sweep failed; will retry")

        await asyncio.sleep(settings.CLEANUP_INTERVAL_MINUTES * 60)
