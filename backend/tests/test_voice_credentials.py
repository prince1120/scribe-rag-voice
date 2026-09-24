"""No credentials in LiveKit dispatch metadata; server-side resolution.

Spark owns backend voice credential handling. Regression tests for the P0
defect where owner/provider keys were fanned out inside LiveKit dispatch
metadata on every call.

Covers:
- business token dispatch metadata contains no key names or key values
- Product QR voice dispatch metadata contains no key names or key values
- POST /voice/credentials rejects without the internal key (401)
- POST /voice/credentials fails closed without a configured key (503)
- POST /voice/credentials returns stored keys with the internal key
- worker prefers server-resolved keys, legacy metadata keys still win,
  environment defaults apply when neither exists

Uses test tenants only; no real owner records are touched.
"""
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.api import voice_routes
from app.identity import Identity
from app.main import app
from app.models.schemas import VoiceTokenRequest


SECRET_GROQ = "gsk-stored-secret-voice-1"
SECRET_SARVAM = "srv-stored-secret-voice-1"
SECRET_CUSTOM = "cst-stored-secret-voice-1"

FORBIDDEN_KEYS = (
    "groq_api_key",
    "sarvam_api_key",
    "custom_llm_api_key",
    "mistral",
)
FORBIDDEN_VALUES = (SECRET_GROQ, SECRET_SARVAM, SECRET_CUSTOM)


class _Chain:
    def with_identity(self, *a, **k):
        return self

    def with_name(self, *a, **k):
        return self

    def with_grants(self, *a, **k):
        return self

    def with_room_config(self, *a, **k):
        return self

    def to_jwt(self):
        return "fake-jwt"


class _RoomConfigRecorder:
    """Stands in for RoomConfiguration and records the real dispatch list."""

    last_agents = None

    def __init__(self, *args, **kwargs):
        type(self).last_agents = kwargs.get("agents", [])


async def _async(value):
    return value


def _bomb(message):
    def _raise(*args, **kwargs):
        raise AssertionError(message)

    return _raise


def _agent():
    return SimpleNamespace(
        name="Asha",
        status="deployed",
        voice_id="priya",
        language="unknown",
        greeting="",
        script="fallback script",
        voice_script="You are a helpful voice assistant.",
        voice_model=None,
        voice_temperature=None,
        voice_max_tokens=None,
        voice_base_url=None,
        voice_api_key_enc=None,
        chat_script=None,
        style_rules_enabled=True,
    )


def _stored():
    return {
        "groq_api_key": SECRET_GROQ,
        "sarvam_api_key": SECRET_SARVAM,
        "custom_llm_api_key": SECRET_CUSTOM,
        "custom_llm_base_url": "https://llm.example.com/v1",
        "llm_model": "openai/gpt-oss-20b",
    }


def _patch_token_path(monkeypatch):
    async def healthy():
        return True

    monkeypatch.setattr(voice_routes, "ensure_worker_running", healthy)
    monkeypatch.setattr(
        voice_routes.owner_service, "cached_agent", lambda *a, **k: _async(_agent())
    )
    monkeypatch.setattr(
        voice_routes.owner_service, "cached_owner", lambda *a, **k: _async(None)
    )
    monkeypatch.setattr(
        voice_routes.owner_service, "resolve_credentials", lambda *a, **k: _async(_stored())
    )
    monkeypatch.setattr(
        voice_routes, "AccessToken", lambda *a, **k: _Chain()
    )
    monkeypatch.setattr(voice_routes, "RoomConfiguration", _RoomConfigRecorder)
    monkeypatch.setattr(
        voice_routes.business, "create_call", lambda *a, **k: _async("call-1")
    )
    monkeypatch.setattr(voice_routes.settings, "LIVEKIT_URL", "ws://127.0.0.1:7880")
    monkeypatch.setattr(voice_routes.settings, "LIVEKIT_API_KEY", "test-livekit-key")
    monkeypatch.setattr(voice_routes.settings, "LIVEKIT_API_SECRET", "test-livekit-secret")
    # Issuance tests assume the credential service is configured; the 503
    # path is covered by dedicated tests below.
    monkeypatch.setattr(voice_routes.settings, "INTERNAL_API_KEY", "test-internal-key")


def _owner_request():
    from fastapi import Request

    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/voice/token",
            "headers": [],
            "client": ("127.0.0.1", 50001),
            "app": app,
        }
    )


def _owner_identity():
    return Identity(tenant_id="t-cred", is_owner=True)


