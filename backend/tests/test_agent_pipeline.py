"""Agent connection, publishing, switching and call credential regressions."""
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.models.db_models import Base, AgentSnapshotRecord
from app.repositories import owners, business
from app.services import owner_service, secrets_box, cache
from app.services.agent_configuration import published_agent, serialize


@pytest.fixture
async def isolated(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    for module in ("app.database", "app.repositories", "app.repositories.owners", "app.repositories.business"):
        monkeypatch.setattr(f"{module}.async_session", sessions)
    monkeypatch.setattr(secrets_box.settings, "SESSION_SECRET", "isolated-agent-pipeline-secret")
    monkeypatch.setattr(secrets_box.settings, "GROQ_API_KEY", "")
    monkeypatch.setattr(secrets_box.settings, "SARVAM_API_KEY", "")
    cache.config_cache.clear()
    yield sessions
    cache.config_cache.clear()
    await engine.dispose()


def agent(**fields):
    return SimpleNamespace(script="Be helpful.", **fields)


def test_sarvam_default_uses_the_settings_key_for_llm_and_speech():
    for channel in ("voice", "chat"):
        runtime = owner_service.resolve_channel_runtime(agent(), channel, {"sarvam_api_key": "sarvam-secret"})
        assert runtime["provider"] == "sarvam"
        assert runtime["api_key"] == runtime["sarvam_api_key"] == "sarvam-secret"


def test_custom_agent_key_wins_and_both_channels_use_one_model():
    configured = agent(llm_model="custom-model", llm_base_url="https://custom.example/v1", llm_api_key_enc=secrets_box.encrypt("agent-key"))
    for channel in ("voice", "chat"):
        runtime = owner_service.resolve_channel_runtime(configured, channel, {"groq_api_key": "wrong-key", "custom_llm_base_url": "https://other.example/v1", "custom_llm_api_key": "other-key"})
        assert runtime["model"] == "custom-model"
        assert runtime["api_key"] == "agent-key"


def test_custom_endpoint_cannot_borrow_a_different_providers_key():
    runtime = owner_service.resolve_channel_runtime(agent(llm_model="model", llm_base_url="https://new.example/v1", llm_api_key_enc=None), "voice", {"custom_llm_base_url": "https://old.example/v1", "custom_llm_api_key": "old-secret"})
    assert runtime["api_key"] is None


async def test_draft_edits_do_not_change_published_agent(isolated):
    await owner_service.save_agent_config("publish", script="First prompt", llm_model="first-model", llm_base_url="https://first.example/v1", llm_api_key="first-key")
    await owners.set_agent_status("publish", "deployed")
    await owner_service.save_agent_config("publish", script="Draft prompt", llm_model="draft-model")
    draft = await owners.get_agent("publish")
    assert draft.script == "Draft prompt"
    assert published_agent(draft).script == "First prompt"
    assert published_agent(draft).llm_model == "first-model"
    assert owner_service._has_draft_changes(draft)
    await owners.set_agent_status("publish", "deployed")
    assert published_agent(await owners.get_agent("publish")).script == "Draft prompt"


async def test_endpoint_change_clears_previous_key(isolated):
    await owner_service.save_agent_config("change", llm_model="model", llm_base_url="https://old.example/v1", llm_api_key="old-secret")
    await owner_service.save_agent_config("change", llm_base_url="https://new.example/v1")
    assert not (await owners.get_agent("change")).llm_api_key_enc


async def test_call_credentials_are_frozen_tenant_scoped_and_removed_on_completion(isolated):
    credentials = {"custom_llm_api_key": "startup-key", "sarvam_api_key": "speech-key"}
    call_id = await business.create_call("owner", None, credentials=credentials)
    assert await business.call_credentials(call_id, "owner") == credentials
    with pytest.raises(LookupError):
        await business.call_credentials(call_id, "other-owner")
    call = await business.get_call(call_id, "owner")
    assert "startup-key" not in call.credentials_enc
    await business.save_call(call_id, "owner", None, [], 0, completed=True)
    with pytest.raises(LookupError):
        await business.call_credentials(call_id, "owner")


async def test_switching_agents_restores_model_and_key_and_returns_to_draft(isolated):
    await owner_service.save_agent_config("switch", script="First", llm_model="first", llm_base_url="https://first.example/v1", llm_api_key="first-key")
    first = await owners.get_agent("switch")
    async with isolated() as session:
        session.add(AgentSnapshotRecord(snapshot_id="first", tenant_id="switch", name="First", script="First", config_json=serialize(first)))
        await session.commit()
    await owner_service.save_agent_config("switch", script="Second", llm_model="second", llm_base_url="https://second.example/v1", llm_api_key="second-key")
    await owners.set_agent_status("switch", "deployed")
    await owners.activate_agent_snapshot("switch", "first")
    restored = await owners.get_agent("switch")
    assert restored.llm_model == "first"
    assert secrets_box.decrypt(restored.llm_api_key_enc) == "first-key"
    assert restored.status == "draft" and restored.published_config is None
    with pytest.raises(LookupError):
        await owners.activate_agent_snapshot("other-owner", "first")


async def test_new_agent_defaults_to_shared_sarvam_and_response_keeps_status(isolated):
    result = await owner_service.save_agent_config("new", script="Hello")
    assert result["llm_model"] == owner_service.SARVAM_VOICE_MODEL
    assert result["llm_base_url"] == owner_service.SARVAM_LLM_URL
    assert result["status"] == "draft"


async def test_call_setup_avoids_a_second_database_read(isolated, monkeypatch):
    from unittest.mock import AsyncMock

    call_id = await business.create_call("fast", None, credentials={"sarvam_api_key": "speech"})
    database_read = AsyncMock(side_effect=AssertionError("startup should use its encrypted cached snapshot"))
    monkeypatch.setattr(business, "get_call", database_read)
    assert await business.call_credentials(call_id, "fast") == {"sarvam_api_key": "speech"}
    database_read.assert_not_called()


async def test_existing_custom_key_migrates_without_reentry(isolated):
    await owner_service.save_agent_config("legacy", script="Hello", voice_model="legacy-model", voice_base_url="https://legacy.example/v1", voice_api_key="saved-secret")
    await owner_service.save_agent_config("legacy", llm_model="legacy-model", llm_base_url="https://legacy.example/v1")
    shared = await owners.get_agent("legacy")
    assert secrets_box.decrypt(shared.llm_api_key_enc) == "saved-secret"
    assert not shared.voice_api_key_enc and not shared.chat_api_key_enc
    for channel in ("voice", "chat"):
        assert owner_service.resolve_channel_runtime(shared, channel, {})["api_key"] == "saved-secret"


@pytest.mark.parametrize("url", ["https://", "https://user:secret@example.com/v1", "https://example.com/v1?key=secret", "https://example.com:invalid/v1"])
async def test_invalid_or_secret_bearing_urls_are_rejected_before_save(isolated, url):
    with pytest.raises(owner_service.OwnerError):
        await owner_service.save_agent_config("invalid", llm_base_url=url)
    assert await owners.get_agent("invalid") is None


async def test_voice_token_uses_saved_agent_key_and_ignores_browser_provider_overrides(isolated, monkeypatch):
    import json
    from unittest.mock import AsyncMock
    from fastapi import Request
    from app.api import voice_routes
    from app.identity import Identity
    from app.models.schemas import VoiceTokenRequest
    from app.main import app

    await owners.create_owner(tenant_id="voice-owner")
    await owner_service.save_provider_settings("voice-owner", sarvam_key="settings-speech")
    await owner_service.save_agent_config("voice-owner", script="Speak briefly", llm_model="saved-model", llm_base_url="https://saved.example/v1", llm_api_key="agent-secret")
    for field, value in {"LIVEKIT_URL": "ws://127.0.0.1:7880", "LIVEKIT_API_KEY": "livekit-test", "LIVEKIT_API_SECRET": "livekit-secret", "INTERNAL_API_KEY": "internal-test"}.items():
        monkeypatch.setattr(voice_routes.settings, field, value)
    monkeypatch.setattr(voice_routes, "ensure_worker_running", AsyncMock(return_value=True))
    monkeypatch.setattr("app.services.calendar_service.list_services", AsyncMock(return_value=[]))
    captured = {}

    class Token:
        def __getattr__(self, name):
            return lambda *args, **kwargs: self

        def with_room_config(self, config):
            captured["metadata"] = config.agents[0].metadata
            return self

        def to_jwt(self):
            return "test-token"

    monkeypatch.setattr(voice_routes, "AccessToken", lambda *args, **kwargs: Token())
    request = Request({"type": "http", "method": "POST", "path": "/api/v1/voice/token", "headers": [], "client": ("127.0.0.1", 5000), "app": app})
    response = await voice_routes.create_voice_token(request, VoiceTokenRequest(llm_model="wrong-model", custom_llm_base_url="https://wrong.example/v1"), Identity(tenant_id="voice-owner", is_owner=True), "wrong-groq", "wrong-speech", "wrong-custom")
    metadata = json.loads(captured["metadata"])
    assert metadata["llm_model"] == "saved-model"
    assert metadata["custom_llm_base_url"] == "https://saved.example/v1"
    assert "agent-secret" not in captured["metadata"] and "settings-speech" not in captured["metadata"]
    credentials = await business.call_credentials(response.call_id, "voice-owner")
    assert credentials["custom_llm_api_key"] == "agent-secret"
    assert credentials["sarvam_api_key"] == "settings-speech"
