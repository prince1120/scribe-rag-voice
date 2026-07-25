"""Provider registry — the DI container / composition seam.

This is where "add a provider = implement + register, no other changes"
actually happens: `session_factory.py` never imports a vendor package or
branches on provider name; it just asks the registry for whatever
`VoiceSettings.VOICE_{STT,TTS,LLM}_PROVIDER` names, and the registry raises a
clear error if that name isn't registered.

Adding Deepgram STT later means adding exactly one line here:
    register_stt("deepgram", build_deepgram_stt)
No changes to `agent.py` or `session_factory.py`.
"""
from typing import Dict

from app.services.voice.domain.interfaces import LLMFactory, STTFactory, TTSFactory
from app.services.voice.providers.groq_llm import build_groq_llm
from app.services.voice.providers.openai_compatible_llm import build_custom_openai_llm
from app.services.voice.providers.sarvam_stt import build_sarvam_stt
from app.services.voice.providers.sarvam_tts import build_sarvam_tts


class ProviderRegistry:
    """Name -> factory lookup for each of the three provider kinds, kept as
    separate maps (rather than one keyed by (kind, name)) since STT/TTS/LLM
    provider names are chosen independently — e.g. Sarvam STT + Groq LLM."""

    def __init__(self) -> None:
        self._stt: Dict[str, STTFactory] = {}
        self._tts: Dict[str, TTSFactory] = {}
        self._llm: Dict[str, LLMFactory] = {}

    def register_stt(self, name: str, factory: STTFactory) -> None:
        self._stt[name] = factory

    def register_tts(self, name: str, factory: TTSFactory) -> None:
        self._tts[name] = factory

    def register_llm(self, name: str, factory: LLMFactory) -> None:
        self._llm[name] = factory

    def get_stt(self, name: str) -> STTFactory:
        return self._lookup(self._stt, "STT", name)

    def get_tts(self, name: str) -> TTSFactory:
        return self._lookup(self._tts, "TTS", name)

    def get_llm(self, name: str) -> LLMFactory:
        return self._lookup(self._llm, "LLM", name)

    @staticmethod
    def _lookup(table: dict, kind: str, name: str):
        try:
            return table[name]
        except KeyError:
            available = ", ".join(sorted(table)) or "(none registered)"
            raise ValueError(
                f"Unknown {kind} provider '{name}'. Available: {available}."
            ) from None


def default_registry() -> ProviderRegistry:
    """The registry pre-populated with this project's built-in providers."""
    registry = ProviderRegistry()
    registry.register_stt("sarvam", build_sarvam_stt)
    registry.register_tts("sarvam", build_sarvam_tts)
    registry.register_llm("groq", build_groq_llm)
    registry.register_llm("custom_openai", build_custom_openai_llm)
    return registry
