import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.logging_config import configure_logging, request_id_ctx
from app.rate_limit import limiter

configure_logging(debug=settings.DEBUG)
logger = logging.getLogger(__name__)

# Imported after logging is configured so any startup-time log lines from
# these modules (model loading, service init) come out in the same format.
from app.api.routes import router as api_router  # noqa: E402
from app.api.voice_routes import router as voice_router  # noqa: E402
from app.database import init_db  # noqa: E402
from app.services.voice.worker_supervisor import ensure_worker_running  # noqa: E402


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Tags every request with an ID (propagated into all log lines via a
    contextvar) and logs method/path/status/duration for basic observability
    without needing an external APM."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        token = request_id_ctx.set(request_id)
        start = time.perf_counter()
        try:
            response = await call_next(request)
            duration_ms = int((time.perf_counter() - start) * 1000)
            response.headers["X-Request-ID"] = request_id
            logger.info(
                "%s %s -> %s (%dms)",
                request.method, request.url.path, response.status_code, duration_ms,
            )
            return response
        finally:
            request_id_ctx.reset(token)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()

    # Start the voice worker alongside the API server rather than waiting for
    # the first "Start conversation" click — the two now share one lifetime
    # (run the backend, the worker comes up with it). Fired as a background
    # task, not awaited, so a slow/failed worker launch never delays the API
    # server becoming ready. ensure_worker_running() health-checks first, so
    # this is a no-op on uvicorn --reload restarts if a worker from a
    # previous run is already up (it's spawned detached — see
    # worker_supervisor.py — specifically so reloads don't kill it).
    if settings.LIVEKIT_URL and settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_SECRET:
        asyncio.create_task(ensure_worker_running())
    else:
        logger.info("LiveKit isn't configured — skipping voice worker auto-start.")

    yield


app = FastAPI(
    title="Production RAG API",
    description="Chat with your documents - A NotebookLM-like RAG system",
    version="1.0.0",
    debug=settings.DEBUG,
    lifespan=lifespan,
)

if not settings.API_KEY:
    logger.warning(
        "API_KEY is not set — all API endpoints are UNAUTHENTICATED. "
        "Set API_KEY in .env before exposing this service outside localhost."
    )

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(RequestIdMiddleware)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=settings.CORS_METHODS,
    allow_headers=settings.CORS_HEADERS,
)

# Include API routes
app.include_router(api_router, prefix="/api/v1")
app.include_router(voice_router, prefix="/api/v1/voice", tags=["voice"])

# NOTE: uploaded files are intentionally NOT mounted as static files here —
# that would bypass auth. Use the authenticated
# GET /api/v1/documents/{document_id}/file endpoint instead.


@app.get("/")
async def root():
    return {
        "message": "Production RAG API is running",
        "version": "1.0.0",
        "endpoints": {
            "docs": "/docs",
            "health": "/api/v1/health",
            "upload": "/api/v1/documents/upload",
            "query": "/api/v1/query",
            "query_stream": "/api/v1/query/stream"
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG
    )
