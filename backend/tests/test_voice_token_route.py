"""The voice token route, exercised for real.

Every other test in this suite passed while this endpoint raised a NameError
on its second line — because nothing called it. A route with no test is a
route whose green suite means nothing, and this is the one route both the
owner's test call and every shared link depend on.

These are deliberately shallow: they call the endpoint and assert it does not
500. That is the entire class of failure that shipped.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app


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
