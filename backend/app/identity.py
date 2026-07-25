"""Resolves *who is calling* — the single source of tenancy for every route.

Replaces the previous `_effective_tenant` helper, which read `tenant_id`
straight off the request. Because the frontend proxy attaches the backend's
API key to every anonymous request, that made the owner's entire library
readable and deletable by anyone who knew the URL.

A caller now gets exactly one of two identities, and never chooses either:

  owner — proved by a signed session cookie (see session.py)
  demo  — proved by possession of a Groq key, which also pays for the call

Anything else is 401. There is deliberately no fallback tenant.
"""
import logging
from dataclasses import dataclass
from typing import Optional

from fastapi import Cookie, Header, HTTPException, status

from app.config import settings
from app.session import OWNER_TENANT_ID, SessionError, verify
from app.services.tenant_service import derive_tenant_id

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Identity:
    tenant_id: str
    is_owner: bool
    groq_key: Optional[str] = None
    sarvam_key: Optional[str] = None

    @property
    def is_demo(self) -> bool:
        return not self.is_owner


def resolve_identity(
    session_cookie: Optional[str] = None,
    groq_key: Optional[str] = None,
    sarvam_key: Optional[str] = None,
    client_id: Optional[str] = None,
) -> Identity:
    """The actual decision, free of FastAPI types so it can be tested and
    reused directly. `get_identity` below is only the transport adapter."""
    groq_key = (groq_key or "").strip()
    sarvam_key = (sarvam_key or "").strip()
    client_id = (client_id or "").strip()

    # The owner's own session takes precedence over pasted keys, so leftover
    # demo keys in a browser can't silently redirect the owner to a different
    # library than the one they see in the UI.
    try:
        verify(session_cookie)
        return Identity(tenant_id=OWNER_TENANT_ID, is_owner=True)
    except SessionError:
        pass

    if groq_key:
        return Identity(
            tenant_id=derive_tenant_id(groq_key, sarvam_key, client_id),
            is_owner=False,
            groq_key=groq_key,
            sarvam_key=sarvam_key or None,
        )

    # No passcode configured means local development: nobody could have logged
    # in, so requiring a session would make the app unusable. Production is
    # protected by refusing to start without SESSION_SECRET once a passcode is
    # set (see config.py) and by the startup warning in main.py.
    if not settings.APP_ACCESS_PASSCODE:
        return Identity(tenant_id=OWNER_TENANT_ID, is_owner=True)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
    )


async def get_identity(
    scribe_session: Optional[str] = Cookie(default=None),
    x_user_groq_key: Optional[str] = Header(default=None, alias="X-User-Groq-Key"),
    x_user_sarvam_key: Optional[str] = Header(default=None, alias="X-User-Sarvam-Key"),
    x_client_id: Optional[str] = Header(default=None, alias="X-Client-Id"),
) -> Identity:
    """FastAPI dependency — use this in routes."""
    return resolve_identity(
        session_cookie=scribe_session,
        groq_key=x_user_groq_key,
        sarvam_key=x_user_sarvam_key,
        client_id=x_client_id,
    )
