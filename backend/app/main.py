import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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
from app.api.contact_routes import router as contact_router  # noqa: E402
from app.api.directory_routes import router as directory_router  # noqa: E402
from app.api.owner_routes import router as owner_router  # noqa: E402
from app.api.session_routes import router as session_router  # noqa: E402
from app.api.voice_routes import router as voice_router  # noqa: E402
from app.api.calendar_routes import router as calendar_router  # noqa: E402
from app.database import init_db  # noqa: E402
from app.services.cleanup import run_cleanup_loop  # noqa: E402
from app.services.storage import storage  # noqa: E402
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

    # Sweeps documents whose file is gone or whose TTL has passed, so the three
    # stores (file, Postgres row, Qdrant vectors) can't drift apart. Runs as a
    # background task — a slow first sweep must not delay readiness.
    cleanup_task = asyncio.create_task(run_cleanup_loop())

    try:
        yield
    finally:
        cleanup_task.cancel()
        # Awaited so the task is actually finished before the loop closes,
        # rather than leaving asyncio to complain about a pending task.
        with suppress(asyncio.CancelledError):
            await cleanup_task

        # Storage now holds a pooled HTTP client (see services/storage.py).
        # Closed explicitly so sockets are torn down before the loop stops,
        # rather than surfacing as "unclosed client" warnings on every restart.
        closer = getattr(storage, "aclose", None)
        if closer is not None:
            with suppress(Exception):
                await closer()


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

if not settings.APP_ACCESS_PASSCODE:
    logger.warning(
        "APP_ACCESS_PASSCODE is not set — every visitor is treated as the "
        "owner and can read, download, and DELETE all documents. Note that "
        "API_KEY does not protect against this: the frontend proxy supplies "
        "it on behalf of anonymous callers. Set APP_ACCESS_PASSCODE and "
        "SESSION_SECRET before deploying anywhere public."
    )

if not settings.LIMITS_ENABLED:
    logger.warning(
        "LIMITS_ENABLED is false — every spend and abuse ceiling is OFF. "
        "No daily budget, no call-length or idle limit, no directory velocity "
        "check, and no request rate limiting (including on login). One caller "
        "can drain your LiveKit minutes and an owner's provider quota without "
        "bound. This is for a development machine only — remove the setting "
        "before deploying."
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Last line of defence for anything a route didn't catch.

    The exception text stays in the logs. Returning it to the caller — which
    routes used to do via `HTTPException(500, detail=str(e))` — leaks database
    URLs, file paths, and library internals to anyone who can trigger an error.
    The request id goes back instead, so a user can quote it and it can be
    found in the logs.
    """
    request_id = request_id_ctx.get()
    logger.exception(
        "Unhandled error on %s %s", request.method, request.url.path
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "request_id": request_id,
        },
        headers={"X-Request-ID": request_id},
    )


app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

from app.api.middleware.security_headers import SecurityHeadersMiddleware  # noqa: E402
app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(RequestIdMiddleware)

# CORS middleware.
#
# There is deliberately no `allow_origin_regex` here. It used to be
# r"https?://.*", which matches every origin on the internet — combined with
# allow_credentials=True that made CORS_ORIGINS dead code and let any page the
# owner happened to visit read their workspace, documents, and contacts using
# their session cookie. A tunnel/preview origin belongs in CORS_ORIGINS, which
# is what that list is for.
if settings.CORS_ORIGIN_REGEX:
    logger.warning(
        "CORS_ORIGIN_REGEX is set (%s). Every origin it matches can make "
        "credentialed requests with the owner's session cookie — keep it "
        "unset outside local development.",
        settings.CORS_ORIGIN_REGEX,
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    **({"allow_origin_regex": settings.CORS_ORIGIN_REGEX} if settings.CORS_ORIGIN_REGEX else {}),
    allow_credentials=True,
    allow_methods=settings.CORS_METHODS,
    allow_headers=settings.CORS_HEADERS,
)

# Include API routes
app.include_router(session_router, prefix="/api/v1/session", tags=["session"])
app.include_router(contact_router, prefix="/api/v1/contacts", tags=["contacts"])
app.include_router(directory_router, prefix="/api/v1/directory", tags=["directory"])
app.include_router(owner_router, prefix="/api/v1/workspace", tags=["workspace"])
app.include_router(calendar_router, prefix="/api/v1/calendar", tags=["calendar"])
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
