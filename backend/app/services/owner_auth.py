"""Password handling for business owners.

Personal users and callers never sign in — a personal workspace is identified
by the keys you already hold, and a caller by the link they were sent. Only a
business owner needs to come back daily on a device that may not be theirs, so
only they get a password.

`hashlib.scrypt` rather than bcrypt or argon2: it is memory-hard, in the
standard library, and adds no dependency to a project that already does its
signing with stdlib `hmac`. The parameters below are the interactive-login
settings from the scrypt paper — roughly 100ms and 16MB per verification,
which is slow enough to make offline cracking expensive and fast enough that
nobody notices at the login screen.
"""
import hashlib
import hmac
import logging
import re
import secrets

logger = logging.getLogger(__name__)

# n=2^14, r=8, p=1 — the paper's "interactive login" profile.
_SCRYPT_N = 16384
_SCRYPT_R = 8
_SCRYPT_P = 1
_SALT_BYTES = 16
_KEY_BYTES = 32

MIN_PASSWORD_LENGTH = 8

# Deliberately permissive. Anything stricter rejects valid addresses far more
# often than it catches typos, and the only real proof an address works is
# sending to it.
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AuthError(Exception):
    """Raised when credentials are unusable or do not match."""


def normalise_email(email: str) -> str:
    """Lowercased and trimmed, so "Prince@X.com " and "prince@x.com" are the
    same account rather than two."""
    return (email or "").strip().lower()


def validate_email(email: str) -> str:
    normalised = normalise_email(email)
    if not _EMAIL_PATTERN.match(normalised):
        raise AuthError("That does not look like an email address.")
    return normalised


def validate_password(password: str) -> str:
    """Length is the only rule.

    Composition requirements (a digit, a symbol, a capital) reliably push
    people toward "Password1!" — predictable, and weaker than a long
    passphrase. Length is the property that actually resists guessing.
    """
    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise AuthError(
            f"Use at least {MIN_PASSWORD_LENGTH} characters — length matters "
            "more than symbols."
        )
    return password


def hash_password(password: str) -> str:
    """Return "scrypt$<salt_hex>$<hash_hex>".

    The salt is stored beside the hash and is per-password, so two owners who
    pick the same password still get different stored values and one cracked
    hash reveals nothing about the other.
    """
    salt = secrets.token_bytes(_SALT_BYTES)
    derived = hashlib.scrypt(
        password.encode("utf-8"), salt=salt,
        n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=_KEY_BYTES,
    )
    return f"scrypt${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time verification.

    Any malformed stored value returns False rather than raising: a corrupt
    row should fail the login, not 500 the endpoint and reveal that the account
    exists.
    """
    if not stored:
        return False
    try:
        scheme, salt_hex, hash_hex = stored.split("$", 2)
        if scheme != "scrypt":
            return False
        derived = hashlib.scrypt(
            password.encode("utf-8"), salt=bytes.fromhex(salt_hex),
            n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=_KEY_BYTES,
        )
        return hmac.compare_digest(derived.hex(), hash_hex)
    except (ValueError, TypeError):
        logger.warning("Malformed password hash encountered")
        return False
