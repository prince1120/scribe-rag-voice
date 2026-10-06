from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.voice.agent import VoiceAssistant, _is_goodbye_turn


@pytest.mark.parametrize("text", [
    "bye", "Okay, goodbye", "phir milenge", "please hang up",
    "end the call", "can you end this call", "disconnect the call now",
])
def test_explicit_farewell_or_hangup_is_recognized(text):
    assert _is_goodbye_turn(text)


@pytest.mark.parametrize("text", [
    "don't say goodbye", "do not hang up", "never end the call",
    "say goodbye", "what does goodbye mean", "tell me pricing, bye",
    "that's it", "done", "bas", "bye?", "",
])
def test_topic_closers_mentions_and_negations_do_not_end_call(text):
    assert not _is_goodbye_turn(text)


async def test_model_cannot_hang_up_without_current_caller_intent():
    agent = SimpleNamespace(_last_user_query="tell me the price", _auto_hangup_after_delay=AsyncMock())
    result = await VoiceAssistant.end_call(agent)
    assert "remains open" in result
    assert not getattr(agent, "_ending", False)
    agent._auto_hangup_after_delay.assert_not_called()
