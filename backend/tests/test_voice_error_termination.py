import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.voice import worker


@pytest.mark.parametrize('error_type', ['llm_error', 'stt_error', 'tts_error'])
@pytest.mark.parametrize('speech_failure', [False, True])
async def test_session_errors_close_once_even_when_closing_tts_fails(monkeypatch, error_type, speech_failure):
    events, tasks, order = {}, [], []

    class Session:
        def on(self, name):
            def register(callback):
                events[name] = callback
                return callback
            return register

        async def interrupt(self, **kwargs):
            order.append('interrupt')

        async def say(self, text, **kwargs):
            order.append('closing_audio')
            assert kwargs['allow_interruptions'] is False
            if speech_failure:
                events['error'](SimpleNamespace(error=SimpleNamespace(type='tts_error')))
                raise RuntimeError('private provider payload')

        async def aclose(self):
            order.append('closed')

    async def publish(packet, **kwargs):
        assert b'technical_issue' in packet
        order.append('ended_packet')

    async def disconnect():
        order.append('disconnected')

    def track(coro):
        task = asyncio.create_task(coro)
        tasks.append(task)
        return task

    monkeypatch.setattr(worker, '_track_task', track)
    room = SimpleNamespace(local_participant=SimpleNamespace(publish_data=publish), disconnect=disconnect)
    worker._attach_error_termination(Session(), room)
    event = SimpleNamespace(error=SimpleNamespace(type=error_type))
    events['error'](event)
    events['error'](event)
    await tasks[0]
    assert len(tasks) == 1
    assert order == ['interrupt', 'closing_audio', 'ended_packet', 'closed', 'disconnected']
