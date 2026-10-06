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


async def clauses():
    yield "The consultation costs 500 rupees, "
    await asyncio.sleep(0.5)
    yield "and we open at nine in the morning."


async def buffered_audio(provider):
    async with provider.stream() as stream:
        async def forward():
            async for text in clauses():
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
    rows = []
    async with aiohttp.ClientSession() as http:
        provider = build_sarvam_tts(settings, http_session=http)
        try:
            for index in range(args.turns):
                started = time.perf_counter()
                first = None
                audio = clause_audio(provider, clauses()) if args.flush_clauses else buffered_audio(provider)
                try:
                    async for frame in audio:
                        if first is None:
                            first = (time.perf_counter() - started) * 1000
                    rows.append(first)
                    print(json.dumps({"sample": index + 1, "first_clause_to_audio_ms": first}), flush=True)
                except Exception as exc:
                    print(json.dumps({"sample": index + 1, "error_type": type(exc).__name__}), flush=True)
        finally:
            await provider.aclose()
    print(json.dumps({"flush_clauses": args.flush_clauses, "buffer_chars": args.buffer_chars,
                      "first_clause_to_audio_ms": percentiles(rows)}), flush=True)


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--turns", type=int, default=6)
    parser.add_argument("--flush-clauses", action="store_true")
    parser.add_argument("--buffer-chars", type=int, default=50)
    args = parser.parse_args()
    if not 1 <= args.turns <= 100 or not 30 <= args.buffer_chars <= 200:
        parser.error("turns must be 1..100; buffer characters must be 30..200")
    asyncio.run(main(args))
