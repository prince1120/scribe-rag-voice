"""Compare Sarvam finalization using synthetic TTS audio, kept only in memory."""
import asyncio
import argparse
import json
import logging
import re
import sys
import time
from pathlib import Path

import aiohttp
import numpy as np
from livekit import rtc
from livekit.agents import stt
from livekit.plugins import sarvam

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.voice.config import VoiceSettings
from app.services.voice.latency import percentiles
from app.services.voice.turn_hints import punctuation_kind


async def measure(http, settings, pcm, fast, silence_frames=0):
    provider = sarvam.STT(api_key=settings.SARVAM_API_KEY, model=settings.VOICE_STT_MODEL,
                          language=settings.VOICE_STT_LANGUAGE, http_session=http,
                          **({"negative_frames_count": silence_frames,
                              "negative_frames_window": silence_frames} if fast and silence_frames
                             else {"high_vad_sensitivity": True} if fast else {}))
    started = time.perf_counter()
    duration = len(pcm) / 32000
    results = []
    transcript_words = []
    punctuation = []
    async with provider.stream() as stream:
        async def feed():
            audio = pcm + bytes(32000 * 3)
            for offset in range(0, len(audio), 640):
                packet = audio[offset:offset + 640]
                stream.push_frame(rtc.AudioFrame(packet, 16000, 1, len(packet) // 2))
                # Real-time pacing; audio is not burst-uploaded.
                await asyncio.sleep(max(0, started + (offset + len(packet)) / 32000 - time.perf_counter()))

        task = asyncio.create_task(feed())
        try:
            async def receive():
                async for event in stream:
                    if event.type == stt.SpeechEventType.FINAL_TRANSCRIPT:
                        # Never print/store the transcript. Sensitive VAD may split
                        # one utterance into multiple provider final segments.
                        results.append(time.perf_counter())
                        if event.alternatives:
                            transcript_words.extend(re.findall(r"[a-z]+", event.alternatives[0].text.lower()))
                            punctuation.append(punctuation_kind(event.alternatives[0].text))
                        if time.perf_counter() >= started + duration:
                            return
            await asyncio.wait_for(receive(), 15)
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    await provider.aclose()
    return {"finalization_ms": (results[-1] - started - duration) * 1000,
            "early_final_segments": max(0, len(results) - 1),
            "synthetic_words_preserved": set("what are your opening hours on monday".split()).issubset(transcript_words),
            "provider_punctuation_classes": punctuation}


async def main(silence_frames=0):
    settings = VoiceSettings()
    rows = {False: [], True: []}
    async with aiohttp.ClientSession() as http:
        tts_provider = sarvam.TTS(api_key=settings.SARVAM_API_KEY, model=settings.VOICE_TTS_MODEL,
                                  speaker=settings.VOICE_TTS_SPEAKER, speech_sample_rate=16000, http_session=http)
        frames = []
        try:
            async with tts_provider.synthesize("What are your opening hours on Monday?") as audio:
                async for event in audio:
                    frames.append(event.frame.data.tobytes())
        finally:
            await tts_provider.aclose()
        pcm = b"".join(frames)
        samples = np.frombuffer(pcm, dtype=np.int16)
        voiced = [offset for offset in range(0, len(samples) - 320, 320)
                  if np.sqrt(np.mean(samples[offset:offset + 320].astype(float) ** 2)) > 480]
        if not voiced:
            raise RuntimeError("Synthetic fixture contains no audible speech")
        pcm = pcm[:(voiced[-1] + 320) * 2]
        for trial in range(3):
            for fast in ([False, True] if trial % 2 == 0 else [True, False]):
                result = await measure(http, settings, pcm, fast, silence_frames)
                rows[fast].append(result["finalization_ms"])
                print(json.dumps({"trial": trial + 1, "fast_vad": fast, **result}), flush=True)
    print(json.dumps({"baseline_ms": percentiles(rows[False]), "fast_vad_ms": percentiles(rows[True]),
                      "silence_frames": silence_frames, "synthetic_audio_only": True}), flush=True)


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--silence-frames", type=int, choices=range(0, 65), default=0)
    arguments = parser.parse_args()
    try:
        asyncio.run(main(arguments.silence_frames))
    except Exception as error:
        import traceback
        stack = traceback.extract_tb(error.__traceback__)
        print(json.dumps({"error_type": type(error).__name__, "location": [
            {"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
            for frame in stack[-3:]]}))
        raise SystemExit(1)
