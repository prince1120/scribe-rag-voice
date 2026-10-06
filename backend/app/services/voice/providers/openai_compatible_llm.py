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
from openai import AsyncOpenAI
from app.services.voice.providers.llm_transport import observed_client
from app.services.voice.latency import emit, milliseconds
import asyncio

from app.services.voice.config import VoiceSettings



class ObservedLLM(lk_openai.LLM):
    def configure_prewarm(self, settings):
        self._prewarm_enabled = settings.VOICE_LLM_PREWARM
        self._keepalive_seconds = max(10, settings.VOICE_LLM_KEEPALIVE_SECONDS)
        self._warm_task = None

    def prewarm(self):
        if self._prewarm_enabled and self._warm_task is None:
            self._warm_task = asyncio.create_task(self._keep_warm())

    async def _keep_warm(self):
        while True:
            try:
                response = await self._client._client.head(
                    self._client.base_url.join("models"), timeout=3)
                # Any response proves connection setup; never print its body.
                emit("llm_prewarm", status=response.status_code, http_version=response.http_version)
            except Exception as exc:
                emit("llm_prewarm", error_type=type(exc).__name__)
            await asyncio.sleep(self._keepalive_seconds)

    async def aclose(self):
        if self._warm_task:
            self._warm_task.cancel()
            await asyncio.gather(self._warm_task, return_exceptions=True)
        try:
            await super().aclose()
        finally:
            await self._client.close()


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
    if settings.VOICE_LLM_HEDGE_ENABLED:
        raise ValueError("Voice hedging is disabled pending validated HTTP/2 RST_STREAM cancellation")
    options = {"extra_body": {"max_tokens": settings.VOICE_LLM_MAX_TOKENS, "reasoning_effort": None}} if sarvam else {"max_completion_tokens": settings.VOICE_LLM_MAX_TOKENS}
    client = AsyncOpenAI(api_key=settings.CUSTOM_LLM_API_KEY,
                         base_url=settings.CUSTOM_LLM_BASE_URL,
                         max_retries=0, http_client=observed_client(http2=settings.VOICE_LLM_HTTP2))
    model = ObservedLLM(
        client=client,
        model=settings.VOICE_LLM_MODEL,
        api_key=settings.CUSTOM_LLM_API_KEY,
        base_url=settings.CUSTOM_LLM_BASE_URL,
        temperature=settings.VOICE_LLM_TEMPERATURE,
        **options,
    )
    model.configure_prewarm(settings)
    @model.on("metrics_collected")
    def record_usage(metrics):
        emit("llm_stream", request_id=metrics.request_id, speech_id=metrics.speech_id,
             request_to_first_chunk_ms=milliseconds(metrics.ttft),
             request_to_last_chunk_ms=milliseconds(metrics.duration),
             cancelled=metrics.cancelled, input_tokens=metrics.prompt_tokens,
             cached_input_tokens=metrics.prompt_cached_tokens, output_tokens=metrics.completion_tokens)
    return model


def build_sarvam_llm(settings: VoiceSettings) -> llm.LLM:
    return build_custom_openai_llm(settings.model_copy(update={
        "CUSTOM_LLM_BASE_URL": "https://api.sarvam.ai/v1",
        "CUSTOM_LLM_API_KEY": settings.SARVAM_API_KEY,
    }))
