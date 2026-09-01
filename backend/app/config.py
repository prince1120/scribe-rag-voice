import os
from pydantic_settings import BaseSettings
from typing import List

# Without Windows Developer Mode enabled, huggingface_hub's symlink-based
# cache fails with WinError 1314 ("required privilege not held") when
# linking blobs into snapshots — which makes it think the model isn't fully
# cached and re-download it on every restart. Disabling symlinks makes it
# copy files instead, so the cache actually sticks between runs. Must be
# set before sentence-transformers/fastembed are imported anywhere, so this
# lives at the top of config.py (the first app module main.py imports).
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")


class Settings(BaseSettings):
    # Groq Configuration
    GROQ_API_KEY: str
    # Override via GROQ_MODEL in .env. Active Groq models (as of 08/16/26):
    #   openai/gpt-oss-20b  (1k tok/s, fastest, replaces llama-3.1-8b retired)
    #   openai/gpt-oss-120b (500 tok/s, premium, replaces llama-3.3-70b retired)
    #   qwen/qwen3.6-27b    (500 tok/s, balanced, replaces qwen3-32b retired 07/17/26)
    GROQ_MODEL: str = "openai/gpt-oss-20b"
    # Vision model used automatically when images are in context.
    GROQ_VISION_MODEL: str = "qwen/qwen3.6-27b"
    
    # Embedding Model
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"
    
    # Qdrant Configuration
    QDRANT_HOST: str = "localhost"
    QDRANT_PORT: int = 6333
    QDRANT_API_KEY: str = ""
    QDRANT_COLLECTION_NAME: str = "documents"
    
    # Redis Configuration
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: str = ""
    
    # Application
    DEBUG: bool = False
    MAX_FILE_SIZE_MB: int = 50
    CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 50
    RETRIEVAL_TOP_K: int = 10
    MAX_TOP_K: int = 50

    # Demo mode (visitors who paste their own Groq key via X-User-Groq-Key)
    DEMO_MAX_DOCUMENTS: int = 4
    DEMO_TOP_K: int = 3

    # LiveKit (used by the /voice/token endpoint to issue room access tokens;
    # the voice worker process reads its own copy via VoiceSettings so it
    # stays a self-contained, independently deployable unit — see
    # app/services/voice/config.py)
    LIVEKIT_URL: str = ""
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""
    SARVAM_API_KEY: str = ""
    MISTRAL_API_KEY: str = ""
    # Where the API server can reach the voice worker's built-in health HTTP
    # server (livekit-agents starts one automatically — see WorkerOptions.port
    # in worker.py). Used by GET /voice/health so the frontend can tell "voice
    # worker is down" apart from "this specific call failed". Same host as
    # LIVEKIT_URL in local dev; the docker-compose voice-worker service name
    # in production.
    VOICE_WORKER_HEALTH_URL: str = "http://localhost:8081"

    # Allowed upload extensions (must match DocumentProcessor's supported types)
    ALLOWED_UPLOAD_EXTENSIONS: List[str] = [
        ".pdf", ".docx", ".pptx", ".txt", ".md", ".html", ".csv", ".xlsx",
        ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif",
    ]

    # Security
    # Set API_KEY to require the X-API-Key header on all protected routes.
    # Empty = auth disabled (local/dev only) — a warning is logged at startup.
    API_KEY: str = ""

    # Passcode gate. This — not API_KEY — is what protects the owner's
    # documents: API_KEY is supplied by the frontend proxy on behalf of every
    # anonymous visitor, so it authenticates the proxy, not the person.
    # Empty = gate disabled (local/dev only), warned about loudly at startup.
    APP_ACCESS_PASSCODE: str = ""
    # Shared secret for voice-worker -> API calls (/voice/retrieve, /voice/history).
    # Deliberately NOT the same value as API_KEY, and never given to the
    # frontend proxy. Falls back to API_KEY when unset so existing local setups
    # keep working.
    INTERNAL_API_KEY: str = ""
    # HMAC key for session cookies. Required whenever APP_ACCESS_PASSCODE is
    # set; startup fails otherwise rather than signing with a guessable key.
    # Rotating it invalidates every existing session.
    #
    # Empty by default, and it must stay that way: this previously defaulted to
    # a literal string, so the guard below ("fail if unset") could never fire
    # and a gated deployment that forgot to set SESSION_SECRET signed its
    # cookies with a value published in this repository's git history. Anyone
    # who read it could mint an owner session.
    SESSION_SECRET: str = ""
    SESSION_TTL_DAYS: int = 30

    # Honour X-Forwarded-For when resolving the client IP for rate limiting.
    # Only enable behind a proxy that overwrites the header — if anything can
    # reach this service directly, a caller can forge the header and mint a
    # fresh rate-limit bucket per request.
    TRUST_PROXY_HEADERS: bool = False

    # Rate limiting (requests per window, per client IP)
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_QUERY_PER_MINUTE: int = 20
    RATE_LIMIT_UPLOAD_PER_MINUTE: int = 10

    # Database (documents + conversations metadata)
    DATABASE_URL: str = "sqlite+aiosqlite:///./rag.db"

    # File storage. Supabase Storage is used when both URL and service key are
    # present; otherwise files go to UPLOAD_DIR on local disk. On hosts with an
    # ephemeral filesystem (Render/Fly/Railway free tiers) local disk means
    # every uploaded file is lost on redeploy, which breaks download, editing,
    # and image questions.
    SUPABASE_URL: str = ""
    # Service-role key — bypasses row-level security, so it is server-side only
    # and must never be exposed to the browser.
    SUPABASE_SERVICE_KEY: str = ""
    # Must be a PRIVATE bucket. A public one would make every uploaded document
    # readable by URL to anyone who has it.
    SUPABASE_BUCKET: str = "documents"
    UPLOAD_DIR: str = "uploads"

    # Document retention. Uploads are session-scoped: the file itself lives on
    # a disk that a redeploy wipes, but the Postgres row and the Qdrant vectors
    # do not — so without a sweep the UI keeps listing documents whose file is
    # gone, and they fail only when downloaded, edited, or asked about as an
    # image. Worse than disappearing, because it looks like it still works.
    DOCUMENT_TTL_HOURS: int = 24
    # 0 disables the sweep entirely.
    CLEANUP_INTERVAL_MINUTES: int = 60
    # Owner documents are exempt by default: the passcode holder is the person
    # curating a library, not a passing visitor, and silently deleting it would
    # be an unpleasant surprise. Set True for a purely ephemeral deployment.
    CLEANUP_INCLUDES_OWNER: bool = False

    # One switch for local development.
    #
    # Set LIMITS_ENABLED=false and every cost and abuse ceiling below is turned
    # off, so a device under test can call as often as it likes. A single flag
    # rather than seven separate zeroes because the failure being designed
    # against is forgetting to put one of them back — and the one you forget is
    # the one that mattered.
    #
    # Startup warns loudly whenever this is off (see main.py), so an instance
    # running unlimited cannot be mistaken for a healthy one.
    LIMITS_ENABLED: bool = True

    # ---- Cost ceilings -------------------------------------------------
    # LiveKit room minutes are billed to the platform and recovered from owners
    # afterwards, so an unbounded call is an unbounded cost carried by us until
    # it is invoiced — and an abusive one may never be recoverable at all. These
    # are therefore margin protection first and owner protection second, which
    # is why the defaults are deliberately tight rather than generous.
    #
    # Per workspace, per day. 0 disables. Enforced at /voice/token, which is the
    # only point where a call is authorised — a link is cheap, a call is not.
    DAILY_CALL_BUDGET: int = 100
    DAILY_MINUTE_BUDGET: int = 200

    # Applied to callers who arrived through the public directory: strangers,
    # unauthenticated, spending money that is ours before it is anyone's.
    DIRECTORY_MAX_CALL_SECONDS: int = 180
    DIRECTORY_IDLE_TIMEOUT_SECONDS: int = 10
    VOICE_IDLE_TIMEOUT_SECONDS: int = 10
    DIRECTORY_SESSIONS_PER_DAY: int = 3
    DIRECTORY_LINK_TTL_DAYS: int = 1
    # Reaching this many different businesses in DIRECTORY_VELOCITY_WINDOW_MIN
    # is not a customer. 0 disables the check.
    DIRECTORY_VELOCITY_MAX_BUSINESSES: int = 5
    DIRECTORY_VELOCITY_WINDOW_MIN: int = 10

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    # Optional regex for origins that cannot be enumerated ahead of time — a
    # tunnel or preview-deploy domain. Empty in production: whatever this
    # matches gets to make credentialed requests carrying the owner's cookie.
    CORS_ORIGIN_REGEX: str = ""
    CORS_METHODS: List[str] = ["GET", "POST", "DELETE", "OPTIONS"]
    CORS_HEADERS: List[str] = ["Content-Type", "Authorization", "X-API-Key"]

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


