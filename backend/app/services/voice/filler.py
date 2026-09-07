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

_THINKING_FILLERS_BY_LANG: dict[str, list[str]] = {
    "hi-IN": ["जी,", "हाँ जी,", "देखते हैं,", "बिल्कुल,"],
    "en-IN": ["Got it,", "Right,", "Let's see,", "Okay,"],
}
_THINKING_FILLERS = _THINKING_FILLERS_BY_LANG["en-IN"]


def pick_rag_filler() -> str:
    return random.choice(_RAG_FILLER_PHRASES)


def pick_thinking_filler(lang: str = "en-IN") -> str:
    phrases = _THINKING_FILLERS_BY_LANG.get(lang, _THINKING_FILLERS_BY_LANG["en-IN"])
    return random.choice(phrases)


def cancel_thinking_filler(agent) -> None:
    task = getattr(agent, "_filler_task", None)
    if task is not None and not task.done():
        task.cancel()


def start_thinking_filler(agent, delay: float) -> None:
    if delay <= 0:
        return

    async def _speak_if_still_thinking() -> None:
        try:
            await asyncio.sleep(delay)
            if agent.session.current_speech is not None:
                return
            lang = getattr(agent, "_last_user_lang", "en-IN") or "en-IN"
            filler = pick_thinking_filler(lang)
            agent.session.say(filler, allow_interruptions=True, add_to_chat_ctx=False)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.debug("Could not play thinking filler", exc_info=True)

    task = asyncio.create_task(_speak_if_still_thinking())
    prev: Optional[asyncio.Task] = getattr(agent, "_filler_task", None)
    if prev is not None and not prev.done():
        prev.cancel()
    agent._filler_task = task
