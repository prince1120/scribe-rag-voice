"""Synthetic streamed turns; no owner prompts, transcript, audio or secrets in output."""
import argparse
import asyncio
import json
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.voice.config import VoiceSettings, build_instructions
from app.services.voice.latency import percentiles
from app.services.voice.providers.llm_transport import observed_client

PROMPTS = ("What time do you open?", "Can I book an appointment tomorrow?", "How much is a consultation?")


async def sample(client, model, key):
    started = time.perf_counter()
    first = last = None
    usage = {}
    try:
        async with client.stream("POST", "https://api.sarvam.ai/v1/chat/completions",
                                 headers={"Authorization": f"Bearer {key}"}, json={
            "model": model, "stream": True, "reasoning_effort": None,
            "max_tokens": 220, "temperature": 0.3,
            "messages": [{"role": "system", "content": build_instructions(rag_enabled=False) +
                          " Opening hours are 9 AM to 5 PM; consultations cost 500 rupees. Check availability before booking."},
                         {"role": "user", "content": PROMPTS[sample.index % len(PROMPTS)]}],
        }) as response:
            response.raise_for_status()
            headers_ms = (time.perf_counter() - started) * 1000
            ssl = response.extensions["network_stream"].get_extra_info("ssl_object")
            alpn = ssl.selected_alpn_protocol() if ssl else None
            async for line in response.aiter_lines():
                if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                    continue
                chunk = json.loads(line[5:])
                usage = chunk.get("usage") or usage
                for choice in chunk.get("choices", []):
                    delta = choice.get("delta") or {}
                    if delta.get("content") or delta.get("tool_calls"):
                        last = (time.perf_counter() - started) * 1000
                        if first is None:
                            first = last
            return {"ttft_ms": first, "last_token_ms": last, "headers_ms": headers_ms,
                    "http_version": response.http_version, "alpn": alpn,
                    "input_tokens": usage.get("prompt_tokens"), "output_tokens": usage.get("completion_tokens")}
    except Exception as exc:
        # Provider error bodies and exception messages may echo request content.
        return {"error_type": type(exc).__name__, "status": getattr(getattr(exc, "response", None), "status_code", None)}
    finally:
        sample.index += 1


sample.index = 0


async def main(args):
    settings = VoiceSettings()
    if not settings.SARVAM_API_KEY:
        raise SystemExit("Sarvam server key is not configured; no benchmark sent.")
    for model in args.models:
        async with observed_client(http2=args.http2) as client:
            if args.prewarm:
                await client.head("https://api.sarvam.ai/v1/models")
            rows = []
            for index in range(args.turns):
                row = await sample(client, model, settings.SARVAM_API_KEY)
                rows.append(row)
                print(json.dumps({"model": model, "sample": index + 1, **row}), flush=True)
            print(json.dumps({"model": model, "http2_enabled": args.http2, "prewarm": args.prewarm,
                              "errors": sum("error_type" in r for r in rows),
                              "ttft_ms": percentiles([r.get("ttft_ms") for r in rows]),
                              "last_token_ms": percentiles([r.get("last_token_ms") for r in rows])}), flush=True)


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--turns", type=int, default=12)
    parser.add_argument("--models", nargs="+", default=["sarvam-105b-conversations"])
    parser.add_argument("--http2", action="store_true")
    parser.add_argument("--prewarm", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.turns <= 100:
        parser.error("--turns must be 1..100")
    asyncio.run(main(args))
