from types import SimpleNamespace

import pytest

from app.api import owner_routes
from app.identity import Identity


class _Response:
    status_code = 200

    def json(self):
        return {"choices": [{"message": {"content": "OK"}}]}


class _Client:
    def __init__(self, captured, *args, **kwargs):
        self.captured = captured

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, url, **kwargs):
        self.captured.update(url=url, **kwargs)
        return _Response()


@pytest.mark.asyncio
async def test_saved_custom_llm_can_be_connection_tested(monkeypatch):
    captured = {}

    async def value(result):
        return result

    monkeypatch.setattr(owner_routes.repositories, "get_agent", lambda *_: value(SimpleNamespace()))
    monkeypatch.setattr(owner_routes.owner_service, "channel_settings", lambda *_: {
        "base_url": "https://llm.example/v1/",
        "model": "example-model",
        "api_key": "agent-secret",
    })
    monkeypatch.setattr(owner_routes.owner_service, "resolve_credentials", lambda *_: value({}))
    monkeypatch.setattr(owner_routes.httpx, "AsyncClient", lambda *a, **k: _Client(captured))

    result = await owner_routes.test_agent_llm(
        owner_routes.AgentLlmTestRequest(channel="voice"),
        Identity(tenant_id="t-1", is_owner=True),
    )

    assert result["ok"] is True
    assert captured["url"] == "https://llm.example/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer agent-secret"
    assert captured["json"]["model"] == "example-model"
