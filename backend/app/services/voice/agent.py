"""The voice assistant's behavior.

Depends only on `livekit.agents.Agent` and `rag_client` (our own backend's
retrieve endpoint) — never on a vendor STT/TTS/LLM package directly. Which
provider actually powers a session is decided by `session_factory.py` and
handed to `AgentSession`; that's the dependency-inversion boundary the
module is built around.
"""
import asyncio
import logging
import random
import re
from typing import Optional

from livekit.agents import Agent, llm

from app.services.voice import rag_client
from app.services.voice.config import VoiceSettings

logger = logging.getLogger(__name__)

# Spoken if a document lookup is still running after _RAG_FILLER_DELAY_S, so
# a slow retrieval sounds like the assistant thinking instead of dead air.
# Randomized per turn — reusing one fixed phrase on every slow lookup within
# a call gets noticeably robotic.
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
_RAG_FILLER_DELAY_S = 1.0

# Whole-utterance backchannel/closer phrases — a turn that's *just* one of
# these (plus trivial punctuation) is the user acknowledging or disengaging,
# never a new question, so it should never trigger a document search or a
# re-explanation of whatever was just discussed.
_BACKCHANNEL_PHRASES = {
    "ok", "okay", "kk", "alright", "all right", "cool", "great", "perfect",
    "got it", "gotcha", "understood", "fine", "that's fine", "thats fine",
    "no", "nope", "yes", "yeah", "yep", "sure",
    "never mind", "nevermind", "leave it", "forget it", "that's all",
    "thats all", "that's it", "thanks", "thank you", "thanks a lot",
    "bye", "goodbye", "see you", "hello", "hi", "hey",
}

# A short utterance with none of these is almost never a real question —
# it's filler ("alright, it's...") trailing off, not something to search on.
_QUESTION_HINTS = (
    "?", "what", "who", "when", "where", "why", "how", "which",
    "tell me", "explain", "find", "number", "contact", "detail",
    "can you", "do you", "does it", "is it", "will it",
)


def _truncate_words(text: str, max_words: int) -> str:
    """Caps an excerpt's input-token footprint. Chunks arrive reranker-sorted,
    so the most relevant part of each is at the front — trimming the tail is
    a reasonable trade for a spoken answer, which was never going to recite
    a full 512-word chunk verbatim anyway."""
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + " …"


def _should_search(query: str) -> bool:
    """Whether this turn looks like it's actually asking for something, as
    opposed to a backchannel/closer ("okay", "that's fine, leave it") that
    should just be acknowledged and moved past — not re-triggered into
    another document lookup and repeat explanation."""
    normalized = re.sub(r"[.,!?]+$", "", query.strip().lower())
    if not normalized:
        return False
    if normalized in _BACKCHANNEL_PHRASES:
        return False
    if len(normalized.split()) <= 4 and not any(hint in normalized for hint in _QUESTION_HINTS):
        return False
    return True


# Characters that are silent on a page but not in a synthesiser: Sarvam reads
# "**" as "star star", "^" as "caret", and "#" as "hash". The system prompt already forbids
# markdown, but instruction-following degrades on small fast models — and the
# fast models are exactly the ones voice wants. So this is enforced in code
# rather than requested in a prompt.
_MARKDOWN_NOISE = str.maketrans("", "", "*_`#~^<>{}")

# "[label](url)" -> "label". The URL is unspeakable and the brackets are noise.
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
# Leading list bullets: "- item" / "3. item" -> "item". Ordinals read as
# "three." mid-sentence, which sounds like a false start.
_MD_BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+", re.MULTILINE)
# Citation markers leak in from RAG excerpts; spoken, they are meaningless.
_CITATION = re.compile(r"\[(?:Source\s*)?\d+(?:\.\d+)?\]")
# Parenthetical meta-thoughts like *(If you meant...)* or (aside)
_MD_PAREN_META = re.compile(r"\*\([^)]*\)\*|\([^)]*\)")


def strip_markdown_for_speech(text: str) -> str:
    """Make a chunk safe to speak.

    Operates per streamed chunk, so it only removes characters that cannot
    span a chunk boundary — no multi-character sequence is reassembled here,
    which keeps it correct without buffering the whole reply and delaying the
    first audio.
    """
    if not text:
        return text
    text = _MD_PAREN_META.sub("", text)
    text = _MD_LINK.sub("\\1", text)
    text = _CITATION.sub("", text)
    text = _MD_BULLET.sub("", text)
    return text.translate(_MARKDOWN_NOISE)


class VoiceAssistant(Agent):
    def __init__(
        self,
        settings: VoiceSettings,
        *,
        instructions: str,
        rag_enabled: bool = False,
        tenant_id: str = "default",
        chat_ctx: Optional[llm.ChatContext] = None,
    ) -> None:
        super().__init__(instructions=instructions, chat_ctx=chat_ctx)
        self._settings = settings
        self._rag_enabled = rag_enabled
        self._tenant_id = tenant_id

    async def tts_node(self, text, model_settings):
        """Last stop before synthesis — everything spoken passes through here,
        whichever LLM produced it."""
        async def cleaned():
            async for chunk in text:
                out = strip_markdown_for_speech(chunk)
                if out:
                    yield out

        async for frame in Agent.default.tts_node(self, cleaned(), model_settings):
            yield frame

    async def on_user_turn_completed(
        self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ) -> None:
        """RAG hook: called after each user turn, before the LLM runs. When
        RAG is enabled *and* this turn actually looks like a question,
        fetch the most relevant document chunks and inject them as a system
        message ahead of the reply. Backchannel turns ("okay", "leave it")
        are skipped entirely — no search, no re-injected context — so the
        model has nothing prompting it to repeat what was already said."""
        if not self._rag_enabled:
            return

        query = new_message.text_content
        if not query or not _should_search(query):
            return

        fetch_task = asyncio.create_task(
            rag_client.fetch_context(
                query,
                tenant_id=self._tenant_id,
                backend_url=self._settings.VOICE_BACKEND_URL,
                api_key=self._settings.INTERNAL_API_KEY or self._settings.API_KEY,
                top_k=self._settings.VOICE_RAG_TOP_K,
            )
        )
        done, _ = await asyncio.wait({fetch_task}, timeout=_RAG_FILLER_DELAY_S)
        if fetch_task not in done:
            filler = random.choice(_RAG_FILLER_PHRASES)
            logger.info("Document lookup running long — speaking filler: %s", filler)
            self.session.say(filler, allow_interruptions=True)

        chunks = await fetch_task
        if not chunks:
            return

        max_words = self._settings.VOICE_RAG_EXCERPT_MAX_WORDS
        chunks = [_truncate_words(c, max_words) for c in chunks]
        excerpts = "\n\n".join(f"[{i + 1}] {c}" for i, c in enumerate(chunks))
        turn_ctx.add_message(
            role="system",
            content=(
                "Relevant excerpts from the user's documents for this "
                f"question:\n\n{excerpts}"
            ),
        )
