"""Tests for the session cookie and identity resolution.

These cover the boundary that replaced client-supplied `tenant_id`. A
regression here re-opens full read/delete access to the owner's documents for
anyone who knows the public URL, so the forgery and expiry cases matter more
than the happy path.
"""
import json
import time

import pytest
from fastapi import HTTPException

from app import session
from app.config import settings
from app.identity import resolve_identity
from app.rate_limit import rate_limit_key
from app.session import (
    OWNER_TENANT_ID,
    SessionError,
    check_passcode,
    issue,
    verify,
)


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    """A signed, gated deployment — the configuration production runs under."""
    monkeypatch.setattr(settings, "SESSION_SECRET", "test-secret-not-a-real-key")
    monkeypatch.setattr(settings, "APP_ACCESS_PASSCODE", "correct horse battery")
    monkeypatch.setattr(settings, "SESSION_TTL_DAYS", 30)


class TestSessionToken:
    def test_round_trip(self):
        assert verify(issue("owner"))["kind"] == "owner"

    def test_missing_token_rejected(self):
        with pytest.raises(SessionError):
            verify(None)
        with pytest.raises(SessionError):
            verify("")

    def test_garbage_rejected(self):
        for junk in ("nonsense", "a.b", "....", "!!!.!!!"):
            with pytest.raises(SessionError):
                verify(junk)

    def test_forged_signature_rejected(self):
        payload, _ = issue("owner").split(".", 1)
        with pytest.raises(SessionError):
            verify(f"{payload}.deadbeef")

    def test_tampered_payload_rejected(self):
        """The signature covers the payload, so editing it must invalidate the
        token — otherwise a demo visitor could promote themselves to owner."""
        token = issue("owner")
        _, signature = token.split(".", 1)
        forged_payload = session._b64encode(
            json.dumps({"kind": "owner", "iat": int(time.time())}).encode()
        )
        with pytest.raises(SessionError):
            verify(f"{forged_payload}.{signature}")

    def test_expired_token_rejected(self, monkeypatch):
        monkeypatch.setattr(settings, "SESSION_TTL_DAYS", 1)
        old = session._b64encode(
            json.dumps(
                {"kind": "owner", "iat": int(time.time()) - 2 * 86400},
                separators=(",", ":"),
                sort_keys=True,
            ).encode()
        )
        with pytest.raises(SessionError):
            verify(f"{old}.{session._sign(session._b64decode(old))}")

    def test_token_from_a_different_secret_rejected(self, monkeypatch):
        """Rotating SESSION_SECRET must invalidate outstanding sessions."""
        token = issue("owner")
        monkeypatch.setattr(settings, "SESSION_SECRET", "a-different-secret")
        with pytest.raises(SessionError):
            verify(token)


class TestPasscode:
    def test_correct_passcode_accepted(self):
        assert check_passcode("correct horse battery") is True

    def test_wrong_passcode_rejected(self):
        assert check_passcode("wrong") is False
        assert check_passcode("") is False

    def test_unset_passcode_never_satisfied(self, monkeypatch):
        """An unconfigured gate must not be openable by sending a blank
        passcode — "no gate" is handled upstream, never as "everyone in"."""
        monkeypatch.setattr(settings, "APP_ACCESS_PASSCODE", "")
        assert check_passcode("") is False
        assert check_passcode("anything") is False


class TestIdentity:
    def test_valid_cookie_is_owner(self):
        identity = resolve_identity(session_cookie=issue("owner"))
        assert identity.is_owner
        assert identity.tenant_id == OWNER_TENANT_ID

    def test_no_credentials_rejected(self):
        """The regression that matters: an anonymous caller must not land on
        the owner's tenant."""
        with pytest.raises(HTTPException) as exc:
            resolve_identity()
        assert exc.value.status_code == 401

    def test_forged_cookie_rejected(self):
        with pytest.raises(HTTPException) as exc:
            resolve_identity(session_cookie="forged.token")
        assert exc.value.status_code == 401

    def test_groq_key_gets_isolated_demo_tenant(self):
        identity = resolve_identity(groq_key="gsk_visitor_key")
        assert not identity.is_owner
        assert identity.tenant_id != OWNER_TENANT_ID
        assert identity.groq_key == "gsk_visitor_key"

    def test_demo_tenants_are_isolated_from_each_other(self):
        a = resolve_identity(groq_key="key-a", client_id="c1")
        b = resolve_identity(groq_key="key-b", client_id="c1")
        same_key_other_browser = resolve_identity(
            groq_key="key-a", client_id="c2"
        )
        assert a.tenant_id != b.tenant_id
        assert a.tenant_id != same_key_other_browser.tenant_id

    def test_owner_session_wins_over_stale_demo_keys(self):
        """Leftover demo keys in a browser must not redirect the owner to a
        different library than the UI is showing them."""
        identity = resolve_identity(
            session_cookie=issue("owner"), groq_key="gsk_stale"
        )
        assert identity.is_owner
        assert identity.tenant_id == OWNER_TENANT_ID

    def test_gate_disabled_allows_local_development(self, monkeypatch):
        monkeypatch.setattr(settings, "APP_ACCESS_PASSCODE", "")
        identity = resolve_identity()
        assert identity.is_owner


class TestRateLimitKey:
    """Behind the proxy every request shares one socket address, so the key
    must come from identity or the limit protects nobody."""

    def _request(self, cookies=None, headers=None, ip="10.0.0.1"):
        from starlette.datastructures import Headers
        from starlette.requests import Request

        raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
        if cookies:
            jar = "; ".join(f"{k}={v}" for k, v in cookies.items())
            raw.append((b"cookie", jar.encode()))
        return Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/",
                "headers": raw,
                "client": (ip, 1234),
                "scheme": "http",
                "server": ("test", 80),
                "query_string": b"",
            }
        )

    def test_owner_session_gets_its_own_bucket(self):
        req = self._request(cookies={session.COOKIE_NAME: issue("owner")})
        assert rate_limit_key(req) == "owner"

    def test_demo_visitors_get_separate_buckets(self):
        a = rate_limit_key(self._request(headers={"X-User-Groq-Key": "key-a"}))
        b = rate_limit_key(self._request(headers={"X-User-Groq-Key": "key-b"}))
        assert a != b

    def test_demo_bucket_does_not_leak_the_api_key(self):
        key = rate_limit_key(self._request(headers={"X-User-Groq-Key": "gsk_secret"}))
        assert "gsk_secret" not in key

    def test_anonymous_falls_back_to_ip(self):
        assert rate_limit_key(self._request(ip="203.0.113.9")) == "ip:203.0.113.9"

    def test_forwarded_header_ignored_unless_trusted(self, monkeypatch):
        """Honouring X-Forwarded-For unconditionally lets a caller mint a fresh
        bucket per request and bypass the limit entirely."""
        monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", False)
        req = self._request(headers={"X-Forwarded-For": "1.2.3.4"}, ip="10.0.0.1")
        assert rate_limit_key(req) == "ip:10.0.0.1"

        monkeypatch.setattr(settings, "TRUST_PROXY_HEADERS", True)
        assert rate_limit_key(req) == "ip:1.2.3.4"
