"""Filling the silence while the model thinks.

Measured turns on this stack run 2.3-3.6s from the caller finishing to the first
audio back. Until now that was pure silence for any agent without RAG enabled —
which includes every agent whose owner answers from a prompt rather than
documents. Nobody waits three seconds without making a sound, and the absence of
one is most of what makes a voice agent feel like a machine.

The risk this carries is talking over the real answer, which is worse than the
silence being fixed. These pin the two behaviours that keep that from happening:
the filler is skipped when the reply has already started, and it never enters the
chat context.
"""
import asyncio

import pytest

from app.services.voice.agent import _THINKING_FILLERS
from app.services.voice.config import voice_settings


class _FakeSession:
    """Records what would be spoken. `current_speech` is what the real
    AgentSession exposes to say whether audio is already playing."""

    def __init__(self, current_speech=None):
        self.current_speech = current_speech
        self.said: list[tuple[str, dict]] = []

    def say(self, text, **kwargs):
        self.said.append((text, kwargs))


def _agent(session, delay=0.01):
    from app.services.voice.agent import VoiceAssistant

    settings = voice_settings.model_copy(
        update={"VOICE_THINKING_FILLER_DELAY": delay}
    )
    agent = VoiceAssistant(
        settings, instructions="test", rag_enabled=False, tenant_id="t1"
    )
    # The real Agent.session is set by the framework on start.
    object.__setattr__(agent, "_test_session", session)
    type(agent).session = property(lambda self: self._test_session)
    return agent


class TestItFillsTheSilence:
    async def test_a_slow_reply_gets_a_filler(self):
        session = _FakeSession(current_speech=None)
        agent = _agent(session)

        agent._start_thinking_filler()
        await asyncio.sleep(0.05)

        assert len(session.said) == 1
        assert session.said[0][0] in _THINKING_FILLERS

    async def test_the_filler_is_short(self):
        """It sits in front of the real answer, so anything long delays the
        thing the caller actually asked for."""
        for phrase in _THINKING_FILLERS:
            assert len(phrase.split()) <= 3, f"{phrase!r} is too long to precede an answer"


class TestItDoesNotTalkOverTheAnswer:
    async def test_no_filler_once_the_reply_has_started(self):
        """The failure this guard prevents: the model answers in 400ms, the
        filler fires at 700ms, and the caller hears "Okay so," on top of a
        sentence already in progress."""
        session = _FakeSession(current_speech=object())  # already speaking
        agent = _agent(session)

        agent._start_thinking_filler()
        await asyncio.sleep(0.05)

        assert session.said == []

    async def test_a_new_turn_cancels_the_previous_filler(self):
        """Two turns in quick succession must not stack two fillers."""
        session = _FakeSession(current_speech=None)
        agent = _agent(session, delay=0.05)

        agent._start_thinking_filler()
        agent._start_thinking_filler()
        await asyncio.sleep(0.12)

        assert len(session.said) == 1


class TestItStaysOutOfTheTranscript:
    async def test_the_filler_is_not_added_to_chat_context(self):
        """A filler is a mouth noise, not a turn. Recorded as one, the model
        reads it back as something it already said — and the owner's transcript
        fills with "Mm-hmm," lines that were never really turns."""
        session = _FakeSession(current_speech=None)
        agent = _agent(session)

        agent._start_thinking_filler()
        await asyncio.sleep(0.05)

        _, kwargs = session.said[0]
        assert kwargs.get("add_to_chat_ctx") is False

    async def test_the_filler_can_be_interrupted(self):
        """The caller talking over a filler must cut it — it carries nothing."""
        session = _FakeSession(current_speech=None)
        agent = _agent(session)

        agent._start_thinking_filler()
        await asyncio.sleep(0.05)

        _, kwargs = session.said[0]
        assert kwargs.get("allow_interruptions") is True


class TestItCanBeTurnedOff:
    async def test_zero_delay_disables_it(self):
        session = _FakeSession(current_speech=None)
        agent = _agent(session, delay=0)

        agent._start_thinking_filler()
        await asyncio.sleep(0.05)

        assert session.said == []


class TestSamplingIsUnchanged:
    def test_llm_temperature_stays_low(self):
        """Variation is bought in delivery, never in sampling. Raising this is
        the obvious fix for a repetitive agent and the wrong one: it is the same
        dial that governs instruction-following, and the failures on this stack
        have all been instruction failures — scripting both sides of the call,
        answering for the caller, ignoring the one-question rule."""
        assert voice_settings.VOICE_LLM_TEMPERATURE <= 0.4

    def test_delivery_variation_is_on(self):
        """TTS temperature varies the voice, not the words, so it cannot move
        the agent off its script."""
        assert voice_settings.VOICE_TTS_TEMPERATURE > 0
