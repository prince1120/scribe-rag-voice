"""Sarvam AI TTS provider factory.

Uses the official `livekit-plugins-sarvam` package's `TTS` class directly —
verified against the real package source: a genuine streaming TTS
implementation (bulbul models) over Sarvam's WebSocket API.
"""
from livekit.agents import tts
from livekit.plugins import sarvam

from app.services.voice.config import VoiceSettings


def build_sarvam_tts(settings: VoiceSettings) -> tts.TTS:
    if not settings.SARVAM_API_KEY:
        raise ValueError(
            "SARVAM_API_KEY is required for the Sarvam TTS voice provider. Set it in .env."
        )
    return sarvam.TTS(
        target_language_code=settings.VOICE_TTS_LANGUAGE,
        speaker=settings.VOICE_TTS_SPEAKER,
        api_key=settings.SARVAM_API_KEY,
        # Delivery, not content. A flat default rate with no variation is most
        # of what makes synthesised speech read as synthesised: every sentence
        # arrives at the same tempo and the same sentence twice is bit-identical.
        pace=settings.VOICE_TTS_PACE,
        temperature=settings.VOICE_TTS_TEMPERATURE,
    )
