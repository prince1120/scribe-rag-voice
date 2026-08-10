"""Encrypting owner API keys at rest.

An owner's Groq and Sarvam keys are money: whoever holds them can spend that
owner's quota. Storing them as plaintext columns means a database dump, a
backup on someone's laptop, or a stray `SELECT *` in a log hands them over.

`cryptography` is not installed and this project has avoided adding
dependencies for crypto so far — signing uses stdlib `hmac`, passwords use
stdlib `scrypt`. So this is AES-free: a keystream derived with HMAC-SHA256 in
counter mode, plus a separate HMAC tag over the ciphertext. That construction
(encrypt-then-MAC with independent keys) is standard and implementable
correctly in a few lines, which matters more here than using a named cipher we
would have to pull in a library for.

**What this does and does not protect against.** It protects stolen data at
rest — dumps, backups, logs. It does *not* protect against an attacker who has
the server, because the key is derived from SESSION_SECRET which lives there
too. Real key management needs a KMS, and that is a deliberate later step, not
something this file pretends to solve.
"""
import base64
import hashlib
import hmac
import logging
import secrets
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)

_NONCE_BYTES = 16
_TAG_BYTES = 32
_PREFIX = "v1"


class SecretError(Exception):
    """Raised when a stored secret cannot be read back."""


def _keys() -> tuple[bytes, bytes]:
    """Separate encryption and authentication keys from one secret.

    Independent keys for the two jobs: reusing one for both is a classic way to
    turn a sound construction into an unsound one.
    """
    if not settings.SESSION_SECRET:
        raise SecretError(
            "SESSION_SECRET must be set before storing API keys — it is what "
            "encrypts them."
        )
    material = settings.SESSION_SECRET.encode("utf-8")
    enc = hashlib.pbkdf2_hmac("sha256", material, b"scribe-secret-enc", 100_000)
    mac = hashlib.pbkdf2_hmac("sha256", material, b"scribe-secret-mac", 100_000)
    return enc, mac


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    """HMAC-SHA256 in counter mode.

    Each block is HMAC(key, nonce || counter), so blocks are independent and
    the stream never repeats for a given nonce — which is why the nonce must be
    fresh per encryption, and is.
    """
    out = bytearray()
    counter = 0
    while len(out) < length:
        out.extend(hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest())
        counter += 1
    return bytes(out[:length])


def encrypt(plaintext: str) -> str:
    """Return "v1$<nonce>$<ciphertext>$<tag>", all base64url.

    Versioned so a future move to a real KMS can re-encrypt on read rather than
    invalidating every stored key.
    """
    if not plaintext:
        return ""

    enc_key, mac_key = _keys()
    nonce = secrets.token_bytes(_NONCE_BYTES)
    data = plaintext.encode("utf-8")
    ciphertext = bytes(a ^ b for a, b in zip(data, _keystream(enc_key, nonce, len(data))))

    # Encrypt-then-MAC, over the nonce as well as the ciphertext: authenticating
    # only the ciphertext would leave the nonce swappable.
    tag = hmac.new(mac_key, nonce + ciphertext, hashlib.sha256).digest()

    def b64(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    return f"{_PREFIX}${b64(nonce)}${b64(ciphertext)}${b64(tag)}"


def decrypt(stored: str) -> str:
    """Recover a secret, or raise if it has been tampered with."""
    if not stored:
        return ""

    try:
        prefix, nonce_b64, cipher_b64, tag_b64 = stored.split("$", 3)
    except ValueError:
        raise SecretError("Stored secret is malformed")

    if prefix != _PREFIX:
        raise SecretError(f"Unknown secret format: {prefix}")

    def unb64(value: str) -> bytes:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

    try:
        nonce, ciphertext, tag = unb64(nonce_b64), unb64(cipher_b64), unb64(tag_b64)
    except Exception:
        raise SecretError("Stored secret is malformed")

    enc_key, mac_key = _keys()

    # Verified before decrypting. Decrypting first and checking after is how
    # padding-oracle-shaped bugs get in.
    expected = hmac.new(mac_key, nonce + ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, tag):
        raise SecretError("Stored secret failed its integrity check")

    plaintext = bytes(
        a ^ b for a, b in zip(ciphertext, _keystream(enc_key, nonce, len(ciphertext)))
    )
    return plaintext.decode("utf-8")


def mask(secret: Optional[str]) -> Optional[str]:
    """What the owner sees: enough to recognise which key is stored, never
    enough to use it. Returned instead of the value on every read."""
    if not secret:
        return None
    if len(secret) <= 8:
        return "••••"
    return f"{secret[:4]}…{secret[-4:]}"
