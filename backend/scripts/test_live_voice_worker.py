"""Synthetic text turns through the real LiveKit worker; numeric results only."""
import asyncio
import json
import logging
import sys
import time
import uuid
from pathlib import Path

from livekit import api, rtc

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.voice.config import VoiceSettings
from app.services.voice.latency import percentiles


async def main():
    settings = VoiceSettings()
    room_name = "latency-test-" + uuid.uuid4().hex[:12]
    client = api.LiveKitAPI(settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
    room = rtc.Room()
    ready = asyncio.Event()
    tasks = []
    first_audio = None
    last_audible = 0.0
    rows = []

    async def audio(track):
        nonlocal last_audible
        stream = rtc.AudioStream(track)
        try:
            async for event in stream:
                samples = event.frame.data[::12]
                if samples and sum(abs(v) for v in samples) / len(samples) > 80:
                    last_audible = time.perf_counter()
                    if first_audio is not None and not first_audio.done():
                        first_audio.set_result(last_audible)
        finally:
            await stream.aclose()

    @room.on("track_subscribed")
    def subscribed(track, publication, participant):
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            tasks.append(asyncio.create_task(audio(track)))
            ready.set()

    try:
        token = api.AccessToken(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET).with_identity(
            "synthetic-latency-tester").with_grants(api.VideoGrants(room_join=True, room=room_name)).to_jwt()
        await room.connect(settings.LIVEKIT_URL, token)
        await client.agent_dispatch.create_dispatch(api.CreateAgentDispatchRequest(
            agent_name=settings.VOICE_AGENT_NAME, room=room_name,
            metadata=json.dumps({"rag_enabled": False, "greet_on_connect": False})))
        await asyncio.wait_for(ready.wait(), timeout=45)
        await asyncio.sleep(0.3)
        for index in range(3):
            first_audio = asyncio.get_running_loop().create_future()
            started = time.perf_counter()
            await room.local_participant.send_text(
                "Explain what a voice assistant is in one short sentence.", topic="lk.chat")
            received = await asyncio.wait_for(first_audio, timeout=20)
            elapsed = (received - started) * 1000
            rows.append(elapsed)
            print(json.dumps({"sample": index + 1, "text_sent_to_first_audible_received_frame_ms": round(elapsed, 1)}), flush=True)
            while time.perf_counter() - last_audible < 0.6:
                await asyncio.sleep(0.1)
        print(json.dumps({"room": room_name, "text_sent_to_first_audible_received_frame_ms": percentiles(rows),
                          "speech_end_to_speaker_playback_ms": None}), flush=True)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await room.disconnect()
        try:
            await client.room.delete_room(api.DeleteRoomRequest(room=room_name))
        finally:
            await client.aclose()


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    try:
        asyncio.run(main())
    except Exception as exc:
        print(json.dumps({"live_worker_test": "failed", "error_type": type(exc).__name__}))
        raise SystemExit(1)
