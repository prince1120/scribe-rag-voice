"""Filler handling — human silence masking without LLM tokens.

Randomized per turn from fixed lists the model never sees; saves TTS tokens
and keeps agent from sounding hesitant ("um/uh" removed from prompt).
"""
import asyncio
import logging
import random
from typing import Optional

logger = logging.getLogger(__name__)

_RAG_FILLER_PHRASES = [
    "Let me check that for you.",
    "Give me a second, looking that up.",
    "Let me look through the documents.",
    "One moment, checking the docs.",
    "Let me see what I can find on that.",
    "Just a second, searching now.",
    "Hold on, let me pull that up.",
    "Give me a moment to check the sources.",
]
_RAG_FILLER_DELAY_S = 0.35

_THINKING_FILLERS = [
    "Mm-hmm,", "Right,", "Okay,", "Sure,", "Got it,",
    "Let's see,", "Okay so,", "Alright,",
]


def pick_rag_filler() -> str:
    return random.choice(_RAG_FILLER_PHRASES)


def pick_thinking_filler() -> str:
    return random.choice(_THINKING_FILLERS)


def start_thinking_filler(agent, delay: float) -> None:
    if delay <= 0:
        return

    async def _speak_if_still_thinking() -> None:
        await asyncio.sleep(delay)
        if agent.session.current_speech is not None:
            return
        filler = pick_thinking_filler()
        agent.session.say(filler, allow_interruptions=True, add_to_chat_ctx=False)

    task = asyncio.create_task(_speak_if_still_thinking())
    prev: Optional[asyncio.Task] = getattr(agent, "_filler_task", None)
    if prev is not None and not prev.done():
        prev.cancel()
    agent._filler_task = task
