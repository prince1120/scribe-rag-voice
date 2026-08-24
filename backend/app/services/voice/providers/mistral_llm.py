"""Mistral LLM provider for voice — free 1B tokens/month budget.

Uses Mistral's OpenAI-compatible endpoint (https://api.mistral.ai/v1) via
livekit-plugins-openai so the voice worker can stay on Mistral without
burning Groq quota. Falls back to MISTRAL_API_KEY from VoiceSettings.
This is the user's preferred voice LLM because of the free tier.
"""

from livekit.agents import llm
from livekit.plugins import openai as lk_openai

from app.services.voice.config import VoiceSettings

# Mistral's OpenAI-compatible base
MISTRAL_BASE_URL = "https://api.mistral.ai/v1"

# Sensible small defaults for voice latency + cost.
# mistral-small-latest is ~ cheapest + fastest with good instruction following.
DEFAULT_MISTRAL_VOICE_MODEL = "mistral-small-latest"


def build_mistral_llm(settings: VoiceSettings) -> llm.LLM:
    api_key = settings.MISTRAL_API_KEY or settings.GROQ_API_KEY  # allow fallback for dev
    if not api_key:
        # VoiceSettings.MISTRAL_API_KEY is set from .env MISTRAL_API_KEY
        raise ValueError(
            "MISTRAL_API_KEY is required for the Mistral voice LLM provider. "
            "Set MISTRAL_API_KEY in .env (free 1B tokens/month at https://console.mistral.ai/api-keys)."
        )
    model = settings.VOICE_LLM_MODEL or DEFAULT_MISTRAL_VOICE_MODEL
    # If someone left VOICE_LLM_MODEL as a Groq id (llama...), honour explicit Mistral model
    if model.startswith("llama") or model.startswith("openai/gpt-oss") or model.startswith("qwen"):
        model = DEFAULT_MISTRAL_VOICE_MODEL
    return lk_openai.LLM(
        model=model,
        api_key=api_key,
        base_url=MISTRAL_BASE_URL,
        temperature=settings.VOICE_LLM_TEMPERATURE,
        max_completion_tokens=settings.VOICE_LLM_MAX_TOKENS,
    )
