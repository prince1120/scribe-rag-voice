"""Generic OpenAI-compatible LLM provider factory.

Lets a caller point voice at *any* OpenAI-compatible chat completions API
(Mistral, OpenRouter, a self-hosted vLLM server, ...) just by supplying a
base URL + API key + model name — no new provider file needed per vendor,
unlike `groq_llm.py` which is Groq-specific. Both `base_url` and `api_key`
come from the per-job dispatch metadata (see worker.py), never from this
process's own .env — the whole point is the user brings their own endpoint.
"""
from livekit.agents import llm
from livekit.plugins import openai as lk_openai

from app.services.voice.config import VoiceSettings


def build_custom_openai_llm(settings: VoiceSettings) -> llm.LLM:
    if not settings.CUSTOM_LLM_BASE_URL:
        raise ValueError(
            "No custom LLM base URL was supplied for this session."
        )
    if not settings.CUSTOM_LLM_API_KEY:
        raise ValueError(
            "No custom LLM API key was supplied for this session."
        )
    return lk_openai.LLM(
        model=settings.VOICE_LLM_MODEL,
        api_key=settings.CUSTOM_LLM_API_KEY,
        base_url=settings.CUSTOM_LLM_BASE_URL,
        temperature=settings.VOICE_LLM_TEMPERATURE,
        max_completion_tokens=settings.VOICE_LLM_MAX_TOKENS,
    )
