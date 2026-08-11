"""How long a spoken reply is allowed to be.

The delivery rules ask for one to three sentences, but asking is not enforcing:
the models fast enough for real-time voice are exactly the ones that drift past
a length instruction. So there is a hard ceiling underneath, and which ceiling
applies depends on who owns length for that session — us when our rules are on,
the owner's own prompt when they have turned them off.

Getting this backwards is silent: nothing errors, callers just wait through
forty seconds of speech.
"""
from types import SimpleNamespace

import pytest

from app.services.voice.config import voice_settings
from app.services.voice.worker import _params_for_job


def _job(**metadata):
    """A LiveKit job carrying this dispatch metadata."""
    import json

    return SimpleNamespace(job=SimpleNamespace(metadata=json.dumps(metadata)))


class TestReplyLengthCeiling:
    def test_styled_sessions_get_the_tight_ceiling(self):
        params = _params_for_job(_job(style_rules=True, max_tokens=4000))
        assert (
            params.settings.VOICE_LLM_MAX_TOKENS
            == voice_settings.VOICE_LLM_STYLED_MAX_TOKENS_CAP
        )

    def test_rules_off_gives_the_owner_the_looser_ceiling(self):
        """Clamping an owner who turned our rules off to our number would make
        the toggle a lie — they took length into their own prompt."""
        params = _params_for_job(_job(style_rules=False, max_tokens=4000))
        assert (
            params.settings.VOICE_LLM_MAX_TOKENS
            == voice_settings.VOICE_LLM_MAX_TOKENS_CAP
        )

    def test_absent_style_rules_means_on(self):
        """Older tokens and personal workspaces send no flag. They must get the
        styled behaviour, matching the column default — a missing field should
        not quietly buy a session the loosest setting available."""
        params = _params_for_job(_job(max_tokens=4000))
        assert (
            params.settings.VOICE_LLM_MAX_TOKENS
            == voice_settings.VOICE_LLM_STYLED_MAX_TOKENS_CAP
        )

    def test_a_session_that_asked_for_nothing_is_still_capped(self):
        """The cap used to apply only to sessions that named a number, which is
        the wrong way round: expressing no preference should get the tighter
        behaviour, not the looser one."""
        params = _params_for_job(_job(style_rules=True))
        assert (
            params.settings.VOICE_LLM_MAX_TOKENS
            <= voice_settings.VOICE_LLM_STYLED_MAX_TOKENS_CAP
        )

    def test_a_request_under_the_ceiling_is_left_alone(self):
        """The ceiling is a backstop, not a target — an owner who wants very
        short replies keeps them."""
        params = _params_for_job(_job(style_rules=True, max_tokens=80))
        assert params.settings.VOICE_LLM_MAX_TOKENS == 80

    @pytest.mark.parametrize("styled", [True, False])
    def test_no_session_can_exceed_the_absolute_ceiling(self, styled):
        params = _params_for_job(_job(style_rules=styled, max_tokens=99999))
        assert (
            params.settings.VOICE_LLM_MAX_TOKENS
            <= voice_settings.VOICE_LLM_MAX_TOKENS_CAP
        )


class TestOwnerSelectionReachesTheWorker:
    """Each of these was configured by the owner, sent by the token endpoint,
    and then dropped somewhere downstream."""

    def test_the_owners_model_is_applied(self):
        params = _params_for_job(_job(llm_model="llama-3.3-70b-versatile"))
        assert params.settings.VOICE_LLM_MODEL == "llama-3.3-70b-versatile"

    def test_the_owners_stt_language_is_applied(self):
        """The token endpoint has always sent this; nothing here read it, so an
        owner who picked Hindi got auto-detect anyway."""
        params = _params_for_job(_job(stt_language="hi-IN"))
        assert params.settings.VOICE_STT_LANGUAGE == "hi-IN"

    def test_an_unset_language_leaves_the_default_alone(self):
        params = _params_for_job(_job())
        assert params.settings.VOICE_STT_LANGUAGE == voice_settings.VOICE_STT_LANGUAGE

    def test_malformed_metadata_degrades_rather_than_crashing(self):
        """A bad token payload should produce a plain voice bot, not a failed
        call."""
        params = _params_for_job(SimpleNamespace(job=SimpleNamespace(metadata="{not json")))
        assert params.tenant_id == "default"
        assert params.instructions
