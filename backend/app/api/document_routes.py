from datetime import datetime, timezone
import logging
import os
from typing import List, Optional
import urllib.parse
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.api import routes
from app.auth import verify_api_key
from app.config import settings
from app.identity import Identity, get_identity
from app.models.schemas import (
    DocumentContentResponse,
    DocumentContentUpdate,
    DocumentEnabledUpdate,
    DocumentUploadResponse,
    PasteTextRequest,
)
from app.rate_limit import limiter
from app.services import content_editor
from app.services.storage import StorageError, build_key, materialize, storage
from app.utils import sanitize_filename

logger = logging.getLogger(__name__)

router = APIRouter(tags=["documents"])


@router.post(
    "/documents/upload",
    response_model=DocumentUploadResponse,
    dependencies=[Depends(verify_api_key)],
)
@limiter.limit(f"{settings.RATE_LIMIT_UPLOAD_PER_MINUTE}/minute")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    identity: Identity = Depends(get_identity),
    purpose: Optional[str] = None,
):
    """Upload and process a document. purpose=agent (creation) vs rag (live)."""
    tenant_id = identity.tenant_id
    await routes._require_document_manager(identity)
    await routes._enforce_document_cap(identity)
    raw_purpose = purpose or request.query_params.get("purpose")
    purpose_val = "agent" if (raw_purpose or "").strip().lower() == "agent" else "rag"

    safe_name = sanitize_filename(file.filename)
    ext = os.path.splitext(safe_name)[1].lower()
    if ext not in settings.ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(settings.ALLOWED_UPLOAD_EXTENSIONS)}",
        )

    document_id = str(uuid4())
    max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024

    parts: list[bytes] = []
    size = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds max size of {settings.MAX_FILE_SIZE_MB}MB",
            )
        parts.append(chunk)

    return await routes._ingest_file(
        b"".join(parts), document_id, safe_name, tenant_id, size, purpose=purpose_val
    )


@router.post(
    "/documents/paste",
    response_model=DocumentUploadResponse,
    dependencies=[Depends(verify_api_key)],
)
@limiter.limit(f"{settings.RATE_LIMIT_UPLOAD_PER_MINUTE}/minute")
async def paste_text(
    request: Request,
    body: PasteTextRequest,
    identity: Identity = Depends(get_identity),
    purpose: Optional[str] = None,
):
    """Ingest pasted text as a document, through the same pipeline as a file upload."""
    tenant_id = identity.tenant_id
    await routes._require_document_manager(identity)
    await routes._enforce_document_cap(identity)
    raw_purpose = purpose or request.query_params.get("purpose")
    purpose_val = "agent" if (raw_purpose or "").strip().lower() == "agent" else "rag"

    document_id = str(uuid4())
    safe_name = sanitize_filename(body.title) or "pasted-text"
    if not safe_name.lower().endswith(".md"):
        safe_name += ".md"

    content_bytes = body.content.encode("utf-8")
    max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(content_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Pasted content exceeds max size of {settings.MAX_FILE_SIZE_MB}MB",
        )

    return await routes._ingest_file(
        content_bytes, document_id, safe_name, tenant_id, len(content_bytes), purpose=purpose_val
    )


@router.get(
    "/documents",
    response_model=List[DocumentUploadResponse],
    dependencies=[Depends(verify_api_key)],
)
async def get_documents(
    identity: Identity = Depends(get_identity),
    purpose: Optional[str] = None,
):
    """List previously uploaded documents for a tenant."""
    tenant_id = identity.tenant_id
    records = await routes.repositories.list_documents(
        tenant_id, purpose=purpose if purpose in ("agent", "rag") else None
    )
    return [
        DocumentUploadResponse(
            document_id=r.document_id,
            filename=r.filename,
            status=r.status,
            message="",
            chunk_count=r.chunk_count,
            agent_enabled=bool(getattr(r, "agent_enabled", True)),
        )
        for r in records
    ]


