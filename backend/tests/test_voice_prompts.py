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

    def test_a_length_rule_is_stated(self, rag_prompt):
        """Without one, a chat-trained model answers a phone call in
        paragraphs. Wording has changed several times; what must survive is
        that some explicit sentence budget is present."""
        # Case-insensitive: the rule reads better capitalised at the start of a
        # bullet, and this test exists to prove a sentence budget is stated —
        # not to pin one capitalisation of it.
        assert "one to three short sentences" in rag_prompt.lower()

    def test_the_length_rule_has_an_escape(self, rag_prompt):
        """A bare cap is what made replies feel shallow — the model would stop
        mid-explanation rather than hand the rest back. Capping is only
        acceptable alongside a way to continue."""
        assert "offer the rest" in rag_prompt

    def test_padding_is_forbidden_not_merely_discouraged(self, rag_prompt):
        """Restating the question and summarising the answer are the two habits
        that make a spoken reply feel like an AI reading an essay."""
        lowered = rag_prompt.lower()
        assert "don't restate the question" in lowered
        assert "corporate" not in lowered  # banned by example, not by label
        assert "i'd be happy to help" in lowered

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

    def test_endpointing_is_bounded_at_both_ends(self):
        """This used to assert only an upper bound, which is half the problem
        and the less costly half. Too slow feels laggy; too fast splits one
        sentence into two turns and has the agent answer the first fragment,
        which makes the caller repeat themselves. A floor matters as much as a
        ceiling."""
        assert 0.4 <= voice_settings.VOICE_ENDPOINTING_MIN_DELAY <= 0.7
        assert (
            voice_settings.VOICE_ENDPOINTING_MAX_DELAY
            > voice_settings.VOICE_ENDPOINTING_MIN_DELAY
        )

    def test_an_ambiguous_ending_gets_real_time_to_finish(self):
        """max_delay is the force-stop for an ending the framework isn't sure
        about — common mid-sentence, when switching language, or when reciting
        a number in groups. At 0.9s it fired constantly."""
        assert voice_settings.VOICE_ENDPOINTING_MAX_DELAY >= 1.5

    def test_the_vad_window_does_not_undercut_endpointing(self):
        """No endpointing decision can happen before Silero reports silence, so
        a VAD window above min_delay would make min_delay a number that never
        applies."""
        assert (
            voice_settings.VOICE_VAD_MIN_SILENCE
            <= voice_settings.VOICE_ENDPOINTING_MIN_DELAY
        )

    def test_preemptive_llm_stays_on(self):
        """Running the LLM before the turn is confirmed is most of the latency
        win and is safe — nothing is spoken until confirmation. This is the
        part that must not be traded away while chasing correctness."""
        from app.services.voice.session_factory import build_agent_session  # noqa: F401
        import inspect

        from app.services.voice import session_factory

        src = inspect.getsource(session_factory.build_agent_session)
        assert '"preemptive_generation"' in src
        assert '"enabled": True' in src

    def test_preemptive_tts_stays_off_by_default(self):
        """Synthesising before the turn is confirmed lets a superseded
        generation reach the speaker — heard as the agent giving two different
        answers to one question. The env var still exists for anyone who wants
        the last ~200ms more than they want a single answer."""
        assert voice_settings.VOICE_PREEMPTIVE_TTS is False

    def test_interruption_mode_needs_no_hosted_service(self):
        """"adaptive" is backed by a hosted LiveKit inference service. With no
        credentials configured there is no detector, and interruptions stop
        firing entirely — the agent talks over you until its TTS drains. That
        failure is invisible in logs and in tests that only check settings
        exist, which is why it is asserted by name here."""
        assert voice_settings.VOICE_INTERRUPTION_MODE == "vad"

    def test_barge_in_does_not_wait_on_a_transcript(self):
        """Cutting the agent off must depend on hearing audio, not on words
        coming back from STT — waiting for a transcript is what makes barge-in
        feel dead."""
        assert voice_settings.VOICE_INTERRUPTION_MIN_WORDS == 0

    def test_barge_in_is_near_immediate(self):
        """Talking over the agent has to stop it, not queue behind the rest of
        its sentence. Duration is the only guard, since barge-in deliberately
        does not wait on a transcript (see above), so it has to stay small
        enough to feel instant and large enough to outlast a click or a
        breath."""
        assert 0.2 <= voice_settings.VOICE_INTERRUPTION_MIN_DURATION <= 0.4

    def test_a_false_cut_can_recover(self):
        """The aggressive threshold above is only affordable because a false
        interruption resumes. Without this the agent goes silent mid-sentence
        with no user turn to answer, and the call sits there dead."""
        assert voice_settings.VOICE_RESUME_FALSE_INTERRUPTION is True

    def test_token_ceiling_allows_a_complete_answer(self):
        """Too low and multi-part answers get cut off mid-sentence, which is
        what made replies feel shallow; too high and they become lectures."""
        assert 250 <= voice_settings.VOICE_LLM_MAX_TOKENS <= 500
        assert voice_settings.VOICE_LLM_MAX_TOKENS_CAP >= voice_settings.VOICE_LLM_MAX_TOKENS

    def test_retrieval_stays_narrow_for_voice(self):
        assert voice_settings.VOICE_RAG_TOP_K <= 4


class TestBothModesShareOneRuleSet:
    """Personal and business voice used to carry separate, divergent copies of
    the speaking rules — business had none at all, and personal had a fifty-line
    version with worked dialogue examples. Two copies of "how long should a
    spoken reply be" drift, and the one that drifts is whichever nobody is
    testing that week."""

    def test_personal_mode_uses_the_shared_rules(self, rag_prompt):
        from app.services import prompt_rules

        assert prompt_rules.VOICE_DELIVERY in rag_prompt

    def test_business_mode_uses_the_same_rules(self):
        from app.services import owner_service, prompt_rules

        prompt = owner_service.build_agent_prompt(
            script="Answer politely.", agent_name="Asha", channel="voice",
        )
        assert prompt_rules.VOICE_DELIVERY in prompt

    def test_the_retired_examples_are_gone(self, rag_prompt):
        """The verbal-nods section produced exactly the padding these rules
        exist to remove, and the dialogue examples were prompt length spent on
        two sample turns."""
        assert "Mmhmm" not in rag_prompt
        assert "CONVERSATIONAL EXAMPLES" not in rag_prompt


def test_every_persona_is_selectable():
    for persona in PERSONAS:
        prompt = build_instructions(rag_enabled=False, persona=persona["id"])
        assert prompt.strip()
