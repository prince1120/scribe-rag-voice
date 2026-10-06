"""Conservative phrase hints for pauses; these are not a semantic model."""
import re

from app.services.voice.config import VoiceSettings

_INCOMPLETE_ENDINGS = {
    "and", "or", "but", "because", "so", "to", "for", "with", "about", "if",
    "when", "that", "is", "are", "was", "want", "need", "like",
    "aur", "ya", "lekin", "ki", "toh", "matlab", "kyunki",
    "um", "uh", "umm", "uhh", "erm", "hmm",
    "और", "लेकिन", "क्योंकि", "मतलब", "कि",
}
_THINKING_ENDINGS = ("let me think", "let me see", "one second", "just a second", "ek minute",
                    "do you", "can you", "would you", "could you", "i want to know",
                    "i wanted to know", "tell me about")


def punctuation_kind(text: str) -> str:
    tail = text.rstrip().rstrip('\"\u201d\u2019')
    if tail.endswith(("...", "…")):
        return "hesitation"
    if tail.endswith((",", ";", ":", "—", "–")):
        return "weak"
    if tail.endswith(("?", "!", ".", "।")):
        return "strong"
    return "none"


def endpointing_options(text: str, settings: VoiceSettings, is_final: bool) -> dict[str, float]:
    # Splitting on ASCII \w loses Devanagari vowel marks and mangles Hindi words.
    words = re.sub(r"[.?!।,…:;]+", " ", text.casefold()).split()
    normalized = " ".join(words)
    punctuation = punctuation_kind(text)
    # Check meaning cues BEFORE punctuation: ASR can add a period to "because."
    if punctuation == "hesitation" or (words and (
        words[-1] in _INCOMPLETE_ENDINGS or normalized.endswith(_THINKING_ENDINGS)
    )):
        return {"min_delay": 0.65, "max_delay": 1.0}
    # Number tails may be unfinished phone numbers, dates or prices.
    if words and words[-1].isdigit():
        return {"min_delay": 0.5, "max_delay": 0.75}
    if punctuation == "weak":
        return {"min_delay": 0.5, "max_delay": 0.75}
    if is_final and punctuation == "strong":
        return {"min_delay": 0.18, "max_delay": 0.36}
    return {"min_delay": settings.VOICE_ENDPOINTING_MIN_DELAY,
            "max_delay": settings.VOICE_ENDPOINTING_MAX_DELAY}
