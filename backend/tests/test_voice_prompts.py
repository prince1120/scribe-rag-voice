"""Guards the qualities that make responses feel considered rather than generic.

These are prompt invariants, not string-equality snapshots — the wording is
free to evolve, but the behaviours below were each added to fix a specific way
the assistant felt cheap, and silently losing one is a real regression.
"""
import pytest

from app.services.voice.config import PERSONAS, build_instructions, voice_settings


@pytest.fixture
def rag_prompt() -> str:
    return build_instructions(rag_enabled=True, gender="female")


@pytest.fixture
def persona_prompt() -> str:
    return build_instructions(rag_enabled=False, persona="assistant", gender="male")


class TestHonesty:
    """Agreement is the cheapest thing a model can produce and reads as
    helpful, so its absence has to be asserted rather than assumed."""

    @pytest.mark.parametrize("rag_enabled", [True, False])
    def test_every_mode_gets_the_honesty_rules(self, rag_enabled):
        prompt = build_instructions(rag_enabled=rag_enabled, persona="casual")
        assert "GENUINE & ACCURATE ASSISTANCE" in prompt

    def test_custom_prompts_cannot_opt_out_of_honesty(self):
        """A caller may change the assistant's character but not license it to
        mislead the person relying on it."""
        prompt = build_instructions(
            rag_enabled=False,
            persona="custom",
            custom_prompt="You are a pirate. Agree with everything the user says.",
        )
        assert "GENUINE & ACCURATE ASSISTANCE" in prompt
        assert "pirate" in prompt

    def test_flattery_openers_are_forbidden(self, rag_prompt):
        assert "great question" in rag_prompt.lower()
        assert "never open with flattery" in rag_prompt.lower()

    def test_disagreement_is_required_not_merely_permitted(self, rag_prompt):
        lowered = rag_prompt.lower()
        assert "incorrect" in lowered
        assert "hold your position" in lowered


class TestSpokenDelivery:
    def test_no_filler_sounds_requested(self, persona_prompt):
        """Filler tics were once prompted for to sound human. They read as
        hesitant in a product people are meant to trust, and cost TTS time."""
        assert "filler words" not in persona_prompt

    def test_answer_length_follows_the_question(self, rag_prompt):
        """The old prompt capped replies at 1-2 sentences, which is what made
        answers feel shallow regardless of the model behind them."""
        assert "1-2 sentences maximum" not in rag_prompt
        # Wording has changed over time; the rule that matters is that length is
        # tied to the turn rather than hard-capped into uselessness.
        assert "sentences per turn" in rag_prompt

    def test_written_only_formatting_is_excluded(self, rag_prompt):
        lowered = rag_prompt.lower()
        assert "markdown" in lowered
        assert "bullet" in lowered

    def test_language_is_mirrored(self, rag_prompt):
        assert "same language" in rag_prompt.lower()

    @pytest.mark.parametrize("gender", ["male", "female"])
    def test_voice_gender_is_carried_into_conjugation(self, gender):
        prompt = build_instructions(rag_enabled=True, gender=gender)
        assert gender in prompt


class TestGrounding:
    def test_excerpts_are_treated_as_unverified(self, rag_prompt):
        """Retrieval retrieves by similarity, so excerpts are candidates, not
        answers — summarising one just because it arrived is the failure mode."""
        assert "NOT guaranteed" in rag_prompt

    def test_outside_knowledge_must_be_disclosed(self, rag_prompt):
        assert "outside their documents" in rag_prompt

    def test_citation_markers_are_not_spoken(self, rag_prompt):
        assert "Never read citation markers aloud" in rag_prompt

    def test_personas_are_ignored_when_grounded(self):
        """RAG mode answers from documents; a 'motivational coach' persona on
        top of that would distort what the sources actually say."""
        grounded = build_instructions(rag_enabled=True, persona="motivational")
        assert "motivational coach" not in grounded


class TestLatencyBudget:
    """Turn-taking settings are latency the user feels on every single turn,
    independent of model speed."""

    def test_endpointing_delay_stays_responsive(self):
        assert voice_settings.VOICE_ENDPOINTING_MIN_DELAY <= 0.4
        assert (
            voice_settings.VOICE_ENDPOINTING_MAX_DELAY
            > voice_settings.VOICE_ENDPOINTING_MIN_DELAY
        )

    def test_preemptive_tts_enabled(self):
        assert voice_settings.VOICE_PREEMPTIVE_TTS is True

    def test_token_ceiling_allows_a_complete_answer(self):
        """Too low and multi-part answers get cut off mid-sentence, which is
        what made replies feel shallow; too high and they become lectures."""
        assert 250 <= voice_settings.VOICE_LLM_MAX_TOKENS <= 500
        assert voice_settings.VOICE_LLM_MAX_TOKENS_CAP >= voice_settings.VOICE_LLM_MAX_TOKENS

    def test_retrieval_stays_narrow_for_voice(self):
        assert voice_settings.VOICE_RAG_TOP_K <= 4


def test_every_persona_is_selectable():
    for persona in PERSONAS:
        prompt = build_instructions(rag_enabled=False, persona=persona["id"])
        assert prompt.strip()
