"""Language mirroring: STT (Sarvam saaras:v3, unknown) -> LLM -> TTS (bulbul:v3).

Single responsibility: map detected user language to Sarvam TTS target_language_code.
No imports of agent/session so both worker and API can use it.

Sarvam supports STT auto-detect (language=unknown) and returns per-turn
language_code (see livekit-plugins-sarvam stt.py SpeechData.language).
TTS bulbul:v3 accepts same codes as target_language_code (see config.SUPPORTED_STT_LANGUAGES).
"""
import re
from app.services.voice.config import SUPPORTED_STT_LANGUAGE_IDS

# Sarvam STT -> TTS code mapping. STT "unknown" never reaches TTS; we normalize.
# Most codes are identical; keep explicit for future where they diverge.
STT_TO_TTS: dict[str, str] = {
    "en-IN": "en-IN",
    "hi-IN": "hi-IN",
    "bn-IN": "bn-IN",
    "ta-IN": "ta-IN",
    "te-IN": "te-IN",
    "kn-IN": "kn-IN",
    "ml-IN": "ml-IN",
    "mr-IN": "mr-IN",
    "gu-IN": "gu-IN",
    "pa-IN": "pa-IN",
    "od-IN": "od-IN",
    # Common variants Sarvam STT may emit (e.g. "en", "hi") -> normalize
    "en": "en-IN",
    "hi": "hi-IN",
    "bn": "bn-IN",
    "ta": "ta-IN",
    "te": "te-IN",
    "kn": "kn-IN",
    "ml": "ml-IN",
    "mr": "mr-IN",
    "gu": "gu-IN",
    "pa": "pa-IN",
    "od": "od-IN",
    "or": "od-IN",
}

DEFAULT_TTS_LANG = "hi-IN"  # fallback per user choice: Hindi

# Lightweight Hinglish/code-switch hint without calling STT confidence.
# If text contains Devanagari, prefer hi-IN; if mostly Latin but has Hindi words,
# still treat as hi-IN when STT already hinted hi. This is only fallback when
# STT language is missing/unknown.
_DEVANAGARI = re.compile(r"[\u0900-\u097F]")
_HINGLISH_HINTS = {"hai", "hain", "hun", "hoon", "aap", "aapko", "kya", "kaise", "kyu", "kyun", "matlab", "theek", "haan", "accha", "achha"}


def normalize_tts_lang(code: str | None, *, text_hint: str | None = None) -> str:
    """Map any STT language code (or None) to a valid bulbul:v3 target_language_code.

    - code in SUPPORTED => mapped via STT_TO_TTS
    - unknown/None/empty => infer from text_hint, else DEFAULT_TTS_LANG (hi-IN per owner)
    - never raises
    """
    raw = (code or "").strip()
    if raw and raw != "unknown":
        # exact match first
        if raw in STT_TO_TTS:
            mapped = STT_TO_TTS[raw]
            if mapped in SUPPORTED_STT_LANGUAGE_IDS and mapped != "unknown":
                return mapped
        # try lowercased / hyphen split
        low = raw.lower()
        if low in STT_TO_TTS and STT_TO_TTS[low] in SUPPORTED_STT_LANGUAGE_IDS:
            return STT_TO_TTS[low]
        # raw like "hi-IN" already valid
        if raw in SUPPORTED_STT_LANGUAGE_IDS and raw != "unknown":
            return raw

    # Fallback: infer from text when STT gave unknown/empty
    if text_hint:
        if _DEVANAGARI.search(text_hint):
            return "hi-IN"
        lowered = text_hint.lower()
        if any(w in lowered for w in _HINGLISH_HINTS):
            return "hi-IN"
        # if clearly English latin and no hint, keep en-IN
        if lowered.strip() and all(ord(c) < 128 or c.isspace() or c in ".,!?'" for c in lowered):
            # Heuristic: short English -> en-IN instead of hi-IN fallback
            # Only when STT was truly unknown and text is pure ascii
            return "en-IN"
    return DEFAULT_TTS_LANG
