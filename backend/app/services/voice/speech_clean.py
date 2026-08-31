"""Chunk-safe speech cleaning for TTS — markdown/citation noise removed.

Extracted from agent.py to keep VoiceAssistant small and modular.
Operates per streamed chunk (no cross-chunk buffering) so first audio not delayed.
"""
import re

_MARKDOWN_NOISE = str.maketrans("", "", "*_`#~^<>{}")
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_MD_BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+", re.MULTILINE)
_CITATION = re.compile(r"\[(?:Source\s*)?\d+(?:\.\d+)?\]")
_MD_PAREN_META = re.compile(r"\*\([^)]*\)\*|\([^)]*\)")


def strip_markdown_for_speech(text: str) -> str:
    if not text:
        return text
    text = _MD_LINK.sub(r"\1", text)
    text = _MD_PAREN_META.sub("", text)
    text = _CITATION.sub("", text)
    text = _MD_BULLET.sub("", text)
    return text.translate(_MARKDOWN_NOISE)
