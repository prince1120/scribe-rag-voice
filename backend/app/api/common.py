import asyncio
from collections import defaultdict
from datetime import datetime, timezone
import logging
import os
import time as _cache_time
from typing import List, Optional

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from app import repositories
from app.config import settings
from app.identity import Identity
from app.models.schemas import DocumentUploadResponse
from app.services.conversation_service import ConversationService
from app.services.document_processor import DocumentProcessor
from app.services.embedding_service import EmbeddingService
from app.services.rag_pipeline import RAGPipeline
from app.services.sparse_encoder import SparseEncoder
from app.services.storage import (
    StorageError, build_key, cached_path, materialize, storage,
)
from app.services.vector_store import VectorStoreService
from app.services.vision_ocr import VisionOCR

logger = logging.getLogger(__name__)

# Lightweight in-memory caches for Phase 4 token saving (per-process, TTL-based)
_answer_cache: dict = defaultdict(dict)  # tenant_id -> key -> (answer, citations, expires_at)
_prompt_prefix_cache: dict = {}

# Ceiling for the chat retrieval path (embeddings + vector search).
_RAG_TIMEOUT_S = 8.0


def _query_aware_top_k(query: str, requested: Optional[int], is_demo: bool, has_images: bool) -> int:
    if requested is not None:
        return requested
    if is_demo:
        return settings.DEMO_TOP_K
    if has_images:
        return settings.RETRIEVAL_TOP_K
    words = len((query or "").strip().split())
    if words <= 8:
        return 3   # yes/no, short fact → 3 chunks ~800 tokens
    if words <= 25:
        return 5   # medium → 5 chunks ~1500 tokens
    return settings.RETRIEVAL_TOP_K  # long → 10


def _answer_cache_get(tenant_id: str, key: str):
    tenant_cache = _answer_cache[tenant_id]
    entry = tenant_cache.get(key)
    if not entry:
        return None
    ans, cits, exp = entry
    if _cache_time.time() > exp:
        tenant_cache.pop(key, None)
        return None
    tenant_cache.pop(key, None)
    tenant_cache[key] = (ans, cits, exp)
    return ans, cits


def _answer_cache_set(tenant_id: str, key: str, ans, cits, ttl: int = 300):
    tenant_cache = _answer_cache[tenant_id]
    if len(tenant_cache) > 256:
        oldest = next(iter(tenant_cache))
        tenant_cache.pop(oldest, None)
    tenant_cache[key] = (ans, cits, _cache_time.time() + ttl)


# Initialize shared services
embedding_service = EmbeddingService(model_name=settings.EMBEDDING_MODEL)
sparse_encoder = SparseEncoder()
vector_store = VectorStoreService(
    host=settings.QDRANT_HOST,
    port=settings.QDRANT_PORT,
    collection_name=settings.QDRANT_COLLECTION_NAME,
    vector_size=embedding_service.dimension,
    api_key=settings.QDRANT_API_KEY,
    https=settings.QDRANT_HTTPS,
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
    """Uploading, editing, and deleting are the owner's alone."""
    if not identity.can_manage_documents:
        raise HTTPException(
            status_code=403,
            detail="This link can ask questions, but cannot change documents.",
        )


async def _enforce_document_cap(identity: Identity):
    """Cap uploads by workspace type."""
    from app.services import owner_service

    workspace = await owner_service.get_or_create_workspace(identity.tenant_id)
    if workspace.is_business:
        existing = await repositories.list_documents(identity.tenant_id)
        if len(existing) >= owner_service.MAX_BUSINESS_DOCUMENTS:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"An assistant can use up to "
                    f"{owner_service.MAX_BUSINESS_DOCUMENTS} documents. "
                    "Remove one to add another."
                ),
            )
        return

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


