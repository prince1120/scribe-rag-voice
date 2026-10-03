from app.services.voice.config import (
    SUPPORTED_STT_MODEL_IDS,
    SUPPORTED_TTS_MODEL_IDS,
    SUPPORTED_TTS_VOICES_BY_MODEL,
    voice_settings,
)
from app.services.voice.providers import sarvam_stt, sarvam_tts


def test_sarvam_model_catalog_has_only_runtime_supported_choices():
    assert SUPPORTED_STT_MODEL_IDS == {"saaras:v3", "saaras:v4"}
    assert SUPPORTED_TTS_MODEL_IDS == {"bulbul:v2", "bulbul:v3"}
    assert "anushka" in {
        voice["id"]
        for voices in SUPPORTED_TTS_VOICES_BY_MODEL["bulbul:v2"].values()
        for voice in voices
    }
    assert "priya" in {
        voice["id"]
        for voices in SUPPORTED_TTS_VOICES_BY_MODEL["bulbul:v3"].values()
        for voice in voices
    }


def test_stt_factory_forwards_selected_model(monkeypatch):
    captured = {}
    monkeypatch.setattr(sarvam_stt.sarvam, "STT", lambda **kwargs: captured.update(kwargs) or object())
    settings = voice_settings.model_copy(update={
        "SARVAM_API_KEY": "test-key",
        "VOICE_STT_MODEL": "saaras:v4",
    })
    sarvam_stt.build_sarvam_stt(settings)
    assert captured["model"] == "saaras:v4"


def test_tts_factory_enforces_model_voice_compatibility(monkeypatch):
    captured = {}
    monkeypatch.setattr(sarvam_tts.sarvam, "TTS", lambda **kwargs: captured.update(kwargs) or object())
    settings = voice_settings.model_copy(update={
        "SARVAM_API_KEY": "test-key",
        "VOICE_TTS_MODEL": "bulbul:v2",
        "VOICE_TTS_SPEAKER": "priya",
    })
    sarvam_tts.build_sarvam_tts(settings)
    assert captured["model"] == "bulbul:v2"
    assert captured["speaker"] == "anushka"