@router.patch(
    "/documents/{document_id}/enabled",
    dependencies=[Depends(verify_api_key)],
)
async def set_document_enabled(
    document_id: str,
    body: DocumentEnabledUpdate,
    identity: Identity = Depends(get_identity),
):
    """Include or exclude one document from the owner's assistant."""
    await routes._require_document_manager(identity)
    tenant_id = identity.tenant_id

    if not await routes.repositories.set_document_enabled(
        document_id, tenant_id, body.enabled
    ):
        raise HTTPException(status_code=404, detail="Document not found or access denied")

    routes._invalidate_document_selection(tenant_id)
    return {"document_id": document_id, "agent_enabled": body.enabled}


@router.delete(
    "/documents/{document_id}",
    dependencies=[Depends(verify_api_key)],
)
async def delete_document(
    document_id: str,
    identity: Identity = Depends(get_identity),
):
    """Delete a document and its chunks."""
    await routes._require_document_manager(identity)
    tenant_id = identity.tenant_id
    record = await routes.repositories.get_document_record(document_id, tenant_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found or access denied")
    try:
        await run_in_threadpool(routes.vector_store.delete_by_document, document_id, tenant_id)
        await storage.delete(build_key(document_id, record.filename))
        await routes.repositories.delete_document_record(document_id, tenant_id)
        routes._invalidate_document_selection(tenant_id)
        return {"status": "deleted", "document_id": document_id}
    except Exception as e:
        logger.error(f"Error deleting document: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete document")


@router.get(
    "/documents/{document_id}/file",
    dependencies=[Depends(verify_api_key)],
)
async def get_document_file(
    document_id: str,
    identity: Identity = Depends(get_identity),
):
    """Serve the original uploaded file inline, with strict DB tenant ownership validation."""
    tenant_id = identity.tenant_id
    record = await routes.repositories.get_document_record(document_id, tenant_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document file not found or access denied")

    original_name = record.filename
    ext = os.path.splitext(original_name)[1].lower()
    media_type = routes._INLINE_MEDIA_TYPES.get(ext, "application/octet-stream")

    try:
        data = await storage.read(build_key(document_id, original_name))
    except StorageError:
        raise HTTPException(status_code=404, detail="Document file not found")

    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{urllib.parse.quote(original_name)}"},
    )


@router.get(
    "/documents/{document_id}/content",
    response_model=DocumentContentResponse,
    dependencies=[Depends(verify_api_key)],
)
async def get_document_content(
    document_id: str,
    identity: Identity = Depends(get_identity),
):
    """Return an editable plain-text representation of a document's content."""
    tenant_id = identity.tenant_id
    record = await routes.repositories.get_document_record(document_id, tenant_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found or access denied")

    original_name = record.filename
    ext = os.path.splitext(original_name)[1].lower()
    key = build_key(document_id, original_name)

    if ext in routes._IMAGE_EXTENSIONS:
        chunks = await run_in_threadpool(routes.vector_store.get_document_chunks, document_id, tenant_id)
        raw = "\n\n".join(c["content"] for c in chunks)
        return DocumentContentResponse(
            document_id=document_id,
            filename=original_name,
            content=routes._strip_image_header(raw),
            editable=True,
            is_image=True,
        )

    if not content_editor.is_editable(ext):
        return DocumentContentResponse(
            document_id=document_id,
            filename=original_name,
            content="",
            editable=False,
            is_image=False,
        )

    try:
        async with materialize(key, suffix=ext) as file_path:
            content = await run_in_threadpool(
                content_editor.extract_editable_text, file_path, ext
            )
    except StorageError:
        raise HTTPException(status_code=404, detail="Document file not found")
    except Exception:
        logger.exception("Error extracting content for %s", document_id)
        raise HTTPException(status_code=500, detail="Failed to read document content")

    return DocumentContentResponse(
        document_id=document_id,
        filename=original_name,
        content=content,
        editable=True,
        is_image=False,
    )


@router.put(
    "/documents/{document_id}/content",
    response_model=DocumentUploadResponse,
    dependencies=[Depends(verify_api_key)],
)
@limiter.limit(f"{settings.RATE_LIMIT_UPLOAD_PER_MINUTE}/minute")
async def update_document_content(
    request: Request,
    document_id: str,
    body: DocumentContentUpdate,
    identity: Identity = Depends(get_identity),
):
    """Edit a document's text content in place and re-index it."""
    await routes._require_document_manager(identity)
    tenant_id = identity.tenant_id
    record = await routes.repositories.get_document_record(document_id, tenant_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found or access denied")
    original_name = record.filename
    ext = os.path.splitext(original_name)[1].lower()
    key = build_key(document_id, original_name)
    file_size = record.file_size

    try:
        if ext in routes._IMAGE_EXTENSIONS:
            text_chunks = await run_in_threadpool(routes.document_processor.chunk_text, body.content)
            if not text_chunks or not any(t.strip() for t in text_chunks):
                text_chunks = ["(no readable text)"]
            chunks = [
                {
                    "chunk_id": str(uuid4()),
                    "document_id": document_id,
                    "content": f"[Image: {original_name}]\n{t}",
                    "chunk_index": i,
                    "metadata": {
                        "document_id": document_id,
                        "filename": original_name,
                        "is_image": True,
                        "storage_key": key,
                    },
                }
                for i, t in enumerate(text_chunks)
            ]
        elif content_editor.is_editable(ext):
            async with materialize(key, suffix=ext) as file_path:
                await run_in_threadpool(
                    content_editor.write_editable_text, file_path, ext, body.content
                )
                file_size = os.path.getsize(file_path)
                with open(file_path, "rb") as handle:
                    await storage.save(key, handle.read())

                metadata = {
                    "document_id": document_id,
                    "filename": original_name,
                    "tenant_id": tenant_id,
                    "upload_timestamp": datetime.now(timezone.utc).isoformat(),
                    "file_size": file_size,
                    "storage_key": key,
                }
                chunks = await run_in_threadpool(
                    routes.document_processor.process_file, file_path, metadata
                )
        else:
            raise HTTPException(status_code=415, detail=f"Editing not supported for '{ext}'")

        if not chunks:
            raise HTTPException(status_code=422, detail="Edited content produced no indexable text")

        texts = [c["content"] for c in chunks]
        dense_embeddings = await run_in_threadpool(routes.embedding_service.encode_documents, texts)
        sparse_embeddings = await run_in_threadpool(routes.sparse_encoder.encode_documents, texts)

        points = []
        for chunk, dense, sparse in zip(chunks, dense_embeddings, sparse_embeddings):
            points.append({
                "id": chunk["chunk_id"],
                "dense_vector": dense,
                "sparse_vector": sparse,
                "payload": {
                    "chunk_id": chunk["chunk_id"],
                    "document_id": chunk["document_id"],
                    "content": chunk["content"],
                    "chunk_index": chunk["chunk_index"],
                    "tenant_id": tenant_id,
                    "filename": original_name,
                    **chunk.get("metadata", {}),
                }
            })

        await run_in_threadpool(routes.vector_store.delete_by_document, document_id, tenant_id)
        await run_in_threadpool(routes.vector_store.upsert_points, points)

        await routes.repositories.update_document(document_id, tenant_id, len(chunks), file_size)
        routes._invalidate_document_selection(tenant_id)

        return DocumentUploadResponse(
            document_id=document_id,
            filename=original_name,
            status="processed",
            message=f"Re-indexed with {len(chunks)} chunks",
            chunk_count=len(chunks),
        )
    except HTTPException:
        raise
    except StorageError:
        raise HTTPException(status_code=404, detail="Document file not found")
    except Exception:
        logger.exception("Error updating document content")
        raise HTTPException(status_code=500, detail="Failed to update document")
