"""Signed session cookies — the server's own record of who a caller is.

Identity must never come from the request body or query string. Before this
module existed, callers named their own `tenant_id`, so anyone who knew the
public URL could read, download, and delete the owner's documents by asking
for `tenant_id=default`.

Signing is stdlib HMAC-SHA256 rather than a library: the payload is a few
bytes of JSON and the verification rules are short enough to audit by eye,
which matters more here than features.
"""
import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

COOKIE_NAME = "scribe_session"
CONTACT_COOKIE_NAME = "scribe_contact_session"

# The owner's tenant. Kept as the literal "default" that pre-session data was
# written under, so enabling the passcode gate doesn't orphan an existing
# library.
OWNER_TENANT_ID = "default"


class SessionError(Exception):
    """Raised when a cookie is absent, malformed, forged, or expired."""


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _sign(payload: bytes) -> str:
    signature = hmac.new(
        settings.SESSION_SECRET.encode("utf-8"), payload, hashlib.sha256
    ).digest()
    return _b64encode(signature)


def issue(kind: str = "owner") -> str:
    """Mint a signed session token. `iat` is the only expiry input, so a
    token cannot be extended by editing it — the signature covers it."""
    payload = json.dumps(
        {"kind": kind, "iat": int(time.time())}, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    return f"{_b64encode(payload)}.{_sign(payload)}"


def verify(token: Optional[str]) -> dict:
    """Return the session payload, or raise SessionError.

    Every failure path raises the same exception type with a generic message:
    telling a caller *why* their token was rejected distinguishes "forged" from
    "expired", which is free information for an attacker.
    """
    if not token:
        raise SessionError("No session")

    try:
        encoded_payload, signature = token.split(".", 1)
        payload = _b64decode(encoded_payload)
    except (ValueError, TypeError, base64.binascii.Error):
        raise SessionError("Malformed session")

    # compare_digest, not ==, so a forged signature can't be recovered byte by
    # byte from response timing.
    if not hmac.compare_digest(_sign(payload), signature):
        raise SessionError("Invalid session")

    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        raise SessionError("Malformed session")

    issued_at = data.get("iat")
    if not isinstance(issued_at, int):
        raise SessionError("Malformed session")

    if time.time() - issued_at > settings.SESSION_TTL_DAYS * 86400:
        raise SessionError("Expired session")

    return data


def check_passcode(candidate: str) -> bool:
    """Constant-time passcode comparison. Returns False when no passcode is
    configured, so a blank `APP_ACCESS_PASSCODE` can never be satisfied by
    sending a blank passcode — an unset gate is handled by the caller as
    "auth disabled", never as "everyone passes"."""
    if not settings.APP_ACCESS_PASSCODE:
        return False
    return hmac.compare_digest(candidate, settings.APP_ACCESS_PASSCODE)


def cookie_params() -> dict:
    """Cookie flags shared by login and logout so the two can't drift — a
    Set-Cookie that doesn't match the original's flags won't clear it."""
    return {
        "key": COOKIE_NAME,
        "httponly": True,
        "samesite": "lax",
        "secure": not settings.DEBUG,
        "path": "/",
    }


def contact_cookie_params() -> dict:
    """Cookie flags for contact guest session cookies, keeping owner and contact separate."""
    return {
        "key": CONTACT_COOKIE_NAME,
        "httponly": True,
        "samesite": "lax",
        "secure": not settings.DEBUG,
        "path": "/",
    }
