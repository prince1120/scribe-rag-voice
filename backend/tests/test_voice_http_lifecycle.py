"""Windows job threads must never share an event-loop-bound aiohttp pool."""
import asyncio

from livekit.agents.utils import http_context

from app.services.voice import rag_client


def test_internal_http_pool_is_reused_within_job_and_closed_between_jobs():
    async def job():
        async with http_context.open():
            first = await rag_client._get_session()
            assert await rag_client._get_session() is first
            assert first._loop is asyncio.get_running_loop()
        return first

    first = asyncio.run(job())
    try:
        second = asyncio.run(job())
        assert first is not second
        assert first.closed and second.closed
    finally:
        if not first.closed:
            asyncio.run(first.close())
