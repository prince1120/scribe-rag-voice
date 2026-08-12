"""The assistant must not answer noise.

From a live call, mid-order:

    AI     Got it. Which pizza type would you like?Sure thing. What pizza type
           would you like?What pizza type would you like?Which pizza would you
           like?Which pizza would you like?I'm sorry, I didn't catch the pizza
           type. Which one would you like?

Six re-phrasings run together, logged as a single turn with spoken=14.8s
against 2-4s for every other turn in the call.

They are different wordings, not a replayed sentence, so this was not
resume_false_interruption repeating audio — each was a fresh generation. The
sequence is: interruption fires on room noise, Sarvam transcribes the noise as
an empty or punctuation-only turn, the framework hands that to the LLM as a user
message, and the model answers the only way it can — by asking again. The noise
repeats, so does the loop, and "I'm sorry, I didn't catch the pizza type" is the
model telling us plainly that it received nothing.

The guard has to be narrow. A real answer to "which pizza?" is usually one word
— "medium", "large", "yes" — and suppressing one of those would be a worse bug
than the one being fixed: the caller answers and is met with silence.
"""
import pytest

from livekit.agents import StopResponse

from app.services.voice.agent import _is_empty_turn, _lexical_content


class TestNoiseIsNotSpeech:
    @pytest.mark.parametrize(
        "transcript",
        [
            "",
            " ",
            "   \n ",
            ".",
            "...",
            "?",
            "!!!",
            ". . .",
            "-",
            ",",
        ],
    )
    def test_empty_and_punctuation_only_turns_are_noise(self, transcript):
        """Sarvam returns punctuation rather than an empty string for a cough or
        a door closing, so an `if not text` check does not catch these."""
        assert _is_empty_turn(transcript)

    @pytest.mark.parametrize(
        "transcript", ["uh", "um", "hmm", "Hmm.", "  UH  ", "er", "ah", "mhm"]
    )
    def test_filler_syllables_are_noise(self, transcript):
        assert _is_empty_turn(transcript)


class TestRealSpeechIsNeverSuppressed:
    """The failure mode this guard could introduce, and it would be worse than
    the one it fixes: the caller answers and the assistant says nothing."""

    @pytest.mark.parametrize(
        "transcript",
        [
            "medium one",
            "medium",
            "large",
            "yes",
            "no",
            "ok",
            "okay",
            "sure",
            "pizza",
            "two",
            "3",
            "veg",
            "the cheese one",
            "what is the price?",
            "मुझे पिज़्ज़ा चाहिए",
            "मीडियम",
        ],
    )
    def test_a_real_answer_is_always_answered(self, transcript):
        assert not _is_empty_turn(transcript), (
            f"{transcript!r} is a real reply — suppressing it would leave the "
            "caller talking to silence"
        )

    def test_a_one_word_answer_survives_punctuation(self):
        assert not _is_empty_turn("Medium.")
        assert not _is_empty_turn("Yes!")

    def test_non_latin_script_is_not_stripped_as_punctuation(self):
        """A category test, not an ASCII pattern — this agent answers in Hindi
        and a regex like [a-z] would classify every Devanagari turn as noise."""
        assert _lexical_content("मीडियम") == "मीडियम"
        assert not _is_empty_turn("मीडियम")


class TestTheHookStopsTheReply:
    """Returning early is not enough — the reply would still be generated.
    StopResponse is what ends the turn without calling the LLM."""

    async def test_a_noise_turn_raises_stop_response(self):
        agent = _agent(rag_enabled=False)
        with pytest.raises(StopResponse):
            await agent.on_user_turn_completed(_ctx(), _msg("..."))

    async def test_a_noise_turn_is_stopped_even_when_rag_is_off(self):
        """The empty-turn check must run before the RAG early-return, or the
        loop survives for every non-RAG agent — which is the configuration the
        reported call was using (rag=False in the session log)."""
        agent = _agent(rag_enabled=False)
        with pytest.raises(StopResponse):
            await agent.on_user_turn_completed(_ctx(), _msg(""))

    async def test_real_speech_is_not_stopped(self):
        agent = _agent(rag_enabled=False)
        # No exception: the reply proceeds normally.
        await agent.on_user_turn_completed(_ctx(), _msg("medium one"))

    async def test_a_backchannel_still_gets_a_reply(self):
        """"okay" is speech. It skips the document search, but ignoring someone
        who just said "okay" is its own bug."""
        agent = _agent(rag_enabled=True)
        await agent.on_user_turn_completed(_ctx(), _msg("okay"))


# ---- helpers ---------------------------------------------------------------


def _agent(*, rag_enabled: bool):
    from app.services.voice.agent import VoiceAssistant
    from app.services.voice.config import voice_settings

    return VoiceAssistant(
        voice_settings,
        instructions="test",
        rag_enabled=rag_enabled,
        tenant_id="t1",
    )


def _ctx():
    from livekit.agents import llm

    return llm.ChatContext.empty()


def _msg(text: str):
    class _M:
        text_content = text

    return _M()
