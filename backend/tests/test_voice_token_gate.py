"""Voice token admission: link, mode, and deployment gates.

Spark owns backend voice token issuance. A non-owner caller without a live
link to a deployed assistant must be rejected with 403 before any worker
check or LiveKit token construction — otherwise the token mints a room
whose assistant never arrives (silent room).

Covers: missing assistant, draft assistant, chat-only contact, missing
contact, unusable (revoked) contact, healthy deployed assistant, and proof
that no LiveKit token is constructed after a rejection.

Uses test identities only; no real owner records are touched.
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request

from app.api import voice_routes
from app.identity import Identity
from app.main import app


def _contact_identity():
    return Identity(tenant_id="t-gate", is_owner=False, contact_id="c-gate")


def _contact(**overrides):
    fields = {
        "contact_id": "c-gate",
        "mode": "both",
        "source": "owner",
        "revoked_at": None,
        "expires_at": None,
        "blocked_at": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _agent(**overrides):
    fields = {"status": "deployed", "voice_id": "priya", "language": "unknown"}
    fields.update(overrides)
    return SimpleNamespace(**fields)


def test_chat_only_contact_is_rejected():
    with pytest.raises(HTTPException) as raised:
        voice_routes._require_voice_caller(
            _contact_identity(), _contact(mode="chat"), _agent()
        )
    assert raised.value.status_code == 403


def test_missing_assistant_is_rejected():
    with pytest.raises(HTTPException) as raised:
        voice_routes._require_voice_caller(
            _contact_identity(), _contact(), None
        )
    assert raised.value.status_code == 403
    assert "deployed" in raised.value.detail


def test_draft_assistant_is_rejected():
    with pytest.raises(HTTPException) as raised:
        voice_routes._require_voice_caller(
            _contact_identity(), _contact(), _agent(status="draft")
        )
    assert raised.value.status_code == 403


def test_missing_contact_is_rejected():
    with pytest.raises(HTTPException) as raised:
        voice_routes._require_voice_caller(
            _contact_identity(), None, _agent()
        )
    assert raised.value.status_code == 403


def test_revoked_contact_is_rejected():
    with pytest.raises(HTTPException) as raised:
        voice_routes._require_voice_caller(
            _contact_identity(),
            _contact(revoked_at="2026-01-01T00:00:00+00:00"),
            _agent(),
        )
    assert raised.value.status_code == 403


def test_healthy_deployed_assistant_passes_the_gate():
    assert (
        voice_routes._require_voice_caller(
            _contact_identity(), _contact(mode="voice"), _agent(status="deployed")
        )
        is None
    )


def _request():
    # Scope carries client + app so the slowapi rate-limit wrapper sees a
    # real request even when calling the endpoint function directly.
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/voice/token",
            "headers": [],
            "client": ("127.0.0.1", 50000),
            "app": app,
        }
    )


@pytest.mark.asyncio
async def test_no_livekit_token_built_after_rejection(monkeypatch):
    """A rejected caller must never reach token construction."""
    from app.models.schemas import VoiceTokenRequest

    async def healthy():
        return True

    monkeypatch.setattr(voice_routes, "ensure_worker_running", healthy)
    monkeypatch.setattr(
        voice_routes.owner_service,
        "cached_agent",
        lambda *a, **k: _async(_agent(status="draft")),
    )
    monkeypatch.setattr(
        voice_routes.owner_service, "cached_owner", lambda *a, **k: _async(None)
    )
    monkeypatch.setattr(
        voice_routes.repositories,
        "get_contact",
        lambda *a, **k: _async(_contact()),
    )
    monkeypatch.setattr(
        voice_routes,
        "AccessToken",
        _bomb("LiveKit token must not be constructed for a rejected caller"),
    )

    with pytest.raises(HTTPException) as raised:
        await voice_routes.create_voice_token(
            request=_request(),
            body=VoiceTokenRequest(),
            identity=_contact_identity(),
            x_user_groq_key=None,
            x_user_sarvam_key=None,
            x_user_custom_llm_key=None,
        )
    assert raised.value.status_code == 403


async def _async(value):
    return value


def _bomb(message):
    def _raise(*args, **kwargs):
        raise AssertionError(message)

    return _raise


def test_token_route_has_rate_limit_registered():
    """POST /voice/token creates billed LiveKit rooms, so it must carry a
    per-caller limit. Asserted via slowapi's registry (no HTTP/lifespan:
    a TestClient here would run app startup and churn the shared asyncpg
    pool for every other test file on Windows).
    """
    from app.rate_limit import limiter

    key = "app.api.voice_routes.create_voice_token"
    limits = limiter._route_limits.get(key, [])
    assert limits, "POST /voice/token must have a slowapi rate limit"
    assert any("minute" in str(lim.limit) for lim in limits)