@pytest.mark.asyncio
async def test_business_dispatch_metadata_has_no_credentials(monkeypatch):
    _patch_token_path(monkeypatch)
    _RoomConfigRecorder.last_agents = None

    resp = await voice_routes.create_voice_token(
        request=_owner_request(),
        body=VoiceTokenRequest(),
        identity=_owner_identity(),
        x_user_groq_key=None,
        x_user_sarvam_key=None,
        x_user_custom_llm_key=None,
    )
    assert resp.call_id == "call-1"

    agents = _RoomConfigRecorder.last_agents
    assert agents, "dispatch agents must be recorded"
    meta = agents[0].metadata
    assert meta, "dispatch metadata must be recorded"
    for key in FORBIDDEN_KEYS:
        assert key not in meta, f"dispatch metadata leaks {key}"
    for value in FORBIDDEN_VALUES:
        assert value not in meta, "dispatch metadata leaks a key value"


@pytest.mark.asyncio
async def test_product_dispatch_metadata_has_no_credentials():
    from app.api import product_qr_public_routes

    captured = {}

    class _Recorder:
        def __init__(self, *args, **kwargs):
            captured["agents"] = kwargs.get("agents", [])

    sess = SimpleNamespace(
        session_id="sess-1",
        tenant_id="t-pqr",
        product_id="prod-1",
        conversation_id="conv-1",
    )
    product = SimpleNamespace(
        product_id="prod-1",
        name="AquaPure",
        model_number="AP-100",
        support_disclaimer="",
    )
    from unittest.mock import AsyncMock

    with patch(
        "app.api.product_qr_public_routes.repo.list_product_document_ids",
        AsyncMock(return_value=["docA"]),
    ), patch(
        "app.api.product_qr_public_routes.ensure_worker_running",
        AsyncMock(return_value=True),
    ), patch(
        "app.api.product_qr_public_routes.is_worker_available",
        AsyncMock(return_value=True),
    ), patch.object(product_qr_public_routes, "AccessToken", lambda *a, **k: _Chain()), patch.object(
        product_qr_public_routes, "RoomConfiguration", _Recorder
    ), patch.object(
        product_qr_public_routes.settings, "LIVEKIT_URL", "ws://127.0.0.1:7880"
    ), patch.object(
        product_qr_public_routes.settings, "LIVEKIT_API_KEY", "k"
    ), patch.object(
        product_qr_public_routes.settings, "LIVEKIT_API_SECRET", "s"
    ), patch.object(
        product_qr_public_routes.settings, "PRODUCT_QR_ENABLED", True
    ), patch.object(
        product_qr_public_routes.settings, "INTERNAL_API_KEY", "test-internal-key"
    ), patch.object(
        product_qr_public_routes.usage,
        "usage_today",
        AsyncMock(
            return_value=SimpleNamespace(
                calls=0, minutes=0, over_budget=False
            )
        ),
    ):
        # Dependency override must be a plain callable returning the value.
        app.dependency_overrides[
            product_qr_public_routes.get_product_visitor_context
        ] = lambda: (sess, product)
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/product-qr/public/voice/token",
                    json={"consent_accepted": True},
                )
        finally:
            app.dependency_overrides.clear()
    assert resp.status_code == 200, resp.text
    agents = captured.get("agents", [])
    assert agents, "dispatch agents must be recorded"
    meta = agents[0].metadata
    assert meta, "dispatch metadata must be recorded"
    for key in FORBIDDEN_KEYS:
        assert key not in meta, f"product dispatch metadata leaks {key}"


@pytest.mark.asyncio
async def test_credentials_endpoint_rejects_without_internal_key(monkeypatch):
    monkeypatch.setattr(voice_routes.settings, "INTERNAL_API_KEY", "test-internal-key")
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/voice/credentials", json={"tenant_id": "t-cred"}
        )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_credentials_endpoint_fails_closed_without_configured_key(monkeypatch):
    monkeypatch.setattr(voice_routes.settings, "INTERNAL_API_KEY", "")
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post(
            "/api/v1/voice/credentials",
            json={"tenant_id": "t-cred"},
            headers={"X-Internal-Key": "anything"},
        )
    # Fail closed rather than serving stored keys unauthenticated.
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_credentials_endpoint_returns_stored_keys(monkeypatch, caplog):
    monkeypatch.setattr(voice_routes.settings, "INTERNAL_API_KEY", "test-internal-key")
    monkeypatch.setattr(
        voice_routes.owner_service, "cached_agent", lambda *a, **k: _async(_agent())
    )
    monkeypatch.setattr(
        voice_routes.owner_service, "cached_owner", lambda *a, **k: _async(None)
    )
    monkeypatch.setattr(
        voice_routes.owner_service, "resolve_credentials", lambda *a, **k: _async(_stored())
    )
    with caplog.at_level("WARNING"):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/api/v1/voice/credentials",
                json={"tenant_id": "t-cred"},
                headers={"X-Internal-Key": "test-internal-key"},
            )
    assert resp.status_code == 200
    data = resp.json()
    assert data["groq_api_key"] == SECRET_GROQ
    assert data["sarvam_api_key"] == SECRET_SARVAM
    assert data["custom_llm_api_key"] == SECRET_CUSTOM
    # Key values must never reach the logs.
    for value in FORBIDDEN_VALUES:
        assert value not in caplog.text


