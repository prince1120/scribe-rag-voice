"""Measure the installed streaming TTS stack using delayed synthetic clauses."""
import argparse
import asyncio
import json
import logging
import sys
import time
from pathlib import Path

import aiohttp

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.voice.config import VoiceSettings
from app.services.voice.latency import percentiles
from app.services.voice.providers.sarvam_tts import build_sarvam_tts
from app.services.voice.streaming_tts import clause_audio


async def clauses(short_first=False):
    yield "One moment." if short_first else "The consultation costs 500 rupees, "
    await asyncio.sleep(0.5)
    yield "and we open at nine in the morning."


async def buffered_audio(provider, short_first=False):
    async with provider.stream() as stream:
        async def forward():
            async for text in clauses(short_first):
                stream.push_text(text)
            stream.end_input()
        task = asyncio.create_task(forward())
        try:
            async for event in stream:
                yield event.frame
            await task
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


async def main(args):
    settings = VoiceSettings(VOICE_TTS_MIN_BUFFER_CHARS=args.buffer_chars)
    if not settings.SARVAM_API_KEY:
        raise SystemExit("Sarvam server key is not configured.")
    codecs = ["mp3", "linear16"] if args.compare_codecs else [args.codec]
    rows = {codec: [] for codec in codecs}
    async with aiohttp.ClientSession() as http:
        providers = {codec: build_sarvam_tts(settings.model_copy(update={"VOICE_TTS_OUTPUT_CODEC": codec}),
                                           http_session=http) for codec in codecs}
        try:
            for index in range(args.turns * len(codecs)):
                codec = codecs[index % len(codecs)]
                provider = providers[codec]
                started = time.perf_counter()
                first = None
                audio_duration_ms = 0.0
                frame_count = 0
                playout_until = started
                max_playout_gap_ms = 0.0
                audio = clause_audio(provider, clauses(args.short_first_clause), prefetch=args.prefetch) if args.flush_clauses else buffered_audio(provider, args.short_first_clause)
                try:
                    async for frame in audio:
                        arrived = time.perf_counter()
                        if first is not None:
                            max_playout_gap_ms = max(max_playout_gap_ms, (arrived - playout_until) * 1000)
                        playout_until = max(playout_until, arrived) + frame.samples_per_channel / frame.sample_rate
                        frame_count += 1
                        audio_duration_ms += frame.samples_per_channel / frame.sample_rate * 1000
                        if first is None:
                            first = (time.perf_counter() - started) * 1000
                    rows[codec].append(first)
                    print(json.dumps({"sample": index + 1, "codec": codec, "first_clause_to_audio_ms": first,
                                      "audio_duration_ms": audio_duration_ms,
                                      "max_simulated_playout_gap_ms": max_playout_gap_ms,
                                      "frame_count": frame_count}), flush=True)
                except Exception as exc:
                    print(json.dumps({"sample": index + 1, "error_type": type(exc).__name__}), flush=True)
        finally:
            for provider in providers.values():
                await provider.aclose()
    print(json.dumps({"flush_clauses": args.flush_clauses, "buffer_chars": args.buffer_chars,
                      "first_clause_to_audio_ms": {codec: percentiles(values) for codec, values in rows.items()}}), flush=True)


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--turns", type=int, default=6)
    parser.add_argument("--flush-clauses", action="store_true")
    parser.add_argument("--buffer-chars", type=int, default=50)
    parser.add_argument("--codec", choices=("mp3", "linear16"), default="mp3")
    parser.add_argument("--compare-codecs", action="store_true")
    parser.add_argument("--short-first-clause", action="store_true")
    parser.add_argument("--prefetch", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.turns <= 100 or not 30 <= args.buffer_chars <= 200:
        parser.error("turns must be 1..100; buffer characters must be 30..200")
    asyncio.run(main(args))
