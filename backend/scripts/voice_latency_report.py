"""Read worker logs privately; print ONLY allowlisted numeric timing summaries."""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.voice.latency import percentiles


def records(paths):
    for path in paths:
        with Path(path).open(encoding="utf-8", errors="replace") as source:
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
                    fields = dict(re.findall(r"(e2e|llm_ttft)=([\d.]+)ms", line))
                    if fields:
                        yield {"kind": "legacy_turn", "llm_ttft_ms": float(fields["llm_ttft"]) if "llm_ttft" in fields else None,
                               "speech_end_to_server_audio_ms": float(fields["e2e"]) if "e2e" in fields else None}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("logs", nargs="+")
    args = parser.parse_args()
    rows = list(records(args.logs))
    for kind in ("turn", "legacy_turn", "llm_transport", "llm_stream"):
        group = [r for r in rows if r.get("kind") == kind]
        for field in ("llm_ttft_ms", "speech_end_to_server_audio_ms", "speech_end_to_client_playback_ms",
                      "speech_end_to_final_transcript_ms", "endpointing_ms", "first_token_to_audio_frame_ms",
                      "request_to_headers_ms", "dns_tcp_ms", "tls_ms", "request_to_last_chunk_ms"):
            if group:
                print(json.dumps({"kind": kind, "metric": field, **percentiles([r.get(field) for r in group])}))
