"""Chunk-safe speech cleaning and clause chunking for streaming TTS.

Cleans markdown/emojis and chunks text streams along natural grammatical
clause boundaries to provide immediate TTFB without sacrificing prosody.
"""
import re
from typing import AsyncIterable

_MARKDOWN_NOISE = str.maketrans("", "", "*_`#~^<>{}")
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_MD_BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+", re.MULTILINE)
_CITATION = re.compile(r"\[(?:Source\s*)?\d+(?:\.\d+)?\]")
_MD_PAREN_META = re.compile(r"\*\([^)]*\)\*|\([^)]*\)")

# Emojis & miscellaneous graphic symbols that TTS shouldn't verbalize
_EMOJI_PATTERN = re.compile(
    "[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF\U00002702-\U000027B0\U000024C2-\U0001F251]+",
    flags=re.UNICODE,
)

# Clause delimiters: terminal punctuation (. ? ! ।), line breaks, or intra-sentence clauses (, ; : — –)
_CLAUSE_SPLIT_REGEX = re.compile(r"([.?!;\n।|]+|\s*[,—–:]\s*)")


def strip_markdown_for_speech(text: str) -> str:
    if not text:
        return text
    text = _MD_LINK.sub(r"\1", text)
    text = _MD_PAREN_META.sub("", text)
    text = _CITATION.sub("", text)
    text = _MD_BULLET.sub("", text)
    text = _EMOJI_PATTERN.sub("", text)
    return text.translate(_MARKDOWN_NOISE)


async def stream_clause_chunks(
    text_stream: AsyncIterable[str],
    *,
    min_first_chunk_chars: int = 24,
    min_subsequent_chunk_chars: int = 48,
    max_chunk_chars: int = 140,
) -> AsyncIterable[str]:
    """Sliding-window clause chunker for streaming TTS.

    Ensures early TTFB on the very first clause without sacrificing prosody
    on subsequent full sentences, and prevents dangling token verbalization.
    """
    buffer = ""
    is_first_chunk = True

    def _find_split_point(buf: str, target_threshold: int, min_terminal: int = 12):
        for m in _CLAUSE_SPLIT_REGEX.finditer(buf):
            delimiters = m.group()
            # If terminal sentence boundary (. ? ! । \n) and has at least min_terminal chars
            if any(ch in delimiters for ch in ".?!।\n") and m.end() >= min_terminal:
                return m.end()
            # If clause boundary (, ; : — –), require target threshold
            if m.end() >= target_threshold:
                return m.end()
        return None

    async for chunk in text_stream:
        cleaned = strip_markdown_for_speech(chunk)
        if not cleaned:
            continue
        buffer += cleaned

        while True:
            threshold = (
                min_first_chunk_chars
                if is_first_chunk
                else min_subsequent_chunk_chars
            )
            if len(buffer) < 12:
                break

            split_point = _find_split_point(buffer, threshold)
            if split_point is not None:
                emit_text = buffer[:split_point].strip()
                buffer = buffer[split_point:].lstrip()
                if emit_text:
                    is_first_chunk = False
                    yield emit_text
            elif len(buffer) >= max_chunk_chars:
                # Emergency split on whitespace if sentence is exceedingly long without punctuation
                last_space = buffer.rfind(" ", threshold, max_chunk_chars)
                if last_space != -1:
                    emit_text = buffer[:last_space].strip()
                    buffer = buffer[last_space:].lstrip()
                else:
                    emit_text = buffer.strip()
                    buffer = ""
                if emit_text:
                    is_first_chunk = False
                    yield emit_text
                break
            else:
                break

    # Flush remaining buffer at the end of stream
    remaining = buffer.strip()
    if remaining:
        yield remaining
