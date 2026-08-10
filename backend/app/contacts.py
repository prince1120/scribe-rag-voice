"""Invite links: identity for people who never sign up.

A contact receives a URL and nothing else — no account, no password, nothing
to remember. Opening it proves who they are, and every conversation from then
on is attributed to them.

The security reality, stated plainly: **a link is a bearer credential**.
Whoever holds it is that person. Forwarded in a WhatsApp group, it is gone.
That cannot be designed away, so this module limits the blast radius instead:

  - only the token's hash is stored, so a database leak yields no working links
  - the first device to open a link claims it; later devices are refused, which
    is what makes a forwarded link useless to the person who receives it
  - the owner can revoke instantly, and links can carry an expiry
  - an optional PIN travels out of band, so one leaked channel is not enough
  - per-day session caps stop a leaked link draining the LLM quota unnoticed

Device binding plus revocation covers the realistic cases. The PIN exists for
contacts whose documents genuinely matter.
"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

# 32 bytes of urlsafe randomness — ~43 characters. Long enough that guessing is
# not a threat worth modelling, short enough to survive being pasted into chat
# apps that helpfully "tidy" long URLs.
TOKEN_BYTES = 32


class ContactError(Exception):
    """Raised when a token is unknown, revoked, expired, or device-locked."""


def generate_token() -> str:
    """A fresh invite token. Shown to the owner once and never stored."""
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    """SHA-256 of the token.

    Unsalted and unstretched deliberately, unlike a password: this is 256 bits
    of uniform randomness, so there is no dictionary to attack and a slow KDF
    would only add latency to every page load.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def tokens_match(candidate: str, stored_hash: str) -> bool:
    """Constant-time comparison, so response timing cannot be used to recover
    a token character by character."""
    return hmac.compare_digest(hash_token(candidate), stored_hash)


def derive_device_id(user_agent: str, client_ip: str, salt: str) -> str:
    """A stable-ish identifier for the device that opened a link.

    Deliberately coarse: user agent plus address, hashed with the contact's own
    token hash as salt so the value is meaningless outside this contact and
    cannot be correlated across them. It is a tripwire for "this link is now
    being used by someone else", not a tracking identifier — and it is not
    relied on as a security boundary, because both inputs can be spoofed by
    anyone who already holds the link.
    """
    material = f"{user_agent}|{client_ip}|{salt}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()[:32]


def check_usable(
    *,
    revoked_at: Optional[datetime],
    expires_at: Optional[datetime],
    blocked_at: Optional[datetime] = None,
    now: Optional[datetime] = None,
) -> None:
    """Raise if this contact should no longer be admitted.

    Blocking and revoking are different acts with the same outcome here, but
    they differ for the owner: revoking kills the link, blocking refuses the
    person while keeping their link and history intact. The message is
    deliberately the same either way — the person on the other end does not
    need to know which lever was pulled.
    """
    now = now or datetime.now(timezone.utc)

    if blocked_at is not None:
        raise ContactError("Access to this assistant has been turned off.")

    if revoked_at is not None:
        raise ContactError("This link has been revoked by its owner.")

    if expires_at is not None:
        # Rows written before timezone awareness was consistent can come back
        # naive; treat those as UTC rather than raising a comparison error.
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now:
            raise ContactError("This link has expired. Ask for a new one.")


def check_device(
    *, bound_device: Optional[str], presented_device: str
) -> bool:
    """True when this device may proceed.

    An unbound contact admits the first device and binds to it. A bound one
    admits only that device — the point at which a forwarded link stops
    working for whoever received it.
    """
    if bound_device is None:
        return True
    return hmac.compare_digest(bound_device, presented_device)


def default_expiry(days: Optional[int]) -> Optional[datetime]:
    if not days or days <= 0:
        return None
    return datetime.now(timezone.utc) + timedelta(days=days)