settings = Settings()

if not settings.LIMITS_ENABLED:
    # Applied here rather than checked at each enforcement point: every call
    # site already treats 0 as "no ceiling", so zeroing the values means there
    # is exactly one way a limit can be off, and no site that might forget to
    # consult the flag.
    settings.DAILY_CALL_BUDGET = 0
    settings.DAILY_MINUTE_BUDGET = 0
    settings.DIRECTORY_MAX_CALL_SECONDS = 0
    settings.DIRECTORY_IDLE_TIMEOUT_SECONDS = 0
    settings.DIRECTORY_VELOCITY_MAX_BUSINESSES = 0
    # Not zero: this is copied onto each contact row as its per-day cap, and a
    # zero there would read as "no sessions allowed" rather than "no limit".
    settings.DIRECTORY_SESSIONS_PER_DAY = 1000
    settings.DIRECTORY_LINK_TTL_DAYS = 365
    settings.RATE_LIMIT_ENABLED = False

# Session cookies carry the tenant inside the signature, so an unsigned (or
# guessably-signed) cookie is a full workspace takeover. The passcode gate is
# not the only thing that needs this: email/password owner sessions issue the
# same cookie and work with no passcode configured at all, so the requirement is
# "anything but local debug", not "passcode is set".
if not settings.SESSION_SECRET and not settings.DEBUG:
    raise RuntimeError(
        "SESSION_SECRET must be set. Session cookies would otherwise be signed "
        "with an empty key, making them trivial to forge — anyone could mint an "
        "owner session for any workspace. Generate one with: python -c "
        "\"import secrets; print(secrets.token_urlsafe(48))\"  "
        "(set DEBUG=true for local development only.)"
    )
