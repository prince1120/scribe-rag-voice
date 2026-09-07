"""Sarvam AI TTS provider factory.

Uses the official `livekit-plugins-sarvam` package's `TTS` class directly —
verified against the real package source: a genuine streaming TTS
implementation (bulbul models) over Sarvam's WebSocket API.
"""
from livekit.agents import tts
from livekit.plugins import sarvam

from app.services.voice.config import VoiceSettings


import logging

logger = logging.getLogger(__name__)

def build_sarvam_tts(settings: VoiceSettings) -> tts.TTS:
    if not settings.SARVAM_API_KEY:
        raise ValueError(
            "SARVAM_API_KEY is required for the Sarvam TTS voice provider. Set it in .env."
        )
    from app.services.voice.config import SUPPORTED_TTS_VOICE_IDS

    speaker = settings.VOICE_TTS_SPEAKER
    if speaker not in SUPPORTED_TTS_VOICE_IDS:
        logger.warning(
            "Requested TTS speaker '%s' is not supported in bulbul:v3. Falling back to 'shubh'.",
            speaker,
        )
        speaker = "shubh"

    return sarvam.TTS(
        target_language_code=settings.VOICE_TTS_LANGUAGE,
        speaker=speaker,
        api_key=settings.SARVAM_API_KEY,
        model="bulbul:v3",  # explicit — best prosody, supports all 11 voices
        # Human-like delivery: slight pace drag + higher temperature = natural variation.
        # enable_preprocessing improves number/currency/date verbalization (e.g. "₹50,000" → "fifty thousand").
        pace=settings.VOICE_TTS_PACE,
        temperature=settings.VOICE_TTS_TEMPERATURE,
        pitch=0.0,
        loudness=1.0,
        enable_preprocessing=True,
    )
