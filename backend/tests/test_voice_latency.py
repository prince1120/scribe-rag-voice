from types import SimpleNamespace
import asyncio
import json
import logging

import httpx

from app.services.voice.latency import percentiles, turn_record


def test_missing_timings_and_user_stage_correlation():
    item = SimpleNamespace(id="turn", interrupted=False, metrics={"llm_node_ttft": 0.8, "e2e_latency": 1.2})
    record = turn_record(item, {"transcription_delay": 0.2, "end_of_turn_delay": 0.3})
    assert record["llm_ttft_ms"] == 800
    assert record["speech_end_to_final_transcript_ms"] == 200
    assert record["speech_end_to_client_playback_ms"] is None
    assert percentiles([None, -1, float("nan"), 1, 2, 3, 4])["p95"] == 4
    assert percentiles([]) == {"n": 0, "p50": None, "p95": None, "p99": None}


def test_transport_timings_do_not_expose_payload_or_credentials(caplog):
    from app.services.voice.providers.llm_transport import ObservedClient

    async def run():
        async def handler(request):
            trace = request.extensions["trace"]
            await trace("connection.connect_tcp.started", {"secret": "DO_NOT_LOG"})
            await trace("connection.connect_tcp.complete", {})
            return httpx.Response(200, json={"transcript": "PRIVATE_TEXT"})

        async with ObservedClient(transport=httpx.MockTransport(handler)) as client:
            response = await client.post("https://example.com/?key=SECRET_KEY",
                                         headers={"Authorization": "Bearer SECRET_KEY"},
                                         json={"content": "PRIVATE_TEXT"})
            assert response.status_code == 200

    with caplog.at_level(logging.INFO, logger="app.services.voice.latency"):
        asyncio.run(run())
    records = [record.message for record in caplog.records if "VOICE_LATENCY" in record.message]
    assert records
    assert all("PRIVATE_TEXT" not in record and "SECRET_KEY" not in record and "DO_NOT_LOG" not in record for record in records)
    result = json.loads(records[0].split("VOICE_LATENCY ", 1)[1])
    assert result["dns_tcp_ms"] >= 0
    assert result["tls_ms"] is None


def test_clause_flush_emits_before_later_text_and_cleans_up():
    from app.services.voice.streaming_tts import clause_audio

    async def run():
        queue = asyncio.Queue()
        later = asyncio.Event()

        class Stream:
            flushes = 0
            closed = False

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                self.closed = True

            def push_text(self, _):
                pass

            def flush(self):
                self.flushes += 1
                queue.put_nowait(SimpleNamespace(frame=self.flushes))

            def end_input(self):
                queue.put_nowait(None)

            def __aiter__(self):
                return self

            async def __anext__(self):
                value = await queue.get()
                if value is None:
                    raise StopAsyncIteration
                return value

        stream = Stream()
        provider = SimpleNamespace(stream=lambda **_: stream)

        async def text():
            yield "First clause,"
            await later.wait()
            yield "second clause."

        audio = clause_audio(provider, text())
        assert await asyncio.wait_for(anext(audio), 0.2) == 1
        assert not later.is_set()
        await audio.aclose()  # Barge-in must cancel the input task immediately.
        assert stream.closed

    asyncio.run(run())
