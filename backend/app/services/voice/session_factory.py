"""Composition root for a voice session — mirrors the existing
module-level singleton-wiring convention in `app/api/routes.py` (resolve
config -> build concrete instances -> hand them to the thing that uses
them), just done per-job instead of once at process start, since each
LiveKit job gets its own `AgentSession`.

This is the ONLY place that turns provider *names* (from `VoiceSettings`)
into concrete provider *instances* (via the registry) and assembles them
into a running `AgentSession`. `agent.py` never sees vendor code; providers/
never see `AgentSession`.
"""
from livekit.agents import AgentSession
from livekit.plugins import silero

from app.services.voice.config import VoiceSettings
from app.services.voice.registry import ProviderRegistry


def build_agent_session(
    settings: VoiceSettings,
    registry: ProviderRegistry,
) -> AgentSession:
    stt_factory = registry.get_stt(settings.VOICE_STT_PROVIDER)
    tts_factory = registry.get_tts(settings.VOICE_TTS_PROVIDER)
    llm_factory = registry.get_llm(settings.VOICE_LLM_PROVIDER)

    return AgentSession(
        stt=stt_factory(settings),
        llm=llm_factory(settings),
        tts=tts_factory(settings),
        # Silero VAD, tuned for a shorter end-of-speech window so the agent
        # notices you've finished sooner. Auto-provisions if omitted, but
        # wiring it explicitly keeps this the single place the whole session
        # is assembled.
        vad=silero.VAD.load(min_silence_duration=settings.VOICE_VAD_MIN_SILENCE),
        # Turn handling tuned to feel like a real voice assistant:
        # - endpointing: respond quickly once you stop talking
        # - preemptive_generation: LLM runs early (default) + optionally TTS
        #   too, so the first audio comes back sooner
        # - interruption: mode="vad" is the key setting — it cuts the agent's
        #   TTS the instant Silero VAD detects you started talking, instead
        #   of "adaptive" mode which waits on STT/semantic signal (i.e.
        #   waits for words to actually be transcribed before deciding it's
        #   a real interruption — that wait is what read as "laggy barge-in").
        #   min_words=0 + a short min_duration means literally any detected
        #   speech interrupts, no need to wait for recognized words.
        turn_handling={
            "endpointing": {
                "min_delay": settings.VOICE_ENDPOINTING_MIN_DELAY,
                "max_delay": settings.VOICE_ENDPOINTING_MAX_DELAY,
            },
            "preemptive_generation": {
                "enabled": True,
                "preemptive_tts": settings.VOICE_PREEMPTIVE_TTS,
            },
            "interruption": {
                "enabled": True,
                "mode": "vad",
                "min_words": 0,
                "min_duration": 0.2,
                "resume_false_interruption": True,
            },
        },
    )
