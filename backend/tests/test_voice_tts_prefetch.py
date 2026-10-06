import asyncio
from types import SimpleNamespace

import pytest

from app.services.voice.streaming_tts import clause_audio


@pytest.mark.parametrize('cancel', [False, True])
async def test_lookahead_synthesizes_concurrently_preserves_order_and_closes_on_cancel(cancel):
    second_started = asyncio.Event()
    hold = asyncio.Event()
    streams = []

    class Stream:
        def __init__(self):
            self.index = len(streams) + 1
            self.closed = False
            streams.append(self)

        async def __aenter__(self):
            if self.index == 2:
                second_started.set()
            return self

        async def __aexit__(self, *_):
            self.closed = True

        def push_text(self, text):
            self.text = text

        def flush(self):
            pass

        def end_input(self):
            pass

        def __aiter__(self):
            async def frames():
                yield SimpleNamespace(frame=f'{self.index}-first')
                if self.index == 1:
                    await second_started.wait()  # Serial synthesis would deadlock here.
                elif cancel:
                    await hold.wait()
                yield SimpleNamespace(frame=f'{self.index}-last')
            return frames()

    async def text():
        yield 'First sentence.'
        yield 'Next sentence.'

    audio = clause_audio(SimpleNamespace(stream=lambda **options: Stream()), text(), prefetch=True)
    first = await asyncio.wait_for(anext(audio), 1)
    assert first == '1-first'
    await asyncio.wait_for(second_started.wait(), 1)
    if cancel:
        await audio.aclose()
    else:
        assert [frame async for frame in audio] == ['1-last', '2-first', '2-last']
    assert len(streams) == 2 and all(stream.closed for stream in streams)
