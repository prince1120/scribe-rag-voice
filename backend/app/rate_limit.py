"""Per-client-IP rate limiting — mainly to protect the (often free-tier)
Groq API key/quota from being exhausted by a single caller."""
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings

limiter = Limiter(key_func=get_remote_address, enabled=settings.RATE_LIMIT_ENABLED)
