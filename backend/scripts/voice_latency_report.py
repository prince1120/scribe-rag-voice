"""Read worker logs privately; print ONLY allowlisted numeric timing summaries."""
import argparse
from contextlib import nullcontext
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.voice.latency import percentiles


def records(paths):
    for path in paths:
        source_context = nullcontext(sys.stdin) if path == "-" else Path(path).open(encoding="utf-8", errors="replace")
        with source_context as source:
            for line in source:
                try:
                    outer = json.loads(line)
                    line = outer.get("message", "")
                except (ValueError, AttributeError):
                    pass
                if "VOICE_LATENCY " in line:
                    try:
                        yield json.loads(line.split("VOICE_LATENCY ", 1)[1])
                    except ValueError:
                        continue
                elif "[TURN " in line:
                    # Legacy e2e means server publication, never client playback.
                    fields = dict(re.findall(r"(e2e|llm_ttft|eot|stt|hook|tts_ttfb)=([\d.]+)ms", line))
                    if fields:
                        names = {"llm_ttft": "llm_ttft_ms", "e2e": "speech_end_to_server_audio_ms",
                                 "eot": "endpointing_ms", "stt": "speech_end_to_final_transcript_ms",
                                 "hook": "turn_hook_ms", "tts_ttfb": "first_token_to_audio_frame_ms"}
                        yield {"kind": "legacy_turn", **{names[k]: float(v) for k, v in fields.items()}}


def summary(rows):
    # Some worker log handlers duplicate the same structured event. Only dedupe
    # identified records; legacy lines cannot establish unique turn identity.
    seen = set()
    unique = []
    for row in rows:
        identity = (row.get("kind"), row.get("call_id"), row.get("turn_id"), row.get("request_id"))
        if row.get("turn_id") or row.get("request_id"):
            if identity in seen:
                continue
            seen.add(identity)
        unique.append(row)
    rows = unique
    fields = ("llm_ttft_ms", "speech_end_to_server_audio_ms", "speech_end_to_client_playback_ms",
              "speech_end_to_final_transcript_ms", "endpointing_ms", "turn_hook_ms", "first_token_to_audio_frame_ms",
              "request_to_headers_ms", "dns_tcp_ms", "tls_ms", "request_to_stream_end_ms",
              "duration_ms", "first_chunk_ms", "connection_acquire_ms", "interruption_to_silence_ms")
    for kind in ("turn", "legacy_turn", "llm_transport", "llm_stream", "stt_metrics", "tts_metrics", "llm_metrics", "client_turn"):
        group = [r for r in rows if r.get("kind") == kind]
        if group:
            for field in fields:
                yield {"kind": kind, "metric": field, **percentiles([r.get(field) for r in group])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("logs", nargs="+")
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    parser.add_argument("--last-call", action="store_true", help="Only records from the latest identified call")
    args = parser.parse_args()
    rows = list(records(args.logs))
    if args.last_call:
        calls = [r.get("call_id") for r in rows if r.get("kind") == "turn" and r.get("call_id")]
        rows = [r for r in rows if calls and r.get("call_id") == calls[-1]]
    if args.format == "markdown":
        print("| Source | Metric (ms) | n | p50 | p95 | p99 |")
        print("|---|---|---:|---:|---:|---:|")
    for row in summary(rows):
        if args.format == "json":
            print(json.dumps(row))
        elif row["n"] or (row["kind"] in ("turn", "legacy_turn") and row["metric"] in ("speech_end_to_client_playback_ms", "interruption_to_silence_ms")):
            print("| " + " | ".join(str(round(v, 1)) if isinstance(v, float) else str(v) if v is not None else "unmeasured"
                                     for v in row.values()) + " |")
