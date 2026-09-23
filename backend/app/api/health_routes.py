import logging
from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from app.api import routes
from app.config import settings
from app.models.schemas import HealthResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health/live", response_model=HealthResponse)
async def health_live():
    """Liveness probe – proves the FastAPI process is alive.

    Must not contact PostgreSQL, Redis, Qdrant, embedding services, or an LLM.
    Returns immediately (<50 ms) with a small stable JSON payload.
    """
    return HealthResponse(status="healthy", components={"api": "healthy"})


async def _readiness_components() -> dict:
    """Dependency-aware readiness check.

    Checks vector_store, llm_client (tokenizer), database, redis.
    Redis degradation does not make the service unhealthy (in-memory fallback).
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
        await run_in_threadpool(routes.vector_store.get_collection_info)
        components["vector_store"] = "healthy"
    except Exception as exc:
        logger.warning("Readiness: vector_store unhealthy (%s)", type(exc).__name__)
        components["vector_store"] = "unhealthy"

    try:
        await run_in_threadpool(routes.rag_pipeline.count_tokens, "test")
        components["llm_client"] = "healthy"
    except Exception as exc:
        logger.warning("Readiness: llm_client unhealthy (%s)", type(exc).__name__)
        components["llm_client"] = "unhealthy"

    try:
        async with routes.repositories.async_session() as session:
            await session.execute(routes.repositories.select(1))
        components["database"] = "healthy"
    except Exception as exc:
        logger.warning("Readiness: database unhealthy (%s)", type(exc).__name__)
        components["database"] = "unhealthy"

    try:
        redis_ok = await run_in_threadpool(routes.conversation_service.ping)
        components["redis"] = "healthy" if redis_ok else "degraded (using in-memory fallback)"
    except Exception as exc:
        logger.warning("Readiness: redis check failed (%s)", type(exc).__name__)
        components["redis"] = "degraded (using in-memory fallback)"

    if settings.INTERNAL_API_KEY:
        components["voice_credentials"] = "healthy"
    elif settings.GROQ_API_KEY and settings.SARVAM_API_KEY:
        components["voice_credentials"] = (
            "degraded (INTERNAL_API_KEY not configured; "
            "stored tenant credentials unavailable to the voice worker)"
        )
    else:
        components["voice_credentials"] = "unhealthy"

    return components


@router.get("/health/ready", response_model=HealthResponse)
async def health_ready():
    """Readiness probe – dependency-aware."""
    components = await _readiness_components()

    required_unhealthy = any(
        v.startswith("unhealthy")
        for k, v in components.items()
        if k != "voice_credentials"
    )
    if required_unhealthy:
        status = "unhealthy"
    elif components["voice_credentials"].startswith("unhealthy") or any(
        v.startswith("degraded") for v in components.values()
    ):
        status = "degraded"
    else:
        status = "healthy"

    body = HealthResponse(status=status, components=components)
    if status == "unhealthy":
        return JSONResponse(status_code=503, content=body.model_dump())
    return body


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Legacy health endpoint – preserved for backward compatibility."""
    return await health_ready()
