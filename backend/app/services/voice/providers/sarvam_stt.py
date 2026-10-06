"""Sarvam AI STT provider factory.

Uses the official `livekit-plugins-sarvam` package's `STT` class directly —
verified against the real package source (not just docs, which had
conflicting claims): it's a genuine streaming STT implementation over
Sarvam's WebSocket API, specialized for Indian languages.
"""
from livekit.agents import stt
from livekit.plugins import sarvam

from app.services.voice.config import VoiceSettings


def build_sarvam_stt(settings: VoiceSettings) -> stt.STT:
    if not settings.SARVAM_API_KEY:
        raise ValueError(
            "SARVAM_API_KEY is required for the Sarvam STT voice provider. Set it in .env."
        )
    return sarvam.STT(
        language=settings.VOICE_STT_LANGUAGE,
        model=settings.VOICE_STT_MODEL,
        api_key=settings.SARVAM_API_KEY,
        **({"high_vad_sensitivity": True} if settings.VOICE_STT_HIGH_VAD_SENSITIVITY else {}),
        **({"negative_frames_count": settings.VOICE_STT_SILENCE_FRAMES,
            "negative_frames_window": settings.VOICE_STT_SILENCE_FRAMES}
           if settings.VOICE_STT_SILENCE_FRAMES else {}),
    )