def test_worker_prefers_server_resolved_keys():
    from app.services.voice import worker

    ctx = SimpleNamespace(
        job=SimpleNamespace(metadata=json.dumps({"tenant_id": "t-cred"}))
    )
    params = worker._params_for_job(
        ctx,
        server_creds={
            "groq_api_key": SECRET_GROQ,
            "sarvam_api_key": SECRET_SARVAM,
            "custom_llm_api_key": "",
        },
    )
    assert params.settings.GROQ_API_KEY == SECRET_GROQ
    assert params.settings.SARVAM_API_KEY == SECRET_SARVAM


def test_worker_legacy_metadata_keys_still_win():
    from app.services.voice import worker

    ctx = SimpleNamespace(
        job=SimpleNamespace(
            metadata=json.dumps(
                {"tenant_id": "t-cred", "groq_api_key": "legacy-key"}
            )
        )
    )
    params = worker._params_for_job(
        ctx, server_creds={"groq_api_key": SECRET_GROQ, "sarvam_api_key": ""}
    )
    assert params.settings.GROQ_API_KEY == "legacy-key"


def test_worker_without_any_keys_keeps_environment_defaults():
    from app.services.voice import worker
    from app.services.voice.config import voice_settings

    ctx = SimpleNamespace(
        job=SimpleNamespace(metadata=json.dumps({"tenant_id": "t-cred"}))
    )
    params = worker._params_for_job(ctx, server_creds={})
    assert params.settings.GROQ_API_KEY == voice_settings.GROQ_API_KEY


@pytest.mark.asyncio
async def test_business_token_503_when_stored_keys_unfetchable(monkeypatch, caplog):
    """Stored-only keys + no INTERNAL_API_KEY + no env defaults: the worker
    could never obtain credentials, so no unusable token may be minted."""
    from fastapi import HTTPException

    async def healthy():
        return True

    monkeypatch.setattr(voice_routes, "ensure_worker_running", healthy)
    monkeypatch.setattr(
        voice_routes.owner_service, "cached_agent", lambda *a, **k: _async(None)
    )
    monkeypatch.setattr(
        voice_routes.owner_service, "cached_owner", lambda *a, **k: _async(None)
    )
    monkeypatch.setattr(
        voice_routes.owner_service, "resolve_credentials", lambda *a, **k: _async(_stored())
    )
    monkeypatch.setattr(voice_routes.settings, "GROQ_API_KEY", "")
    monkeypatch.setattr(voice_routes.settings, "SARVAM_API_KEY", "")
    monkeypatch.setattr(voice_routes.settings, "INTERNAL_API_KEY", "")
    monkeypatch.setattr(
        voice_routes,
        "AccessToken",
        _bomb("token must not be constructed when credentials are unfetchable"),
    )
    with caplog.at_level("WARNING"):
        with pytest.raises(HTTPException) as raised:
            await voice_routes.create_voice_token(
                request=_owner_request(),
                body=VoiceTokenRequest(),
                identity=_owner_identity(),
                x_user_groq_key=None,
                x_user_sarvam_key=None,
                x_user_custom_llm_key=None,
            )
    assert raised.value.status_code == 503
    assert "INTERNAL_API_KEY" in raised.value.detail
    for value in FORBIDDEN_VALUES:
        assert value not in raised.value.detail
    for value in FORBIDDEN_VALUES:
        assert value not in caplog.text


