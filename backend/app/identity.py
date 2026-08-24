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
import time
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
    # Set when the caller arrived through an invite link. They read the
    # owner's library, so tenant_id is the owner's — this is who is asking,
    # for attribution and for the limits that apply to them.
    contact_id: Optional[str] = None

    @property
    def is_demo(self) -> bool:
        return not self.is_owner and self.contact_id is None

    @property
    def is_contact(self) -> bool:
        return self.contact_id is not None

    @property
    def can_manage_documents(self) -> bool:
        """Contacts ask questions; they do not curate the library. Without
        this, an invite link would carry the right to delete every document
        it can read. Demo users (personal app) manage their own isolated
        tenant, so they are allowed — only contacts are blocked."""
        return self.contact_id is None


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
        payload = verify(session_cookie)
        kind = payload.get("kind", "owner")

        # A contact cookie is signed by the same key as the owner's, so the
        # signature alone proves nothing about privilege — the kind has to be
        # read. Skipping this check would let any invite link act as owner.
        if isinstance(kind, str) and kind.startswith("contact:"):
            # "contact:<contact_id>:<owner_tenant_id>". The owner's tenant is
            # carried in the signed payload rather than looked up, so resolving
            # identity stays synchronous and free of a database round trip on
            # every request. It is inside the signature, so a contact cannot
            # edit it to reach another owner's documents.
            parts = kind.split(":", 2)
            contact_id = parts[1] if len(parts) > 1 else ""
            owner_tenant = parts[2] if len(parts) > 2 else OWNER_TENANT_ID
            if contact_id:
                return Identity(
                    tenant_id=owner_tenant,
                    is_owner=False,
                    contact_id=contact_id,
                )
        elif isinstance(kind, str) and kind.startswith("owner:"):
            # "owner:<tenant_id>" — a business owner who signed in with email
            # and password. The tenant is inside the signature, so it cannot be
            # edited to reach another workspace.
            owner_tenant = kind.split(":", 1)[1]
            if owner_tenant:
                return Identity(tenant_id=owner_tenant, is_owner=True)
        elif kind == "owner":
            # The original single-owner passcode session.
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


# Cache the resolved owner tenant id so we don't query the DB on every request.
#
# TTL'd rather than permanent. This previously never expired, so the *first*
# request a process ever served decided which workspace the console showed for
# the rest of that process's life — including the case where it resolved before
# the owner had registered, pinning the console to OWNER_TENANT_ID and making a
# freshly created business look like it had no data until a restart.
_cached_real_owner_tenant: Optional[str] = None
_cached_real_owner_expires: float = 0.0
_REAL_OWNER_TTL_S = 300.0


async def _resolve_real_owner_tenant() -> str:
    """In dev mode (no passcode), find the actual registered business owner
    so dashboard queries match the data created by directory callers.

    Picks the first owner with a real (non-test) email. Falls back to
    OWNER_TENANT_ID if no such owner exists — but does not cache that fallback
    for long, since "no owner registered yet" is a state that changes.
    """
    global _cached_real_owner_tenant, _cached_real_owner_expires

    now = time.monotonic()
    if _cached_real_owner_tenant is not None and now < _cached_real_owner_expires:
        return _cached_real_owner_tenant

    def _remember(tenant: str) -> str:
        global _cached_real_owner_tenant, _cached_real_owner_expires
        _cached_real_owner_tenant = tenant
        _cached_real_owner_expires = time.monotonic() + _REAL_OWNER_TTL_S
        return tenant

    try:
        from app.repositories.owners import get_all_owners
        owners = await get_all_owners()

        # Prefer the owner with a real email (not test_*)
        for owner in owners:
            if (
                owner.email
                and not owner.email.startswith("test_")
                and owner.tenant_id != OWNER_TENANT_ID
            ):
                logger.info("Dev mode: using real owner tenant %s (%s)",
                            owner.tenant_id, owner.email)
                return _remember(owner.tenant_id)

        # Fallback: any owner with a non-default tenant_id
        for owner in owners:
            if owner.tenant_id != OWNER_TENANT_ID and not owner.tenant_id.startswith("test_"):
                logger.info("Dev mode: using owner tenant %s", owner.tenant_id)
                return _remember(owner.tenant_id)
    except Exception:
        logger.warning("Could not resolve a real owner tenant", exc_info=True)

    return _remember(OWNER_TENANT_ID)


async def get_identity(
    scribe_session: Optional[str] = Cookie(default=None),
    x_user_groq_key: Optional[str] = Header(default=None, alias="X-User-Groq-Key"),
    x_user_sarvam_key: Optional[str] = Header(default=None, alias="X-User-Sarvam-Key"),
    x_client_id: Optional[str] = Header(default=None, alias="X-Client-Id"),
) -> Identity:
    """FastAPI dependency — use this in routes."""
    identity = resolve_identity(
        session_cookie=scribe_session,
        groq_key=x_user_groq_key,
        sarvam_key=x_user_sarvam_key,
        client_id=x_client_id,
    )

    # Local-development convenience: resolve the placeholder "default" tenant to
    # whichever real business owner exists, so seeded data shows up in the
    # console instead of an empty workspace.
    #
    # Gated on the passcode being unset, which is the line between "this
    # instance is open to anyone" and "this instance is gated". Ungated, this is
    # a privilege escalation and not a convenience: with a passcode configured,
    # a legacy single-owner session resolves to OWNER_TENANT_ID, and without
    # this check that session would be silently upgraded into a *different*,
    # real business's workspace — full rights over their documents, contacts,
    # and provider keys.
    #
    # Deliberately not gated on DEBUG as well. Without a passcode the app
    # already hands every anonymous caller owner rights (see resolve_identity,
    # and the startup warning in main.py), so this remap adds no exposure that
    # configuration does not already have — while requiring DEBUG would change
    # which workspace a local console shows and read as "all my data vanished".
    if (
        not settings.APP_ACCESS_PASSCODE
        and identity.is_owner
        and identity.tenant_id == OWNER_TENANT_ID
    ):
        real_tenant = await _resolve_real_owner_tenant()
        if real_tenant != OWNER_TENANT_ID:
            return Identity(tenant_id=real_tenant, is_owner=True)

    return identity