async def _chat_overrides(identity: Identity, x_user_groq_key, x_custom_llm_base_url, x_custom_llm_key):
    """Agent prompt and credentials for a chat turn."""
    from app.services import owner_service

    agent, workspace = await asyncio.gather(
        owner_service.cached_agent(identity.tenant_id),
        owner_service.cached_owner(identity.tenant_id),
    )
    channel = owner_service.channel_settings(agent, "chat")

    cal_summary = ""
    try:
        from app.services import calendar_service as cal
        svcs = await cal.list_services(identity.tenant_id)
        if svcs:
            lines = []
            for s in svcs:
                s_name = getattr(s, "name", None) or (s.get("name") if isinstance(s, dict) else "")
                s_dur = getattr(s, "duration_mins", None) or (s.get("duration_mins") if isinstance(s, dict) else 30)
                if s_name:
                    lines.append(f"- {s_name} ({s_dur} mins)")
            if lines:
                cal_summary = "Active bookable services:\n" + "\n".join(lines) + "\nFor appointments, ask for preferred date and time."
    except Exception:
        pass

    agent_prompt = None
    if agent is not None and channel.get("script"):
        agent_prompt = owner_service.build_agent_prompt(
            script=channel["script"],
            agent_name=agent.name,
            business_name=workspace.business_name if workspace else None,
            channel="chat",
            style_rules=channel.get("style_rules", True),
            calendar_summary=cal_summary,
        )

    _crag = getattr(agent, "chat_rag_enabled", None)
    chat_rag_enabled = bool(_crag) if _crag is not None else False

    stored = await owner_service.resolve_credentials(
        identity.tenant_id, record=workspace
    )
    return {
        "agent_prompt": agent_prompt,
        "chat_rag_enabled": chat_rag_enabled,
        "groq_api_key": x_user_groq_key or stored.get("groq_api_key"),
        "custom_base_url": (
            x_custom_llm_base_url
            or channel.get("base_url")
            or stored.get("custom_llm_base_url")
        ),
        "custom_api_key": (
            x_custom_llm_key
            or channel.get("api_key")
            or stored.get("custom_llm_api_key")
        ),
        "model": channel.get("model") or stored.get("llm_model"),
        "temperature": channel.get("temperature"),
        "max_tokens": channel.get("max_tokens"),
    }


class NoDocumentsSelected(Exception):
    """The assistant has no documents to answer from — not an error."""


def _invalidate_document_selection(tenant_id: str) -> None:
    """Drop the cached selection after anything that changes which documents exist or are enabled."""
    from app.services import cache

    cache.config_cache.invalidate(("docs", tenant_id))
    try:
        _answer_cache.pop(tenant_id, None)
    except Exception:
        pass


async def selected_document_ids(
    tenant_id: str, requested: Optional[List[str]] = None
) -> List[str]:
    """Which documents this turn may retrieve from."""
    from app.services import cache

    enabled = await cache.config_cache.get_or_load(
        ("docs", tenant_id),
        lambda: repositories.list_enabled_document_ids(tenant_id),
    )
    enabled = enabled or []
    if not enabled:
        raise NoDocumentsSelected()

    if requested:
        allowed = set(enabled)
        narrowed = [d for d in requested if d in allowed]
        if not narrowed:
            raise NoDocumentsSelected()
        return narrowed

    return list(enabled)


async def _resolve_image_paths(results: List[dict]) -> None:
    """Give retrieved image chunks a readable local path, in place."""
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


def _remove_quiet(path: str):
    try:
        os.remove(path)
    except OSError:
        pass


_INLINE_MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".html": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".svg": "text/plain; charset=utf-8",
}

_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif"}


def _strip_image_header(text: str) -> str:
    """Strip the '[Image: filename]\\n' header from OCR chunks."""
    if not text.startswith("[Image: "):
        return text
    end = text.find("]\n")
    if end != -1:
        return text[end + 2:]
    end = text.find("]")
    return text[end + 1:] if end != -1 else text


async def _ingest_file(
    data: bytes, document_id: str, safe_name: str, tenant_id: str, file_size: int, purpose: str = "rag",
    source_snapshot_id: Optional[str] = None,
) -> DocumentUploadResponse:
    """Shared pipeline: process file data into chunks, embed, upsert to vector store, and persist."""
    key = build_key(document_id, safe_name)
    ext = os.path.splitext(safe_name)[1].lower()
    await storage.save(key, data)

    try:
        metadata = {
            "document_id": document_id,
            "filename": safe_name,
            "tenant_id": tenant_id,
            "upload_timestamp": datetime.now(timezone.utc).isoformat(),
            "file_size": file_size,
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
                detail=(
                    "No readable text could be extracted from this file. If it "
                    "is a scanned document or photo, check that the text is in "
                    "focus and right-side up, then try again."
                ),
            )

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

        _UPSERT_BATCH = 256
        for i in range(0, len(points), _UPSERT_BATCH):
            await run_in_threadpool(vector_store.upsert_points, points[i : i + _UPSERT_BATCH])

        await repositories.save_document(
            document_id=document_id,
            tenant_id=tenant_id,
            filename=safe_name,
            file_size=file_size,
            chunk_count=len(chunks),
            purpose="agent" if purpose == "agent" else "rag",
            source_snapshot_id=source_snapshot_id,
        )
        _invalidate_document_selection(tenant_id)

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
