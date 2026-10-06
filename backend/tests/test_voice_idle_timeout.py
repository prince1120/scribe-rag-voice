import asyncio
from types import SimpleNamespace

import pytest

from app.services.voice import worker


@pytest.mark.parametrize("answer", [None, "during_nudge", "after_nudge"])
@pytest.mark.parametrize("speech_failure", [False, True])
async def test_idle_nudge_waits_for_user_and_ends_after_grace(monkeypatch, answer, speech_failure):
    clock = [0.0]
    events, spoken, ended = {}, [], []
    room = SimpleNamespace(name="test", remote_participants={"caller": object()}, isconnected=lambda: True)
    async def disconnect():
        ended.append(clock[0])
        room.remote_participants.clear()
    room.disconnect = disconnect

    class Session:
        current_speech = None
        user_state = "listening"
        agent_state = "listening"
        def on(self, event, callback):
            events[event] = callback
        async def say(self, text, **kwargs):
            spoken.append((clock[0], text))
            events["agent_started_speaking"]()
            if speech_failure:
                if answer == "during_nudge" and len(spoken) == 1:
                    events["user_state_changed"](SimpleNamespace(new_state="speaking"))
                raise asyncio.TimeoutError()
            if len(spoken) == 1:
                clock[0] += 2
                if answer == "during_nudge":
                    events["user_state_changed"](SimpleNamespace(new_state="speaking"))
            return None
        async def aclose(self):
            ended.append("closed")

    async def sleep(seconds):
        clock[0] += seconds
        if answer == "after_nudge" and len(spoken) == 1 and clock[0] >= 25:
            events["user_input_transcribed"]()
        if answer and clock[0] >= 37:
            room.remote_participants.clear()
        await asyncio.sleep(0)
    monkeypatch.setattr(worker, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    monkeypatch.setattr(worker, "asyncio", SimpleNamespace(sleep=sleep, create_task=asyncio.create_task, wait_for=asyncio.wait_for))
    settings = SimpleNamespace(VOICE_MAX_CALL_SECONDS=900, VOICE_IDLE_TIMEOUT_SECONDS=45, VOICE_IDLE_GRACE_SECONDS=13)
    task = worker._enforce_call_ceilings(Session(), SimpleNamespace(settings=settings), room)
    await task
    assert spoken[0][0] == 20
    if answer:
        assert len(spoken) == 1 and not ended
    else:
        assert len(spoken) == 2
        expected = 33 if speech_failure else 35
        assert expected <= spoken[1][0] < expected + 0.5
        assert ended[-1] == "closed"


async def test_speech_deadline_bounds_both_scheduling_and_playback(monkeypatch):
    deadlines = []
    async def wait_for(awaitable, timeout):
        deadlines.append(timeout)
        awaitable.close()
        raise asyncio.TimeoutError()
    monkeypatch.setattr(worker, "asyncio", SimpleNamespace(wait_for=wait_for))
    with pytest.raises(asyncio.TimeoutError):
        await worker._say_bounded(SimpleNamespace(), "Goodbye")
    assert deadlines == [10.0]
