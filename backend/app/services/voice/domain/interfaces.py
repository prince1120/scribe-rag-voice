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


class VoiceDataPacket:
    """Standardized protocol packet payloads exchanged over the LiveKit WebRTC DataChannel."""
    INTERRUPT = b'{"type":"interrupt"}'
    CALL_ENDED_IDLE = b'{"type":"call_ended","reason":"idle"}'
    CALL_ENDED_GOODBYE = b'{"type":"call_ended","reason":"goodbye"}'
    TELEMETRY_TYPE = "telemetry"

    @staticmethod
    def agent_unavailable(reason: str = "provider_busy") -> bytes:
        """Tell the browser that speech generation failed for this turn.

        A voice call remains open so it can recover on the next turn; the
        caller must never be left indefinitely on a generic thinking state.
        """
        import json
        return json.dumps({"type": "agent_unavailable", "reason": reason}).encode("utf-8")

    @staticmethod
    def telemetry(metrics: dict) -> bytes:
        import json
        return json.dumps({"type": VoiceDataPacket.TELEMETRY_TYPE, "metrics": metrics}).encode("utf-8")
