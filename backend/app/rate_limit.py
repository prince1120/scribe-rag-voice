"""Per-caller rate limiting — mainly to protect the (often free-tier) Groq
API key/quota from being exhausted by a single caller.

Keying on the raw socket address does not work here: the Next.js proxy sits in
front of the API, so every request arrives from one address and the entire
internet shares a single bucket. That is both trivial to self-DoS and no real
per-caller limit. So we key on identity where one exists, and fall back to the
client IP only for unauthenticated endpoints such as login.
"""
import hashlib

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.config import settings
from app.session import COOKIE_NAME, SessionError, verify


def client_ip(request: Request) -> str:
    """Real client IP, honouring X-Forwarded-For only when configured to.

    Trusting the header unconditionally would let any caller mint a fresh
    bucket per request by varying it, removing the limit entirely.
    """
    if settings.TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return get_remote_address(request)


def rate_limit_key(request: Request) -> str:
    """One bucket per caller: the owner's session, a demo visitor's key, or
    (unauthenticated) their IP.

    The bucket must be per *tenant*, not per "is authenticated". This returned
    the literal string "owner" for every valid session, which was correct when
    there was a single passcode holder and became a shared global quota the
    moment workspaces went multi-owner: one busy customer spent the
    20-requests/minute allowance and every other customer got 429s.

    The tenant is inside the signed payload (see session.py), so keying on it
    costs nothing extra — no database round trip, and it cannot be forged
    without the signing key.
    """
    try:
        payload = verify(request.cookies.get(COOKIE_NAME))
        kind = payload.get("kind", "owner")
        if isinstance(kind, str):
            if kind.startswith("owner:"):
                return f"owner:{kind.split(':', 1)[1]}"
            if kind.startswith("contact:"):
                # Per contact, not per owner: a shared invite link that gets
                # passed around must not be able to spend the owner's whole
                # allowance, and one noisy contact must not throttle the rest.
                parts = kind.split(":", 2)
                if len(parts) > 1 and parts[1]:
                    return f"contact:{parts[1]}"
        # The original single-owner passcode session has no tenant to key on.
        return "owner"
    except SessionError:
        pass

    groq_key = request.headers.get("X-User-Groq-Key")
    if groq_key:
        # Hashed so the bucket key — which reaches logs and storage backends —
        # never contains the visitor's API key itself.
        return "demo:" + hashlib.sha256(groq_key.encode("utf-8")).hexdigest()[:16]

    return "ip:" + client_ip(request)


limiter = Limiter(key_func=rate_limit_key, enabled=settings.RATE_LIMIT_ENABLED)
