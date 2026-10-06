"""Content-free latency records and percentile reporting (milliseconds)."""
import json
import logging
import math

logger = logging.getLogger(__name__)

# Reference budget, not a promise. STT and generation can overlap endpointing.
BUDGET_MS = {"endpointing_ms": 300, "llm_ttft_ms": 450,
             "first_token_to_audio_frame_ms": 200, "network_audio_ms": 75}


def emit(kind: str, **fields) -> None:
    logger.info("VOICE_LATENCY %s", json.dumps({"kind": kind, **fields}, allow_nan=False))


def milliseconds(value):
    return round(value * 1000, 3) if value is not None and value >= 0 else None


def turn_record(item, user_metrics=None):
    m = item.metrics or {}
    user_metrics = user_metrics or {}
    return {
        "turn_id": item.id,
        "interrupted": item.interrupted,
        "response_type": "llm_reply" if m.get("llm_node_ttft") is not None else "auxiliary_speech",
        "llm_ttft_ms": milliseconds(m.get("llm_node_ttft")),
        "first_token_to_audio_frame_ms": milliseconds(m.get("tts_node_ttfb")),
        "speech_end_to_server_audio_ms": milliseconds(m.get("e2e_latency")),
        "speech_end_to_final_transcript_ms": milliseconds(user_metrics.get("transcription_delay")),
        "endpointing_ms": milliseconds(user_metrics.get("end_of_turn_delay")),
        "turn_hook_ms": milliseconds(user_metrics.get("on_user_turn_completed_delay")),
        # Default RoomAudioOutput reports track publication, not browser playback.
        "speech_end_to_client_playback_ms": None,
        "budget_ms": BUDGET_MS,
        "budget_total_ms": sum(BUDGET_MS.values()),
        "target_p50_ms": 1000,
        "target_p95_ms": 1500,
    }


def percentiles(values):
    """Nearest rank; absent/invalid timings never become zero samples."""
    values = sorted(v for v in values if isinstance(v, (int, float)) and math.isfinite(v) and v >= 0)
    return {"n": len(values), **{
        f"p{p}": values[max(0, math.ceil(len(values) * p / 100) - 1)] if values else None
        for p in (50, 95, 99)
    }}
