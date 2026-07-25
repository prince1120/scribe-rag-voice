"""The seam between business logic and vendors.

`agent.py` and `session_factory.py` depend only on these types — never on
`livekit.plugins.groq` / `livekit.plugins.sarvam` directly. A provider is
just a factory function that turns `VoiceSettings` into a LiveKit-native
`stt.STT` / `tts.TTS` / `llm.LLM` instance (those base classes are already
the real extension points LiveKit's `AgentSession` expects — wrapping them
in a second parallel interface would be indirection for its own sake, so
these aliases exist purely to name the contract, not to add a new one).

To add a new provider (e.g. Deepgram STT):
1. Implement `def build_deepgram_stt(settings: VoiceSettings) -> stt.STT` in
   `providers/deepgram_stt.py`, matching `STTFactory` below.
2. Register it: `registry.register_stt("deepgram", build_deepgram_stt)`.
No other file changes — `agent.py`/`session_factory.py` are untouched.
"""
from typing import Callable

from livekit.agents import llm, stt, tts

from app.services.voice.config import VoiceSettings

STTFactory = Callable[[VoiceSettings], stt.STT]
TTSFactory = Callable[[VoiceSettings], tts.TTS]
LLMFactory = Callable[[VoiceSettings], llm.LLM]
