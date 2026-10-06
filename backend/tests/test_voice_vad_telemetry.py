import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.services.voice.turn_metrics import attach_vad_events


def test_vad_boundaries_are_ordered_content_free_and_reliable():
    async def run():
        handlers = {}

        class Session:
            def on(self, name):
                def register(callback):
                    handlers[name] = callback
                    return callback
                return register

        publish = AsyncMock()
        attach_vad_events(Session(), room=SimpleNamespace(local_participant=
                          SimpleNamespace(publish_data=publish)), silence_seconds=0.24)
        handler = handlers['user_state_changed']
        handler(SimpleNamespace(old_state='listening', new_state='speaking'))
        handler(SimpleNamespace(old_state='speaking', new_state='listening'))
        handler(SimpleNamespace(old_state='listening', new_state='away'))
        for _ in range(4):
            await asyncio.sleep(0)
        packets = [json.loads(call.args[0]) for call in publish.call_args_list]
        assert packets == [
            {'type': 'user_vad', 'speaking': True, 'sequence': 1, 'confirmation_ms': 0},
            {'type': 'user_vad', 'speaking': False, 'sequence': 2, 'confirmation_ms': 240},
        ]
        assert all(call.kwargs == {'reliable': True, 'topic': 'voice.vad'}
                   for call in publish.call_args_list)

    asyncio.run(run())
