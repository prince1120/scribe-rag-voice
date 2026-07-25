"""Groq LLM provider factory.

Uses the official `livekit-plugins-groq` package, which subclasses the
OpenAI plugin's LLM pointed at Groq's OpenAI-compatible endpoint — no custom
adapter needed, this is a real, maintained LiveKit plugin.
"""
from livekit.agents import llm
from livekit.plugins import groq

from app.services.voice.config import VoiceSettings


def build_groq_llm(settings: VoiceSettings) -> llm.LLM:
    if not settings.GROQ_API_KEY:
        raise ValueError(
            "GROQ_API_KEY is required for the Groq LLM voice provider. Set it in .env."
        )
    return groq.LLM(
        model=settings.VOICE_LLM_MODEL,
        api_key=settings.GROQ_API_KEY,
        temperature=settings.VOICE_LLM_TEMPERATURE,
        max_completion_tokens=settings.VOICE_LLM_MAX_TOKENS,
    )
