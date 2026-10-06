"""Explicit clause flush for streaming providers, with bounded task ownership."""
import asyncio


async def clause_audio(provider, text, *, conn_options=None):
    options = {"conn_options": conn_options} if conn_options is not None else {}
    async with provider.stream(**options) as stream:
        async def forward():
            try:
                async for clause in text:
                    stream.push_text(clause)
                    # push_text alone allows a second sentence tokenizer to buffer.
                    stream.flush()
            finally:
                stream.end_input()

        task = asyncio.create_task(forward())
        try:
            async for event in stream:
                yield event.frame
            await task
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
