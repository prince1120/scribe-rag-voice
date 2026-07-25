"""API-key auth dependency.

If settings.API_KEY is unset, auth is disabled (local/dev convenience) but a
loud warning is logged at startup. Set API_KEY in production to require the
`X-API-Key` header on all protected routes.
"""
import logging
from typing import Optional

from fastapi import Header, HTTPException, status

from app.config import settings

logger = logging.getLogger(__name__)


async def verify_api_key(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    if not settings.API_KEY:
        return
    if x_api_key != settings.API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )
