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
    from app.services.llm_connection import is_sarvam_endpoint

    if not settings.CUSTOM_LLM_BASE_URL:
        raise ValueError(
            "No custom LLM base URL was supplied for this session."
        )
    if not settings.CUSTOM_LLM_API_KEY:
        raise ValueError(
            "No custom LLM API key was supplied for this session."
        )
    sarvam = is_sarvam_endpoint(settings.CUSTOM_LLM_BASE_URL)
    options = {"extra_body": {"max_tokens": settings.VOICE_LLM_MAX_TOKENS, "reasoning_effort": None}} if sarvam else {"max_completion_tokens": settings.VOICE_LLM_MAX_TOKENS}
    return lk_openai.LLM(
        model=settings.VOICE_LLM_MODEL,
        api_key=settings.CUSTOM_LLM_API_KEY,
        base_url=settings.CUSTOM_LLM_BASE_URL,
        temperature=settings.VOICE_LLM_TEMPERATURE,
        **options,
    )


def build_sarvam_llm(settings: VoiceSettings) -> llm.LLM:
    return build_custom_openai_llm(settings.model_copy(update={
        "CUSTOM_LLM_BASE_URL": "https://api.sarvam.ai/v1",
        "CUSTOM_LLM_API_KEY": settings.SARVAM_API_KEY,
    }))
