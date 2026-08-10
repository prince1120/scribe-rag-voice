"""Encryption of owner API keys.

These keys are money — whoever holds one spends that owner's quota — so the
properties below matter more than the convenience of storing them plainly.
"""
import pytest

from app.config import settings
from app.services import secrets_box


@pytest.fixture(autouse=True)
def secret(monkeypatch):
    monkeypatch.setattr(settings, "SESSION_SECRET", "a-long-test-session-secret")


class TestRoundTrip:
    def test_a_secret_survives_a_round_trip(self):
        assert secrets_box.decrypt(secrets_box.encrypt("gsk_live_key")) == "gsk_live_key"

    def test_the_plaintext_is_not_visible_in_storage(self):
        """The whole point: a database dump must not hand over working keys."""
        stored = secrets_box.encrypt("gsk_super_secret_value")
        assert "super_secret" not in stored
        assert "gsk_" not in stored

    def test_the_same_secret_encrypts_differently_each_time(self):
        """A fresh nonce per encryption. Without it, equal keys produce equal
        ciphertext and the store leaks which owners share a key."""
        assert secrets_box.encrypt("same") != secrets_box.encrypt("same")

    def test_empty_stays_empty(self):
        assert secrets_box.encrypt("") == ""
        assert secrets_box.decrypt("") == ""

    def test_unicode_survives(self):
        assert secrets_box.decrypt(secrets_box.encrypt("clé-privée-🔑")) == "clé-privée-🔑"

    def test_long_values_survive(self):
        """Longer than one HMAC block, so the counter-mode keystream has to
        advance correctly."""
        value = "k" * 500
        assert secrets_box.decrypt(secrets_box.encrypt(value)) == value


class TestTampering:
    def test_a_modified_ciphertext_is_rejected(self):
        stored = secrets_box.encrypt("gsk_live_key")
        prefix, nonce, cipher, tag = stored.split("$", 3)
        tampered = f"{prefix}${nonce}${cipher[:-4]}AAAA${tag}"
        with pytest.raises(secrets_box.SecretError):
            secrets_box.decrypt(tampered)

    def test_a_swapped_nonce_is_rejected(self):
        """The tag covers the nonce as well, or the nonce would be swappable."""
        a = secrets_box.encrypt("first")
        b = secrets_box.encrypt("second")
        _, nonce_b, _, _ = b.split("$", 3)
        prefix, _, cipher_a, tag_a = a.split("$", 3)
        with pytest.raises(secrets_box.SecretError):
            secrets_box.decrypt(f"{prefix}${nonce_b}${cipher_a}${tag_a}")

    def test_garbage_is_rejected(self):
        for bad in ("not-a-secret", "v1$only$three", "v2$a$b$c"):
            with pytest.raises(secrets_box.SecretError):
                secrets_box.decrypt(bad)

    def test_a_different_session_secret_cannot_read_it(self, monkeypatch):
        """Rotating SESSION_SECRET invalidates stored keys rather than silently
        returning nonsense that would be sent to a provider."""
        stored = secrets_box.encrypt("gsk_live_key")
        monkeypatch.setattr(settings, "SESSION_SECRET", "a-completely-different-secret")
        with pytest.raises(secrets_box.SecretError):
            secrets_box.decrypt(stored)


class TestMasking:
    def test_a_mask_shows_only_the_ends(self):
        masked = secrets_box.mask("gsk_abcdefghijklmnop")
        assert "abcdefghijkl" not in masked
        assert masked.startswith("gsk_")

    def test_a_short_secret_reveals_nothing(self):
        assert secrets_box.mask("short") == "••••"

    def test_nothing_masks_to_nothing(self):
        assert secrets_box.mask(None) is None
        assert secrets_box.mask("") is None


def test_a_missing_session_secret_is_refused(monkeypatch):
    """Encrypting with an empty key would be storing plaintext with extra
    steps, so it fails loudly instead."""
    monkeypatch.setattr(settings, "SESSION_SECRET", "")
    with pytest.raises(secrets_box.SecretError, match="SESSION_SECRET"):
        secrets_box.encrypt("anything")
