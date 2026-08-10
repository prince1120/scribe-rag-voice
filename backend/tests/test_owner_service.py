"""Workspace rules.

Tests the service layer directly, with the repository stubbed — the rules are
what matter here, and they should not need a database to verify. If a test in
this file requires SQL, a decision has probably leaked into the wrong layer.
"""
from types import SimpleNamespace

import pytest

from app.services import owner_service


def _record(tenant_id="t-1", mode="personal", name=None, category=None):
    return SimpleNamespace(
        tenant_id=tenant_id, mode=mode,
        business_name=name, business_category=category,
    )


@pytest.fixture
def store(monkeypatch):
    """An in-memory stand-in for the owners repository."""
    rows: dict[str, SimpleNamespace] = {}

    async def get_owner(tenant_id):
        return rows.get(tenant_id)

    async def create_owner(*, tenant_id, mode="personal", business_name=None, business_category=None):
        rows[tenant_id] = _record(tenant_id, mode, business_name, business_category)
        return rows[tenant_id]

    async def update_owner(*, tenant_id, mode=None, business_name=None, business_category=None):
        record = rows.get(tenant_id)
        if record is None:
            return None
        if mode is not None:
            record.mode = mode
        if business_name is not None:
            record.business_name = business_name
        if business_category is not None:
            record.business_category = business_category
        return record

    monkeypatch.setattr(owner_service.repositories, "get_owner", get_owner)
    monkeypatch.setattr(owner_service.repositories, "create_owner", create_owner)
    monkeypatch.setattr(owner_service.repositories, "update_owner", update_owner)
    return rows


class TestWorkspaceCreation:
    async def test_a_workspace_is_created_on_first_sight(self, store):
        """There is no signup — bringing your own keys is the account step."""
        workspace = await owner_service.get_or_create_workspace("t-1")
        assert workspace.tenant_id == "t-1"
        assert "t-1" in store

    async def test_personal_is_the_default(self, store):
        """An existing user who never answers the question keeps the app they
        already had."""
        workspace = await owner_service.get_or_create_workspace("t-1")
        assert workspace.mode == owner_service.PERSONAL
        assert workspace.is_business is False

    async def test_creation_is_idempotent(self, store):
        first = await owner_service.get_or_create_workspace("t-1")
        second = await owner_service.get_or_create_workspace("t-1")
        assert first.tenant_id == second.tenant_id
        assert len(store) == 1


class TestModeChoice:
    async def test_choosing_personal_needs_nothing_else(self, store):
        workspace = await owner_service.choose_mode("t-1", mode="personal")
        assert workspace.mode == "personal"
        assert workspace.needs_setup is False

    async def test_business_requires_a_name(self, store):
        with pytest.raises(owner_service.OwnerError, match="name"):
            await owner_service.choose_mode(
                "t-1", mode="business", business_category="clinic"
            )

    async def test_business_requires_a_known_category(self, store):
        """Free text would make the answers uncountable, which is the only
        reason the question is asked."""
        with pytest.raises(owner_service.OwnerError, match="category"):
            await owner_service.choose_mode(
                "t-1", mode="business", business_name="Acme", business_category="pirates"
            )

    async def test_a_complete_business_is_accepted(self, store):
        workspace = await owner_service.choose_mode(
            "t-1", mode="business", business_name="  Sharma Clinic  ",
            business_category="clinic",
        )
        assert workspace.is_business is True
        assert workspace.business_name == "Sharma Clinic"  # trimmed
        assert workspace.needs_setup is False

    async def test_an_unknown_mode_is_refused(self, store):
        with pytest.raises(owner_service.OwnerError):
            await owner_service.choose_mode("t-1", mode="enterprise")

    async def test_a_business_without_a_name_still_needs_setup(self):
        """Answered the question, didn't finish — the frontend uses this to
        decide whether to show the setup screen."""
        workspace = owner_service._to_workspace(
            _record(mode="business", name=None)
        )
        assert workspace.needs_setup is True


class TestAgentConfig:
    @pytest.fixture
    def agent_store(self, monkeypatch):
        saved = {}

        async def get_agent(tenant_id):
            return saved.get(tenant_id)

        async def upsert_agent(*, tenant_id, name=None, script=None, voice_id=None, language=None, rag_enabled=None, greeting=None):
            record = saved.get(tenant_id) or SimpleNamespace(
                tenant_id=tenant_id, name="Assistant", status="draft", script="",
                voice_id="anushka", language="unknown", rag_enabled=True, greeting=None,
            )
            if name is not None:
                record.name = name
            if script is not None:
                record.script = script
            if voice_id is not None:
                record.voice_id = voice_id
            if language is not None:
                record.language = language
            if rag_enabled is not None:
                record.rag_enabled = rag_enabled
            if greeting is not None:
                record.greeting = greeting
            saved[tenant_id] = record
            return record

        monkeypatch.setattr(owner_service.repositories, "get_agent", get_agent)
        monkeypatch.setattr(owner_service.repositories, "upsert_agent", upsert_agent)
        return saved

    async def test_an_unconfigured_agent_returns_usable_defaults(self, agent_store):
        """The editor and the test panel both need something to work with
        before the first save."""
        config = await owner_service.get_agent_config("t-1")
        assert config["configured"] is False
        assert config["script"].strip()
        assert config["rag_enabled"] is True

    async def test_saving_returns_the_stored_config(self, agent_store):
        config = await owner_service.save_agent_config(
            "t-1", script="Answer politely.", rag_enabled=False
        )
        assert config["script"] == "Answer politely."
        assert config["rag_enabled"] is False
        assert config["configured"] is True

    async def test_an_empty_script_is_refused(self, agent_store):
        """The script is what the agent says; blank is not a configuration."""
        with pytest.raises(owner_service.OwnerError, match="script"):
            await owner_service.save_agent_config("t-1", script="   ")

    async def test_an_unavailable_voice_is_refused(self, agent_store):
        """Caught while the owner is looking at the editor, rather than
        silently breaking a stranger's call days later."""
        with pytest.raises(owner_service.OwnerError, match="voice"):
            await owner_service.save_agent_config(
                "t-1", voice_id="not-a-voice", allowed_voices=frozenset({"anushka"})
            )

    async def test_an_available_voice_is_accepted(self, agent_store):
        config = await owner_service.save_agent_config(
            "t-1", voice_id="anushka", allowed_voices=frozenset({"anushka"})
        )
        assert config["voice_id"] == "anushka"


def test_the_document_cap_stays_small():
    """These documents are an agent's working knowledge, not a library. A high
    cap invites dumping a drive in and getting vague answers."""
    assert owner_service.MAX_BUSINESS_DOCUMENTS == 3


def test_every_category_has_a_label():
    for category in owner_service.BUSINESS_CATEGORIES:
        assert category["id"] and category["label"]
    assert "other" in owner_service.VALID_CATEGORIES
