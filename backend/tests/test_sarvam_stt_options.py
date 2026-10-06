from app.services.voice.config import VoiceSettings
from app.services.voice.providers import sarvam_stt


def test_fast_vad_is_opt_in_and_keeps_provider_defaults_when_disabled(monkeypatch):
    monkeypatch.setattr(sarvam_stt.sarvam, "STT", lambda **options: options)
    settings = VoiceSettings(SARVAM_API_KEY="synthetic-test-key", VOICE_STT_HIGH_VAD_SENSITIVITY=False)
    baseline = sarvam_stt.build_sarvam_stt(settings)
    assert "high_vad_sensitivity" not in baseline
    tuned = sarvam_stt.build_sarvam_stt(settings.model_copy(update={"VOICE_STT_HIGH_VAD_SENSITIVITY": True}))
    assert tuned["high_vad_sensitivity"] is True
    assert tuned["model"] == baseline["model"]
    assert tuned["language"] == baseline["language"]
    moderate = sarvam_stt.build_sarvam_stt(settings.model_copy(update={"VOICE_STT_SILENCE_FRAMES": 8}))
    assert moderate["negative_frames_count"] == moderate["negative_frames_window"] == 8
    assert "high_vad_sensitivity" not in moderate
