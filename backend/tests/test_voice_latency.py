from types import SimpleNamespace

from app.services.voice.latency import percentiles, turn_record


def test_missing_timings_and_user_stage_correlation():
    item = SimpleNamespace(id="turn", interrupted=False, metrics={"llm_node_ttft": 0.8, "e2e_latency": 1.2})
    record = turn_record(item, {"transcription_delay": 0.2, "end_of_turn_delay": 0.3})
    assert record["llm_ttft_ms"] == 800
    assert record["speech_end_to_final_transcript_ms"] == 200
    assert record["speech_end_to_client_playback_ms"] is None
    assert percentiles([None, -1, float("nan"), 1, 2, 3, 4])["p95"] == 4
    assert percentiles([]) == {"n": 0, "p50": None, "p95": None, "p99": None}
