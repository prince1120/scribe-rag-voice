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
        model="saaras:v3",
        api_key=settings.SARVAM_API_KEY,
    )
