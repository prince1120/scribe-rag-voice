"""
API Router Aggregator.

Decomposed into domain modules:
- app.api.health_routes: /health/live, /health/ready, /health
- app.api.conversation_routes: /conversations
- app.api.document_routes: /documents/*
- app.api.query_routes: /query, /query/stream
- app.api.common: shared singletons, caches, and storage/ingestion helpers

All singletons, helpers, and route endpoints are re-exported from this module
for complete backward compatibility with external services and test suites.
"""

from fastapi import APIRouter

from app import repositories
from app.api import common
from app.api.common import (  # noqa: F401
    NoDocumentsSelected,
    _IMAGE_EXTENSIONS,
    _INLINE_MEDIA_TYPES,
    _RAG_TIMEOUT_S,
    _answer_cache,
    _answer_cache_get,
    _answer_cache_set,
    _chat_overrides,
    _enforce_document_cap,
    _ingest_file,
    _invalidate_document_selection,
    _prompt_prefix_cache,
    _query_aware_top_k,
    _remove_quiet,
    _require_document_manager,
    _resolve_image_paths,
    _strip_image_header,
    conversation_service,
    document_processor,
    embedding_service,
    rag_pipeline,
    selected_document_ids,
    sparse_encoder,
    vector_store,
    vision_ocr,
)
from app.services import content_editor  # noqa: F401
from app.services.guardrails import filter_output, is_prompt_injection  # noqa: F401
from app.services.guardrails.prompt_wrapper import build_hierarchy_header  # noqa: F401
from app.services.storage import (  # noqa: F401
    StorageError,
    build_key,
    cached_path,
    materialize,
    storage,
)
from app.utils import assign_display_numbers, sanitize_filename  # noqa: F401

# Master Router
router = APIRouter()

# Import domain routers and endpoints
from app.api.conversation_routes import (  # noqa: E402, F401
    create_conversation,
    list_conversations,
    router as conversation_router,
)
from app.api.document_routes import (  # noqa: E402, F401
    delete_document,
    get_document_content,
    get_document_file,
    get_documents,
    paste_text,
    router as document_router,
    set_document_enabled,
    update_document_content,
    upload_document,
)
from app.api.health_routes import (  # noqa: E402, F401
    health_check,
    health_live,
    health_ready,
    router as health_router,
)
from app.api.query_routes import (  # noqa: E402, F401
    query_documents,
    query_stream,
    router as query_router,
)

# Register sub-routers onto the master router
router.include_router(health_router)
router.include_router(conversation_router)
router.include_router(document_router)
router.include_router(query_router)
