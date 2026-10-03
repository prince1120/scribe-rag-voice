"""Shared provider constants, endpoint identification and connection verification."""
from urllib.parse import urlsplit

import httpx

SARVAM_LLM_URL = "https://api.sarvam.ai/v1"
SARVAM_VOICE_MODEL = "sarvam-105b-conversations"
# Customer chat and voice share the conversational, non-thinking default.
# The flagship remains an explicit choice for owners who need it.
SARVAM_CHAT_MODEL = SARVAM_VOICE_MODEL


def is_sarvam_endpoint(url: str) -> bool:
    try:
        parsed = urlsplit(url or "")
        return parsed.scheme == "https" and parsed.hostname == "api.sarvam.ai" and parsed.port in (None, 443)
    except ValueError:
        return False


class ConnectionError(ValueError):
    pass


def validate_endpoint(url: str) -> str:
    url = url.strip().rstrip("/")
    if not url:
        return ""
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError()
        _ = parsed.port
    except ValueError:
        raise ConnectionError("Use an HTTP(S) API base URL without embedded credentials, query parameters or fragments.") from None
    return url


async def verify_connection(runtime: dict) -> None:
    if not runtime.get("model") or not runtime.get("api_key"):
        raise ConnectionError("Save a model and matching API key first.")
    base_url = validate_endpoint(runtime.get("base_url") or "https://api.groq.com/openai/v1")
    if is_sarvam_endpoint(base_url) and runtime["model"].lower() in {"sarvam-m", "sarvam-30b", "sarvam-30b-16k", "sarvam-105b-32k"}:
        raise ConnectionError("This Sarvam model is retired. Select Sarvam 105B Conversations (sarvam-105b-conversations), the default for voice, or Sarvam 105B (sarvam-105b), then save and test again.")
    body = {"model": runtime["model"], "messages": [{"role": "user", "content": "Reply with OK."}], "temperature": 0, "max_tokens": 8}
    if is_sarvam_endpoint(base_url):
        body["reasoning_effort"] = None
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(f"{base_url.rstrip('/')}/chat/completions", headers={"Authorization": f"Bearer {runtime['api_key']}"}, json=body)
    except httpx.HTTPError as exc:
        raise ConnectionError(f"Could not reach the LLM endpoint ({type(exc).__name__}).") from None
    if response.status_code >= 400:
        reason = {
            401: "The saved API key was not accepted.",
            403: "The saved API key was rejected or lacks access to this model.",
            402: "The provider requires credits or billing setup.",
            404: "The model or API route was not found.",
            429: "The provider's rate limit or quota was reached.",
        }.get(response.status_code, "Check model access and request compatibility with your provider.")
        raise ConnectionError(f"Connection test for {runtime['model']} at {base_url} failed (provider HTTP {response.status_code}). {reason}")
    try:
        content = response.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, ValueError):
        raise ConnectionError("The endpoint did not return an OpenAI chat-completions response.") from None
    if not isinstance(content, str) or not content.strip():
        raise ConnectionError("The model returned no text. Check the model's output settings.")
