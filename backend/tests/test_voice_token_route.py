"""The voice token route, exercised for real.

Every other test in this suite passed while this endpoint raised a NameError
on its second line — because nothing called it. A route with no test is a
route whose green suite means nothing, and this is the one route both the
owner's test call and every shared link depend on.

These are deliberately shallow: they call the endpoint and assert it does not
500. That is the entire class of failure that shipped.
"""
import pytest
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

from app.api import voice_routes
from app.config import settings
from app.identity import Identity
from app.main import app
from app.models.schemas import VoiceTokenRequest


@pytest.fixture(autouse=True)
def healthy_worker(monkeypatch):
    """Route tests must never launch the real background voice process."""
    async def healthy():
        return True

    monkeypatch.setattr(voice_routes, "ensure_worker_running", healthy)
    monkeypatch.setattr(voice_routes, "is_worker_available", healthy)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


class TestItRuns:
    def test_the_route_executes_without_a_500(self, client):
        """A NameError here reads to the user as "Internal server error", which
        says nothing about the missing key that actually caused it."""
        response = client.post("/api/v1/voice/token", json={})
        assert response.status_code != 500

    def test_a_missing_key_is_explained_not_crashed(self, client, monkeypatch):
        from app.config import settings
        monkeypatch.setattr(settings, "GROQ_API_KEY", "")
        # Deterministic regardless of suite order or shared database state:
        # no stored credential may satisfy the key check from cache or rows
        # written by other tests.
        async def no_stored(*args, **kwargs):
            return {}

        monkeypatch.setattr(
            voice_routes.owner_service, "resolve_credentials", no_stored
        )
        response = client.post("/api/v1/voice/token", json={})
        assert response.status_code == 400
        # The message should say where to fix it, not restate the rule.
        assert "Account" in response.json()["detail"]

    def test_an_unexpected_body_does_not_crash_it(self, client):
        """Callers send partial bodies — the console's test call sends {} so
        the server uses the saved agent rather than whatever the UI holds."""
        for body in ({}, {"rag_enabled": True}, {"conversation_id": "abc"}):
            assert client.post("/api/v1/voice/token", json=body).status_code != 500


class TestSupportingEndpoints:
    """The pickers on the agent screen read from these. A 500 here empties a
    dropdown silently rather than showing an error."""

    def test_voices_are_listed(self, client):
        response = client.get("/api/v1/voice/voices")
        assert response.status_code == 200
        assert response.json()["voices"]

    def test_languages_are_listed(self, client):
        response = client.get("/api/v1/voice/languages")
        assert response.status_code == 200
        languages = response.json()["languages"]
        # Auto-detect must be offered, and be first — it is the safe default
        # for a business that is not sure what its callers speak.
        assert languages[0]["id"] == "unknown"

    def test_health_reports_without_raising(self, client):
        """Answers even when the worker is down — that is what it is for."""
        response = client.get("/api/v1/voice/health")
        assert response.status_code == 200
        assert "available" in response.json()


class TestWorkerAdmission:
    async def test_token_endpoint_returns_503_when_host_worker_is_unhealthy(
        self, monkeypatch
    ):
        """Exercise the real endpoint function through its worker gate.

        No credentials or LiveKit token should be evaluated after a failed
        worker check; the browser must receive an actionable 503 instead of
        joining a room whose assistant never arrives.
        """
        monkeypatch.setattr(settings, "VOICE_WORKER_AUTO_START", True)

        async def unavailable():
            return False

        async def no_record(*args, **kwargs):
            return None

        monkeypatch.setattr(voice_routes, "ensure_worker_running", unavailable)
        monkeypatch.setattr(voice_routes.owner_service, "cached_agent", no_record)
        monkeypatch.setattr(voice_routes.owner_service, "cached_owner", no_record)

        request = Request({"type": "http", "method": "POST", "path": "/api/v1/voice/token", "headers": []})
        with pytest.raises(HTTPException) as raised:
            await voice_routes.create_voice_token(
                request=request,
                body=VoiceTokenRequest(),
                identity=Identity(tenant_id="test-owner", is_owner=True),
                x_user_groq_key=None,
                x_user_sarvam_key=None,
                x_user_custom_llm_key=None,
            )

        assert raised.value.status_code == 503
        assert "temporarily unavailable" in raised.value.detail.lower()


def _direct_request():
    """Scope carries client + app so the slowapi rate-limit wrapper sees a
    real request even when calling the endpoint function directly."""
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


async def _mint_room(body: VoiceTokenRequest):
    return await voice_routes.create_voice_token(
        request=_direct_request(),
        body=body,
        identity=Identity(tenant_id="t-room", is_owner=True),
        x_user_groq_key=None,
        x_user_sarvam_key=None,
        x_user_custom_llm_key=None,
    )


class TestRoomIsolation:
    """The room name is minted server-side, never taken from the request body.

    A client-chosen room_name would let any caller mint a token into another
    call's room (and have an agent dispatched into it). The schema keeps the
    field only so older bodies still validate; the route must ignore it.
    """

    @pytest.fixture
    def minted_rooms(self, monkeypatch):
        """Run the real endpoint with every external dependency stubbed and
        capture the room each token was minted for."""
        rooms: list = []

        class FakeAccessToken:
            def __init__(self, *args, **kwargs):
                pass

            def with_identity(self, value):
                return self

            def with_name(self, value):
                return self

            def with_grants(self, grants):
                rooms.append(grants.room)
                return self

            def with_room_config(self, config):
                return self

            def to_jwt(self):
                return "test-jwt"

        async def no_record(*args, **kwargs):
            return None

        async def stored_keys(*args, **kwargs):
            return {"groq_api_key": "g-test", "sarvam_api_key": "s-test"}

        async def new_call(*args, **kwargs):
            return "call-test"

        async def no_services(*args, **kwargs):
            return []

        from app.services import calendar_service

        monkeypatch.setattr(voice_routes, "AccessToken", FakeAccessToken)
        monkeypatch.setattr(voice_routes.owner_service, "cached_agent", no_record)
        monkeypatch.setattr(voice_routes.owner_service, "cached_owner", no_record)
        monkeypatch.setattr(
            voice_routes.owner_service, "resolve_credentials", stored_keys
        )
        monkeypatch.setattr(voice_routes.business, "create_call", new_call)
        monkeypatch.setattr(calendar_service, "list_services", no_services)
        for attr, value in (
            ("LIVEKIT_URL", "ws://test"),
            ("LIVEKIT_API_KEY", "k-test"),
            ("LIVEKIT_API_SECRET", "s-test"),
            ("INTERNAL_API_KEY", "internal-test"),
        ):
            monkeypatch.setattr(voice_routes.settings, attr, value)
        return rooms

    async def test_a_client_supplied_room_name_is_never_joined(self, minted_rooms):
        response = await _mint_room(VoiceTokenRequest(room_name="victim-room"))
        assert minted_rooms, "the endpoint must mint a LiveKit token"
        assert minted_rooms[0] != "victim-room"
        assert minted_rooms[0].startswith("voice-")
        assert response.room_name == minted_rooms[0]

    async def test_every_session_mints_a_fresh_room(self, minted_rooms):
        first = await _mint_room(VoiceTokenRequest())
        second = await _mint_room(VoiceTokenRequest())
        assert first.room_name != second.room_name
