"""Early clauses with one output stream each, preserving the provider's pool."""
import asyncio
from contextlib import aclosing


async def clause_audio(provider, text, *, conn_options=None, prefetch=False):
    if prefetch:
        async with aclosing(_prefetched_audio(provider, text, conn_options)) as audio:
            async for frame in audio:
                yield frame
        return
    options = {"conn_options": conn_options} if conn_options is not None else {}
    async for clause in text:
        if not clause.strip():
            continue
        # Sarvam's completion event ends the entire stream's AudioEmitter.
        # A fresh output stream per clause avoids losing later segments; the
        # provider still reuses its pooled WebSocket connection between streams.
        async with provider.stream(**options) as stream:
            stream.push_text(clause)
            stream.flush()
            stream.end_input()
            async for event in stream:
                yield event.frame


async def _prefetched_audio(provider, text, conn_options):
    """At most current + next clause, ordered output, bounded frame queues."""
    options = {"conn_options": conn_options} if conn_options is not None else {}
    source = text.__aiter__()
    tasks = set()
    next_task = None

    async def render(clause, queue):
        try:
            async with provider.stream(**options) as stream:
                stream.push_text(clause)
                stream.flush()
                stream.end_input()
                async for event in stream:
                    await queue.put(event.frame)
            await queue.put(None)
        except Exception as exc:
            await queue.put(exc)

    async def prepare():
        async for clause in source:
            if not clause.strip():
                continue
            queue = asyncio.Queue(maxsize=8)
            task = asyncio.create_task(render(clause, queue))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
            return queue
        return None

    try:
        current = await prepare()
        while current is not None:
            while True:
                frame = await current.get()
                if frame is None:
                    break
                if isinstance(frame, Exception):
                    raise frame
                if next_task is None:
                    # Do not compete for connection/inference resources until
                    # the first clause has already produced its first frame.
                    next_task = asyncio.create_task(prepare())
                yield frame
            if next_task is None:
                next_task = asyncio.create_task(prepare())
            current = await next_task
            next_task = None
    finally:
        if next_task is not None:
            next_task.cancel()
            await asyncio.gather(next_task, return_exceptions=True)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