@pytest.mark.asyncio
async def test_business_token_proceeds_when_defaults_cover(monkeypatch):
    """Env defaults need no fetch: the session is servable without INTERNAL."""
    _patch_token_path(monkeypatch)
    stored = _stored()
    stored["custom_llm_base_url"] = ""
    stored["custom_llm_api_key"] = ""
    monkeypatch.setattr(
        voice_routes.owner_service, "resolve_credentials", lambda *a, **k: _async(stored)
    )
    monkeypatch.setattr(voice_routes.settings, "INTERNAL_API_KEY", "")
    monkeypatch.setattr(voice_routes.settings, "GROQ_API_KEY", "env-groq")
    monkeypatch.setattr(voice_routes.settings, "SARVAM_API_KEY", "env-sarvam")
    _RoomConfigRecorder.last_agents = None

    resp = await voice_routes.create_voice_token(
        request=_owner_request(),
        body=VoiceTokenRequest(),
        identity=_owner_identity(),
        x_user_groq_key=None,
        x_user_sarvam_key=None,
        x_user_custom_llm_key=None,
    )
    assert resp.call_id == "call-1"
    assert _RoomConfigRecorder.last_agents, "token must be issued"


@pytest.mark.asyncio
async def test_business_token_proceeds_when_internal_set(monkeypatch):
    """INTERNAL_API_KEY present: stored keys are fetchable, token proceeds."""
    _patch_token_path(monkeypatch)
    monkeypatch.setattr(voice_routes.settings, "INTERNAL_API_KEY", "test-internal")
    monkeypatch.setattr(voice_routes.settings, "GROQ_API_KEY", "")
    monkeypatch.setattr(voice_routes.settings, "SARVAM_API_KEY", "")
    _RoomConfigRecorder.last_agents = None

    resp = await voice_routes.create_voice_token(
        request=_owner_request(),
        body=VoiceTokenRequest(),
        identity=_owner_identity(),
        x_user_groq_key=None,
        x_user_sarvam_key=None,
        x_user_custom_llm_key=None,
    )
    assert resp.call_id == "call-1"
    assert _RoomConfigRecorder.last_agents, "token must be issued"


@pytest.mark.asyncio
async def test_product_token_503_when_credentials_unresolvable(monkeypatch):
    """Product voice with no internal key and no env defaults: 503, no token."""
    from unittest.mock import AsyncMock

    from app.api import product_qr_public_routes

    sess = SimpleNamespace(
        session_id="sess-1",
        tenant_id="t-pqr",
        product_id="prod-1",
        conversation_id="conv-1",
    )
    product = SimpleNamespace(
        product_id="prod-1",
        name="AquaPure",
        model_number="AP-100",
        support_disclaimer="",
    )
    with patch(
        "app.api.product_qr_public_routes.ensure_worker_running",
        AsyncMock(return_value=True),
    ), patch(
        "app.api.product_qr_public_routes.is_worker_available",
        AsyncMock(return_value=True),
    ), patch.object(product_qr_public_routes, "AccessToken", _bomb("no token on 503")), patch.object(
        product_qr_public_routes.settings, "LIVEKIT_URL", "ws://127.0.0.1:7880"
    ), patch.object(
        product_qr_public_routes.settings, "LIVEKIT_API_KEY", "k"
    ), patch.object(
        product_qr_public_routes.settings, "LIVEKIT_API_SECRET", "s"
    ), patch.object(
        product_qr_public_routes.settings, "PRODUCT_QR_ENABLED", True
    ), patch.object(
        product_qr_public_routes.settings, "INTERNAL_API_KEY", ""
    ), patch.object(
        product_qr_public_routes.settings, "GROQ_API_KEY", ""
    ), patch.object(
        product_qr_public_routes.settings, "SARVAM_API_KEY", ""
    ):
        app.dependency_overrides[
            product_qr_public_routes.get_product_visitor_context
        ] = lambda: (sess, product)
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/api/v1/product-qr/public/voice/token",
                    json={"consent_accepted": True},
                )
        finally:
            app.dependency_overrides.clear()
    assert resp.status_code == 503, resp.text
    assert "INTERNAL_API_KEY" in resp.json()["detail"]


def test_provider_key_availability_gate():
    from app.services.voice import worker
    from app.services.voice.config import voice_settings

    base = voice_settings.model_copy(
        update={
            "VOICE_LLM_PROVIDER": "groq",
            "GROQ_API_KEY": "k",
            "SARVAM_API_KEY": "s",
        }
    )
    assert worker._voice_provider_keys_available(base) is True
    assert (
        worker._voice_provider_keys_available(
            base.model_copy(update={"SARVAM_API_KEY": ""})
        )
        is False
    )
    assert (
        worker._voice_provider_keys_available(
            base.model_copy(update={"GROQ_API_KEY": ""})
        )
        is False
    )
    assert (
        worker._voice_provider_keys_available(
            base.model_copy(
                update={
                    "VOICE_LLM_PROVIDER": "custom_openai",
                    "CUSTOM_LLM_BASE_URL": "https://llm.example.com/v1",
                    "CUSTOM_LLM_API_KEY": "c",
                }
            )
        )
        is True
    )
