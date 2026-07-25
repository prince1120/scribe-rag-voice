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

    # Rate limiting (requests per window, per client IP)
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_QUERY_PER_MINUTE: int = 20
    RATE_LIMIT_UPLOAD_PER_MINUTE: int = 10

    # Database (documents + conversations metadata)
    DATABASE_URL: str = "sqlite+aiosqlite:///./rag.db"

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    CORS_METHODS: List[str] = ["GET", "POST", "DELETE", "OPTIONS"]
    CORS_HEADERS: List[str] = ["Content-Type", "Authorization", "X-API-Key"]

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


settings = Settings()
