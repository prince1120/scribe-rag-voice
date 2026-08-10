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
    # Override via GROQ_MODEL in .env. Examples on Groq free tier:
    #   llama-3.1-8b-instant     (30k TPM, fast)
    #   llama-3.3-70b-versatile  (12k TPM)
    #   qwen/qwen3-32b           (~6k TPM, capable)
    #   openai/gpt-oss-20b       (8k TPM)
    GROQ_MODEL: str = "openai/gpt-oss-20b"
    # Vision model used automatically when images are in context.
    GROQ_VISION_MODEL: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    
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
    RERANK_TOP_N: int = 5
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
    SESSION_SECRET: str = "scribe-default-session-secret-key-32bytes-long"
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

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    CORS_METHODS: List[str] = ["GET", "POST", "DELETE", "OPTIONS"]
    CORS_HEADERS: List[str] = ["Content-Type", "Authorization", "X-API-Key"]

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


settings = Settings()

if settings.APP_ACCESS_PASSCODE and not settings.SESSION_SECRET:
    raise RuntimeError(
        "SESSION_SECRET must be set when APP_ACCESS_PASSCODE is set — session "
        "cookies would otherwise be signed with an empty key, making them "
        "trivial to forge. Generate one with: python -c \"import secrets; "
        "print(secrets.token_urlsafe(48))\""
    )
