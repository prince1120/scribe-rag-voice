from fastapi import APIRouter, UploadFile, File, Header, HTTPException, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from typing import List, Optional
import asyncio
import os
import json
from uuid import uuid4
from datetime import datetime
import logging

from app.models.schemas import (
    QueryRequest, QueryResponse, DocumentUploadResponse,
    Conversation, ConversationMessage, HealthResponse, SourceCitation,
    PasteTextRequest, DocumentContentResponse, DocumentContentUpdate,
)
from app.config import settings
from app.logging_config import request_id_ctx
from app.auth import verify_api_key
from app.identity import Identity, get_identity
from app.rate_limit import limiter
from app import repositories
from app.utils import sanitize_filename, assign_display_numbers
from app.services import content_editor
from app.services.document_processor import DocumentProcessor
from app.services.embedding_service import EmbeddingService
from app.services.sparse_encoder import SparseEncoder
from app.services.vector_store import VectorStoreService
from app.services.reranker import Reranker
from app.services.rag_pipeline import RAGPipeline
from app.services.vision_ocr import VisionOCR
from app.services.conversation_service import ConversationService
from app.services.storage import (
    StorageError, build_key, cached_path, materialize, storage,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

# Initialize services
embedding_service = EmbeddingService(model_name=settings.EMBEDDING_MODEL)
sparse_encoder = SparseEncoder()
reranker = Reranker()
vector_store = VectorStoreService(
    host=settings.QDRANT_HOST,
    port=settings.QDRANT_PORT,
    collection_name=settings.QDRANT_COLLECTION_NAME,
    vector_size=embedding_service.dimension,
    api_key=settings.QDRANT_API_KEY
)
rag_pipeline = RAGPipeline(
    groq_api_key=settings.GROQ_API_KEY,
    model=settings.GROQ_MODEL,
    vision_model=settings.GROQ_VISION_MODEL,
)
conversation_service = ConversationService(
    redis_host=settings.REDIS_HOST,
    redis_port=settings.REDIS_PORT,
    redis_password=settings.REDIS_PASSWORD
)
vision_ocr = VisionOCR(groq_api_key=settings.GROQ_API_KEY)
document_processor = DocumentProcessor(
    chunk_size=settings.CHUNK_SIZE,
    chunk_overlap=settings.CHUNK_OVERLAP,
    vision_ocr=vision_ocr,
    embedding_service=embedding_service,
)


async def _require_document_manager(identity: Identity):
    """Uploading, editing, and deleting are the owner's alone.

    A contact reaches these routes with a valid session cookie scoped to the
    owner's tenant, so without this check an invite link would carry the right
    to delete every document it can read.
    """
    if not identity.can_manage_documents:
        raise HTTPException(
            status_code=403,
            detail="This link can ask questions, but cannot change documents.",
        )


async def _enforce_demo_document_cap(identity: Identity):
    if identity.is_owner:
        return
    existing = await repositories.list_documents(identity.tenant_id)
    if len(existing) >= settings.DEMO_MAX_DOCUMENTS:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Demo limit reached: up to {settings.DEMO_MAX_DOCUMENTS} documents "
                "per session. Delete one to upload another."
            ),
        )


