"""Talks to the API server's /voice/retrieve and /voice/history endpoints.

Kept separate from agent.py (which owns *behavior*, not I/O) and separate
from providers/ (which are swappable STT/TTS/LLM vendors — this isn't a
provider, it's a call to our own backend). One job, one file, matching the
rest of this codebase's convention.
"""
import asyncio
import logging
import time
from collections import OrderedDict
from typing import Optional

import aiohttp

logger = logging.getLogger(__name__)

# One connection pool for the whole worker process, rather than a fresh
# ClientSession per lookup. A new session meant a new TCP handshake — and TLS
# handshake when the API is behind HTTPS — on every single conversational
# turn, before retrieval even began. Reusing a keep-alive connection removes
# that from the critical path between the user finishing a sentence and the
# assistant starting to speak.
_session: Optional[aiohttp.ClientSession] = None
_session_lock = asyncio.Lock()

# A caller will often repeat a question after an interruption ("what was the
# price again?") or clarify it with identical words.  Sending that exact query
# through embeddings + vector search a second time adds avoidable dead air.
# Keep this deliberately tiny and short lived: results are isolated by tenant
# and backend, expire quickly after a knowledge-base edit, and failed lookups
# are never cached.
_CONTEXT_CACHE_TTL_S = 20.0
_CONTEXT_CACHE_MAX_ENTRIES = 64
_context_cache: OrderedDict[tuple[str, str, int, str], tuple[float, list[str]]] = OrderedDict()
_context_cache_lock = asyncio.Lock()


def _context_cache_key(query: str, tenant_id: str, backend_url: str, top_k: int) -> tuple[str, str, int, str]:
    """Normalize only whitespace; retrieval still receives the caller's text."""
    normalized_query = " ".join(query.casefold().split())
    return (tenant_id, backend_url.rstrip("/").casefold(), top_k, normalized_query)


async def _get_cached_context(key: tuple[str, str, int, str]) -> Optional[list[str]]:
    now = time.monotonic()
    async with _context_cache_lock:
        entry = _context_cache.get(key)
        if entry is None:
            return None
        expires_at, chunks = entry
        if expires_at <= now:
            _context_cache.pop(key, None)
            return None
        _context_cache.move_to_end(key)
        # Return a copy so later per-turn truncation cannot mutate the cache.
        return list(chunks)


async def _cache_context(key: tuple[str, str, int, str], chunks: list[str]) -> None:
    async with _context_cache_lock:
        _context_cache[key] = (time.monotonic() + _CONTEXT_CACHE_TTL_S, list(chunks))
        _context_cache.move_to_end(key)
        while len(_context_cache) > _CONTEXT_CACHE_MAX_ENTRIES:
            _context_cache.popitem(last=False)


async def _get_session() -> aiohttp.ClientSession:
    global _session
    if _session is None or _session.closed:
        async with _session_lock:
            # Re-checked inside the lock: several turns can race here on the
            # first lookup of a call.
            if _session is None or _session.closed:
                _session = aiohttp.ClientSession(
                    connector=aiohttp.TCPConnector(
                        limit=16,
                        # Keep sockets warm across the gaps between turns; the
                        # default 15s would expire during any normal pause in
                        # conversation and force a reconnect.
                        keepalive_timeout=90,
                        ttl_dns_cache=300,
                    )
                )
    return _session


async def close_session() -> None:
    """Release the pool on worker shutdown so aiohttp doesn't log unclosed
    session warnings and sockets are torn down deterministically."""
    global _session
    if _session is not None and not _session.closed:
        await _session.close()
    _session = None


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
    cache_key = _context_cache_key(query, tenant_id, backend_url, top_k)
    cached = await _get_cached_context(cache_key)
    if cached is not None:
        logger.debug("Voice RAG cache hit for tenant %s", tenant_id)
        return cached
    headers = {"X-Internal-Key": api_key} if api_key else {}
    try:
        session = await _get_session()
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
            chunks = [c for c in data.get("chunks", []) if c]
            if chunks:
                await _cache_context(cache_key, chunks)
            return chunks
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
    headers = {"X-Internal-Key": api_key} if api_key else {}
    try:
        session = await _get_session()
        async with session.get(
            f"{backend_url.rstrip('/')}/api/v1/voice/history",
            params={"conversation_id": conversation_id},
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
