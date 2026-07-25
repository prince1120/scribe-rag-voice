"""Talks to the API server's /voice/retrieve and /voice/history endpoints.

Kept separate from agent.py (which owns *behavior*, not I/O) and separate
from providers/ (which are swappable STT/TTS/LLM vendors — this isn't a
provider, it's a call to our own backend). One job, one file, matching the
rest of this codebase's convention.
"""
import logging
from typing import Optional

import aiohttp

logger = logging.getLogger(__name__)


async def fetch_context(
    query: str,
    *,
    tenant_id: str,
    backend_url: str,
    api_key: str,
    top_k: int,
    timeout_s: float = 8.0,
) -> list[str]:
    """Top-k document chunk texts relevant to `query`, or [] on any failure
    — RAG being briefly unavailable should degrade the answer, not crash
    the call."""
    if not query.strip():
        return []
    headers = {"X-API-Key": api_key} if api_key else {}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{backend_url.rstrip('/')}/api/v1/voice/retrieve",
                json={"query": query, "tenant_id": tenant_id, "top_k": top_k},
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout_s),
            ) as resp:
                if resp.status != 200:
                    logger.warning("Voice RAG retrieve failed: HTTP %s", resp.status)
                    return []
                data = await resp.json()
                return [c for c in data.get("chunks", []) if c]
    except Exception:
        logger.warning("Voice RAG retrieve failed", exc_info=True)
        return []


async def fetch_history(
    conversation_id: str,
    *,
    tenant_id: str,
    backend_url: str,
    api_key: str,
    timeout_s: float = 8.0,
) -> list[dict]:
    """Prior text-chat messages for `conversation_id`, so a voice call can be
    seeded with what was already discussed. [] on any failure — a voice call
    should still start even if history can't be fetched."""
    headers = {"X-API-Key": api_key} if api_key else {}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{backend_url.rstrip('/')}/api/v1/voice/history",
                params={"conversation_id": conversation_id, "tenant_id": tenant_id},
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout_s),
            ) as resp:
                if resp.status != 200:
                    logger.warning("Voice history fetch failed: HTTP %s", resp.status)
                    return []
                data = await resp.json()
                return data.get("messages", [])
    except Exception:
        logger.warning("Voice history fetch failed", exc_info=True)
        return []