async def _resolve_image_paths(results: List[dict]) -> None:
    """Give retrieved image chunks a readable local path, in place.

    The RAG pipeline sends images to the vision model by path, but chunks now
    carry a storage key — which for Supabase is not a file on this machine.
    Resolving here (async, before generation) rather than inside the pipeline
    keeps rag_pipeline synchronous and unaware of where files live.
    """
    for result in results:
        payload = result.get("payload") or {}
        if not payload.get("is_image"):
            continue
        key = payload.get("storage_key")
        if not key:
            continue
        path = await cached_path(key, suffix=os.path.splitext(key)[1].lower())
        if path:
            payload["file_path"] = path


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check / readiness probe. Checks every real dependency this
    service needs: vector store, LLM client, DB, and cache. `redis` is
    reported `degraded` rather than `unhealthy` because ConversationService
    transparently falls back to in-memory storage — the app still works,
    just without durable multi-instance conversation memory.
    """
    components = {
        "api": "healthy",
        "vector_store": "unknown",
        "embedding_service": "healthy",
        "llm_client": "unknown",
        "database": "unknown",
        "redis": "unknown",
    }

    try:
        await run_in_threadpool(vector_store.get_collection_info)
        components["vector_store"] = "healthy"
    except Exception as e:
        components["vector_store"] = f"unhealthy: {str(e)}"

    try:
        # Verifies the Groq SDK client + tokenizer are usable. A full
        # roundtrip to the Groq API isn't done here — that would burn quota
        # on every health check / liveness probe.
        await run_in_threadpool(rag_pipeline.count_tokens, "test")
        components["llm_client"] = "healthy"
    except Exception as e:
        components["llm_client"] = f"unhealthy: {str(e)}"

    try:
        async with repositories.async_session() as session:
            await session.execute(repositories.select(1))
        components["database"] = "healthy"
    except Exception as e:
        components["database"] = f"unhealthy: {str(e)}"

    redis_ok = await run_in_threadpool(conversation_service.ping)
    components["redis"] = "healthy" if redis_ok else "degraded (using in-memory fallback)"

    unhealthy = any(v.startswith("unhealthy") for v in components.values())
    status = "unhealthy" if unhealthy else (
        "degraded" if any(v.startswith("degraded") for v in components.values()) else "healthy"
    )

    return HealthResponse(status=status, components=components)


def _remove_quiet(path: str):
    try:
        os.remove(path)
    except OSError:
        pass


async def _ingest_file(
    data: bytes, document_id: str, safe_name: str, tenant_id: str, file_size: int,
) -> DocumentUploadResponse:
    """Shared pipeline: process a file already on disk into chunks, embed,
    upsert into the vector store, and persist its metadata. Used by both
    the file-upload endpoint and the paste-text endpoint (which writes the
    pasted content to a .md file first, then shares this same path)."""
    key = build_key(document_id, safe_name)
    ext = os.path.splitext(safe_name)[1].lower()
    await storage.save(key, data)

    try:
        metadata = {
            "document_id": document_id,
            "filename": safe_name,
            "tenant_id": tenant_id,
            "upload_timestamp": datetime.now().isoformat(),
            "file_size": file_size,
            # The storage key, not a path: with remote storage the path below
            # is a temp file that stops existing once ingestion finishes, so
            # anything needing the file later (image questions) must re-fetch.
            "storage_key": key,
        }

        async with materialize(key, suffix=ext) as file_path:
            chunks = await run_in_threadpool(
                document_processor.process_file, file_path, metadata
            )

        if not chunks:
            await storage.delete(key)
            raise HTTPException(
                status_code=422,
                # Previously blamed a missing Tesseract binary, which sent
                # users chasing an install this app has never needed — OCR
                # runs through a vision model (vision_ocr.py), not Tesseract.
                detail=(
                    "No readable text could be extracted from this file. If it "
                    "is a scanned document or photo, check that the text is in "
                    "focus and right-side up, then try again."
                ),
            )

        # Generate dense + sparse embeddings for hybrid retrieval
        texts = [chunk["content"] for chunk in chunks]
        dense_embeddings = await run_in_threadpool(embedding_service.encode_documents, texts)
        sparse_embeddings = await run_in_threadpool(sparse_encoder.encode_documents, texts)

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
                    "filename": safe_name,
                    **chunk.get("metadata", {})
                }
            })

        await run_in_threadpool(vector_store.upsert_points, points)

        await repositories.save_document(
            document_id=document_id,
            tenant_id=tenant_id,
            filename=safe_name,
            file_size=file_size,
            chunk_count=len(chunks),
        )

        return DocumentUploadResponse(
            document_id=document_id,
            filename=safe_name,
            status="processed",
            message=f"Successfully processed {len(chunks)} chunks",
            chunk_count=len(chunks)
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error ingesting document")
        await storage.delete(key)
        raise HTTPException(status_code=500, detail="Failed to process document")


@router.post(
    "/documents/upload",
    response_model=DocumentUploadResponse,
    dependencies=[Depends(verify_api_key)],
)
@limiter.limit(f"{settings.RATE_LIMIT_UPLOAD_PER_MINUTE}/minute")
async def upload_document(
    request: Request, file: UploadFile = File(...),
    identity: Identity = Depends(get_identity),
):
    """Upload and process a document."""
    tenant_id = identity.tenant_id
    await _require_document_manager(identity)
    await _enforce_demo_document_cap(identity)

    safe_name = sanitize_filename(file.filename)
    ext = os.path.splitext(safe_name)[1].lower()
    if ext not in settings.ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(settings.ALLOWED_UPLOAD_EXTENSIONS)}",
        )

    document_id = str(uuid4())
    max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024

    # Read in 1MB slices and stop the moment the cap is passed, rather than
    # buffering the whole upload and checking afterwards — otherwise the cap
    # does nothing to protect memory against a large upload.
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

    return await _ingest_file(b"".join(parts), document_id, safe_name, tenant_id, size)


@router.post(
    "/documents/paste",
    response_model=DocumentUploadResponse,
    dependencies=[Depends(verify_api_key)],
)
@limiter.limit(f"{settings.RATE_LIMIT_UPLOAD_PER_MINUTE}/minute")
async def paste_text(
    request: Request, body: PasteTextRequest,
    identity: Identity = Depends(get_identity),
):
    """Ingest pasted text as a document, through the same pipeline as a file upload."""
    tenant_id = identity.tenant_id
    await _require_document_manager(identity)
    await _enforce_demo_document_cap(identity)

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

    return await _ingest_file(
        content_bytes, document_id, safe_name, tenant_id, len(content_bytes)
    )


@router.post("/query", response_model=QueryResponse, dependencies=[Depends(verify_api_key)])
@limiter.limit(f"{settings.RATE_LIMIT_QUERY_PER_MINUTE}/minute")
async def query_documents(
    request: Request, body: QueryRequest,
    identity: Identity = Depends(get_identity),
    x_custom_llm_base_url: Optional[str] = Header(default=None, alias="X-Custom-LLM-Base-URL"),
    x_custom_llm_key: Optional[str] = Header(default=None, alias="X-Custom-LLM-Key"),
):
    """Query documents with RAG."""
    try:
        import time
        start_time = time.time()

        tenant_id = identity.tenant_id
        x_user_groq_key = identity.groq_key

        # Get conversation history if available
        conversation_history = None
        if body.conversation_id:
            conversation_history = conversation_service.get_conversation_history(
                body.conversation_id
            )

        # Hybrid retrieval: dense + BM25 sparse, fused by RRF
        # Dense and sparse query encoding are independent — run concurrently
        # instead of paying two sequential model calls.
        query_embedding, sparse_query = await asyncio.gather(
            run_in_threadpool(embedding_service.encode_query, body.query),
            run_in_threadpool(sparse_encoder.encode_query, body.query),
        )

        # Demo sessions (pasted Groq key) get a fixed, smaller top_k regardless
        # of what the client requests.
        final_top_k = settings.DEMO_TOP_K if x_user_groq_key else (body.top_k or settings.RETRIEVAL_TOP_K)
        # Over-fetch from hybrid retrieval, then narrow via cross-encoder rerank
        hybrid_results = await run_in_threadpool(
            vector_store.search,
            query_vector=query_embedding,
            sparse_vector=sparse_query,
            limit=max(final_top_k * 3, 20),
            tenant_id=tenant_id,
            filters=body.filters,
            document_ids=body.document_ids,
        )

        # Cross-encoder rerank for final ordering
        results = await run_in_threadpool(reranker.rerank, body.query, hybrid_results, top_k=final_top_k)

        # Hierarchical citation numbering: doc.chunk (e.g. 1.1, 1.2, 2.1)
        results = assign_display_numbers(results)
        await _resolve_image_paths(results)
        retrieval_ms = int((time.time() - start_time) * 1000)

        if not results:
            return QueryResponse(
                answer="I don't have enough information in the provided documents to answer this question.",
                citations=[],
                conversation_id=body.conversation_id or "",
                processing_time_ms=int((time.time() - start_time) * 1000),
                retrieval_ms=retrieval_ms,
            )

        # Generate response
        llm_start = time.time()
        answer = await run_in_threadpool(
            rag_pipeline.generate_response,
            query=body.query,
            context_chunks=results,
            conversation_history=conversation_history,
            attached_images=body.attached_images,
            temperature=body.temperature if body.temperature is not None else 0.1,
            max_tokens=body.max_tokens or 800,
            groq_api_key=x_user_groq_key,
            override_model=body.model,
            custom_base_url=x_custom_llm_base_url,
            custom_api_key=x_custom_llm_key,
        )
        llm_ms = int((time.time() - llm_start) * 1000)

        # Build citations
        citations = [
            SourceCitation(
                document_id=r["payload"].get("document_id", ""),
                filename=r["payload"].get("filename", "Unknown"),
                chunk_id=r["payload"].get("chunk_id", ""),
                page_number=r["payload"].get("page_number"),
                score=r["score"],
                snippet=r["payload"].get("content", "")[:200] + "..."
            )
            for r in results[:5]
        ]
        
        # Update conversation if provided (Redis/in-memory = fast working
        # context for the LLM, DB = durable history for the UI/list endpoint)
        if body.conversation_id:
            conversation_service.add_message(
                body.conversation_id, "user", body.query
            )
            conversation_service.add_message(
                body.conversation_id, "assistant", answer,
                citations=[c.dict() for c in citations]
            )
            await repositories.append_message(
                body.conversation_id, tenant_id, "user", body.query
            )
            await repositories.append_message(
                body.conversation_id, tenant_id, "assistant", answer,
                citations=[c.dict() for c in citations],
            )
        
        processing_time = int((time.time() - start_time) * 1000)

        return QueryResponse(
            answer=answer,
            citations=citations,
            conversation_id=body.conversation_id or "",
            processing_time_ms=processing_time,
            retrieval_ms=retrieval_ms,
            llm_ms=llm_ms,
        )

    except HTTPException:
        raise
    except Exception:
        # Detail deliberately withheld: str(e) here has included database URLs
        # and filesystem paths. The traceback goes to the logs with the
        # request id attached.
        logger.exception("Error querying")
        raise HTTPException(status_code=500, detail="Failed to answer the query")


@router.post("/query/stream", dependencies=[Depends(verify_api_key)])
@limiter.limit(f"{settings.RATE_LIMIT_QUERY_PER_MINUTE}/minute")
async def query_stream(
    request: Request, body: QueryRequest,
    identity: Identity = Depends(get_identity),
    x_custom_llm_base_url: Optional[str] = Header(default=None, alias="X-Custom-LLM-Base-URL"),
    x_custom_llm_key: Optional[str] = Header(default=None, alias="X-Custom-LLM-Key"),
):
    """Stream query response compatible with Vercel AI SDK useChat."""
    try:
        import time
        request_start = time.time()

        tenant_id = identity.tenant_id
        x_user_groq_key = identity.groq_key

        # Get conversation history
        _t = time.time()
        conversation_history = None
        if body.conversation_id:
            conversation_history = conversation_service.get_conversation_history(
                body.conversation_id
            )
        logger.info(f"[timing] conversation history fetch: {(time.time()-_t)*1000:.0f}ms")

        # Hybrid retrieval: dense + BM25 sparse with RRF fusion, then rerank
        # Dense and sparse query encoding are independent — run concurrently
        # instead of paying two sequential model calls.
        _t = time.time()
        query_embedding, sparse_query = await asyncio.gather(
            run_in_threadpool(embedding_service.encode_query, body.query),
            run_in_threadpool(sparse_encoder.encode_query, body.query),
        )
        logger.info(f"[timing] query embedding (dense+sparse): {(time.time()-_t)*1000:.0f}ms")

        # Demo sessions (pasted Groq key) get a fixed, smaller top_k regardless
        # of what the client requests.
        final_top_k = settings.DEMO_TOP_K if x_user_groq_key else (body.top_k or settings.RETRIEVAL_TOP_K)
        _t = time.time()
        hybrid_results = await run_in_threadpool(
            vector_store.search,
            query_vector=query_embedding,
            sparse_vector=sparse_query,
            limit=max(final_top_k * 3, 20),
            tenant_id=tenant_id,
            filters=body.filters,
            document_ids=body.document_ids,
        )
        logger.info(f"[timing] vector_store.search total: {(time.time()-_t)*1000:.0f}ms")

        _t = time.time()
        results = await run_in_threadpool(reranker.rerank, body.query, hybrid_results, top_k=final_top_k)
        logger.info(f"[timing] rerank: {(time.time()-_t)*1000:.0f}ms")

        # Hierarchical citation numbering: doc.chunk (e.g. 1.1, 1.2, 2.1)
        results = assign_display_numbers(results)
        await _resolve_image_paths(results)
        retrieval_ms = int((time.time() - request_start) * 1000)

        if not results:
            msg = json.dumps({"text": "I don't have enough information in the provided documents."})
            return StreamingResponse(
                iter([f"data: {msg}\n\n"]),
                media_type="text/event-stream"
            )
        
        # Build citations for the response
        def _build_citation(r):
            payload = r.get("payload") or {}
            full = payload.get("content", "") or ""
            short = (full[:240] + "…") if len(full) > 240 else full
            return {
                "document_id": payload.get("document_id", ""),
                "filename": payload.get("filename", "Unknown"),
                "chunk_id": payload.get("chunk_id", ""),
                "page_number": payload.get("page_number"),
                "chunk_index": payload.get("chunk_index"),
                "score": r.get("score", 0.0),
                "snippet": short,
                "content": full,
                "display_number": r.get("display_number"),
            }

        citations = [_build_citation(r) for r in results[:5]]

        # generate() runs in a worker thread (Starlette wraps sync generators
        # passed to StreamingResponse via iterate_in_threadpool), so DB writes
        # from inside it must be scheduled back onto this event loop.
        loop = asyncio.get_running_loop()

        def _persist(role: str, content: str, msg_citations: Optional[list] = None):
            if not body.conversation_id:
                return
            conversation_service.add_message(
                body.conversation_id, role, content, citations=msg_citations
            )
            try:
                asyncio.run_coroutine_threadsafe(
                    repositories.append_message(
                        body.conversation_id, tenant_id, role, content,
                        citations=msg_citations,
                    ),
                    loop,
                ).result(timeout=10)
            except Exception as e:
                logger.error(f"Failed to persist message: {e}")

        # Stream response in format compatible with Vercel AI SDK
        def generate():
            full_response = ""
            first_token_at: Optional[float] = None
            if body.conversation_id:
                _persist("user", body.query)

            try:
                for token in rag_pipeline.generate_streaming_response(
                    query=body.query,
                    context_chunks=results,
                    conversation_history=conversation_history,
                    attached_images=body.attached_images,
                    temperature=body.temperature if body.temperature is not None else 0.1,
                    max_tokens=body.max_tokens or 800,
                    groq_api_key=x_user_groq_key,
                    override_model=body.model,
                    custom_base_url=x_custom_llm_base_url,
                    custom_api_key=x_custom_llm_key,
                ):
                    if first_token_at is None:
                        first_token_at = time.time()
                    full_response += token
                    # Send each token as JSON with 'text' field
                    data = json.dumps({"text": token})
                    yield f"data: {data}\n\n"
            except Exception:
                # The response already started with a 200, so raising here just
                # drops the connection and the client waits forever. An error
                # frame is the only way to tell it something went wrong.
                logger.exception("Streaming generation failed mid-response")
                error = json.dumps({
                    "error": (
                        "The answer was interrupted. This is usually a rate "
                        "limit or a model timeout — please try again."
                    ),
                    "request_id": request_id_ctx.get(),
                })
                yield f"data: {error}\n\n"
                # Whatever was generated before the failure is still worth
                # keeping: the user saw it, so the transcript should match.
                if body.conversation_id and full_response:
                    _persist("assistant", full_response, citations)
                yield "data: [DONE]\n\n"
                return

            if body.conversation_id:
                _persist("assistant", full_response, citations)

            # Latency breakdown: retrieval (embed+search+rerank) vs time to
            # first token (includes retrieval + LLM prefill) vs full request.
            ttft_ms = int(((first_token_at or time.time()) - request_start) * 1000)
            total_ms = int((time.time() - request_start) * 1000)
            metrics_data = json.dumps({
                "metrics": {"retrieval_ms": retrieval_ms, "ttft_ms": ttft_ms, "total_ms": total_ms}
            })
            yield f"data: {metrics_data}\n\n"

            # Send citations as a special message at the end
            if citations:
                citation_data = json.dumps({"annotations": citations})
                yield f"data: {citation_data}\n\n"

            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")
        
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error in stream query")
        raise HTTPException(status_code=500, detail="Failed to answer the query")


@router.get("/documents", response_model=List[DocumentUploadResponse], dependencies=[Depends(verify_api_key)])
async def get_documents(
    identity: Identity = Depends(get_identity),
):
    """List previously uploaded documents for a tenant (persisted, survives restarts)."""
    tenant_id = identity.tenant_id
    records = await repositories.list_documents(tenant_id)
    return [
        DocumentUploadResponse(
            document_id=r.document_id,
            filename=r.filename,
            status=r.status,
            message="",
            chunk_count=r.chunk_count,
        )
        for r in records
    ]


@router.get("/conversations", response_model=List[Conversation], dependencies=[Depends(verify_api_key)])
async def list_conversations(
    identity: Identity = Depends(get_identity),
):
    """List conversations for a tenant."""
    tenant_id = identity.tenant_id
    records = await repositories.list_conversations(tenant_id)
    return [
        Conversation(
            conversation_id=r.conversation_id,
            tenant_id=r.tenant_id,
            messages=[
                ConversationMessage(
                    role=m.role,
                    content=m.content,
                    timestamp=m.created_at.isoformat(),
                    citations=m.citations,
                )
                for m in sorted(r.messages, key=lambda m: m.created_at)
            ],
            created_at=r.created_at.isoformat(),
            updated_at=r.updated_at.isoformat(),
        )
        for r in records
    ]


@router.post("/conversations", response_model=dict, dependencies=[Depends(verify_api_key)])
async def create_conversation(
    identity: Identity = Depends(get_identity),
):
    """Create a new conversation."""
    tenant_id = identity.tenant_id
    conversation_id = conversation_service.create_conversation(tenant_id)
    await repositories.get_or_create_conversation(conversation_id, tenant_id)
    return {"conversation_id": conversation_id, "status": "created"}


@router.delete("/documents/{document_id}", dependencies=[Depends(verify_api_key)])
async def delete_document(
    document_id: str,
    identity: Identity = Depends(get_identity),
):
    """Delete a document and its chunks."""
    await _require_document_manager(identity)
    tenant_id = identity.tenant_id
    record = await repositories.get_document_record(document_id, tenant_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found or access denied")
    try:
        await run_in_threadpool(vector_store.delete_by_document, document_id, tenant_id)
        await storage.delete(build_key(document_id, record.filename))
        await repositories.delete_document_record(document_id, tenant_id)
        return {"status": "deleted", "document_id": document_id}
    except Exception as e:
        logger.error(f"Error deleting document: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete document")


_INLINE_MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".svg": "image/svg+xml",
}


@router.get("/documents/{document_id}/file", dependencies=[Depends(verify_api_key)])
async def get_document_file(
    document_id: str,
    identity: Identity = Depends(get_identity),
):
    """Serve the original uploaded file inline, with strict DB tenant ownership validation."""
    tenant_id = identity.tenant_id
    record = await repositories.get_document_record(document_id, tenant_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document file not found or access denied")

    original_name = record.filename
    ext = os.path.splitext(original_name)[1].lower()
    media_type = _INLINE_MEDIA_TYPES.get(ext, "application/octet-stream")

    try:
        data = await storage.read(build_key(document_id, original_name))
    except StorageError:
        raise HTTPException(status_code=404, detail="Document file not found")

    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{original_name}"'},
    )


_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif"}


def _strip_image_header(text: str) -> str:
    """Strip the "[Image: filename]\\n" header we prefix onto OCR'd chunks
    before showing the text in the editor."""
    if not text.startswith("[Image: "):
        return text
    end = text.find("]\n")
    if end != -1:
        return text[end + 2:]
    end = text.find("]")
    return text[end + 1:] if end != -1 else text


@router.get(
    "/documents/{document_id}/content",
    response_model=DocumentContentResponse,
    dependencies=[Depends(verify_api_key)],
)
async def get_document_content(
    document_id: str,
    identity: Identity = Depends(get_identity),
):
    """Return an editable plain-text representation of a document's content
    (view/edit without downloading)."""
    tenant_id = identity.tenant_id
    record = await repositories.get_document_record(document_id, tenant_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found or access denied")

    original_name = record.filename
    ext = os.path.splitext(original_name)[1].lower()
    key = build_key(document_id, original_name)

    if ext in _IMAGE_EXTENSIONS:
        chunks = await run_in_threadpool(vector_store.get_document_chunks, document_id, tenant_id)
        raw = "\n\n".join(c["content"] for c in chunks)
        return DocumentContentResponse(
            document_id=document_id, filename=original_name,
            content=_strip_image_header(raw), editable=True, is_image=True,
        )

    if not content_editor.is_editable(ext):
        return DocumentContentResponse(
            document_id=document_id, filename=original_name, content="",
            editable=False, is_image=False,
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
        document_id=document_id, filename=original_name, content=content,
        editable=True, is_image=False,
    )


@router.put(
    "/documents/{document_id}/content",
    response_model=DocumentUploadResponse,
    dependencies=[Depends(verify_api_key)],
)
@limiter.limit(f"{settings.RATE_LIMIT_UPLOAD_PER_MINUTE}/minute")
async def update_document_content(
    request: Request, document_id: str, body: DocumentContentUpdate,
    identity: Identity = Depends(get_identity),
):
    """Edit a document's text content in place and re-index it so chat reflects the edit immediately."""
    await _require_document_manager(identity)
    tenant_id = identity.tenant_id
    record = await repositories.get_document_record(document_id, tenant_id)
    if not record:
        raise HTTPException(status_code=404, detail="Document not found or access denied")
    original_name = record.filename
    ext = os.path.splitext(original_name)[1].lower()
    key = build_key(document_id, original_name)
    file_size = record.file_size

    try:
        if ext in _IMAGE_EXTENSIONS:
            # Don't touch the image file — only its OCR'd text is editable.
            # Chunk the edited text directly instead of process_file, which
            # would re-run OCR and overwrite the user's edits.
            text_chunks = await run_in_threadpool(document_processor.chunk_text, body.content)
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
            # Rewrite the source file in its original format, push it back to
            # storage, then re-chunk from the rewritten copy so the index and
            # the downloadable file can't disagree.
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
                    "upload_timestamp": datetime.now().isoformat(),
                    "file_size": file_size,
                    "storage_key": key,
                }
                chunks = await run_in_threadpool(
                    document_processor.process_file, file_path, metadata
                )
        else:
            raise HTTPException(status_code=415, detail=f"Editing not supported for '{ext}'")

        if not chunks:
            raise HTTPException(status_code=422, detail="Edited content produced no indexable text")

        texts = [c["content"] for c in chunks]
        dense_embeddings = await run_in_threadpool(embedding_service.encode_documents, texts)
        sparse_embeddings = await run_in_threadpool(sparse_encoder.encode_documents, texts)

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

        await run_in_threadpool(vector_store.delete_by_document, document_id, tenant_id)
        await run_in_threadpool(vector_store.upsert_points, points)

        await repositories.update_document(document_id, tenant_id, len(chunks), file_size)

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
