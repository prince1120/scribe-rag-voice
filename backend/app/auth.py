"""API-key auth dependency.

If settings.API_KEY is unset, auth is disabled (local/dev convenience) but a
loud warning is logged at startup. Set API_KEY in production to require the
`X-API-Key` header on all protected routes.
"""
import hmac
import logging
from typing import Optional

from fastapi import Header, HTTPException, status

from app.config import settings

logger = logging.getLogger(__name__)


async def verify_api_key(x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")):
    if not settings.API_KEY:
        return
    if not hmac.compare_digest(x_api_key or "", settings.API_KEY):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )


async def verify_internal_api_key(
    x_internal_key: Optional[str] = Header(default=None, alias="X-Internal-Key")
):
    """Guards endpoints only the voice worker may call.

    These take a `tenant_id` directly from the request because the worker is
    trusted to state which tenant its dispatched job belongs to. That trust is
    only safe if a browser can never reach them: API_KEY can't provide it,
    since the public frontend proxy attaches API_KEY to every anonymous
    request. Hence a second, proxy-unknown key.
    """
    expected = settings.INTERNAL_API_KEY or settings.API_KEY
    if not expected:
        # Fail closed once the deployment is gated: these routes take a
        # tenant_id from the caller, so an unconfigured key would let anyone
        # read any tenant's document chunks. Only an ungated (local dev)
        # instance may skip the check.
        if settings.APP_ACCESS_PASSCODE:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "INTERNAL_API_KEY is not configured — voice retrieval is "
                    "disabled rather than served unauthenticated."
                ),
            )
        return
    if not hmac.compare_digest(x_internal_key or "", expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing internal key",
        )
