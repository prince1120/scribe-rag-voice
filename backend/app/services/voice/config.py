"""Settings for the VoiceBot worker.

Deliberately separate from `app.config.Settings` — the voice worker runs as
its own long-lived process (`python -m app.services.voice.worker`), dispatched
jobs by LiveKit, independent of the `uvicorn app.main:app` request/response
server. Keeping its config self-contained means the worker can be deployed,
scaled, and restarted independently without dragging in unrelated API-server
settings (Qdrant, rate limits, CORS, etc.) or vice versa.

Both this class and `app.config.Settings` read the same `.env` file — that's
intentional, not duplication-by-accident: each process declares only the
subset of keys it actually needs.
"""
from pydantic_settings import BaseSettings


class VoiceSettings(BaseSettings):
    # LiveKit connection (the worker registers with this server/Cloud
    # instance and receives dispatched voice-session jobs from it).
    LIVEKIT_URL: str = ""
    LIVEKIT_API_KEY: str = ""
    LIVEKIT_API_SECRET: str = ""

    # Provider selection — the actual extensibility knob. Changing these to
    # e.g. "deepgram" only works once a matching provider is implemented and
    # registered in registry.py; until then an unknown name fails fast with
    # a clear error rather than silently falling back to something else.
    VOICE_STT_PROVIDER: str = "sarvam"
    VOICE_TTS_PROVIDER: str = "sarvam"
    VOICE_LLM_PROVIDER: str = "groq"

    # Sarvam
    SARVAM_API_KEY: str = ""
    # "unknown" = auto-detect the spoken language. This only works with the
    # saaras:v3 STT model (set in providers/sarvam_stt.py) — the earlier
    # default (saarika:v2.5) silently returned ZERO transcripts with
    # "unknown" (audio streamed continuously but no result ever came back).
    # saaras:v3 supports every listed language plus reliable auto-detect.
    VOICE_STT_LANGUAGE: str = "unknown"
    VOICE_TTS_LANGUAGE: str = "en-IN"
    # Must be compatible with the TTS plugin's default model (bulbul:v3) —
    # bulbul:v2 speakers like "anushka" will raise at construction time.
    VOICE_TTS_SPEAKER: str = "shubh"

    # Groq — default to the *instant* model: for real-time voice, time-to-
    # first-token dominates perceived latency, and 8b-instant is far snappier
    # than 70b-versatile. Override VOICE_LLM_MODEL in .env if you'd rather
    # trade latency for the larger model's reasoning.
    GROQ_API_KEY: str = ""
    VOICE_LLM_MODEL: str = "llama-3.1-8b-instant"
    # Deliberately lower than text chat's rag_pipeline.py default (800): a
    # spoken answer needs to stay short to be listenable (800 tokens is
    # roughly a minute of TTS) and short is also cheap. The Settings panel's
    # temperature/max tokens sliders can still override this per-session via
    # the token request, but worker.py clamps it to VOICE_LLM_MAX_TOKENS_CAP
    # so a chat-sized value never gets sent straight to a voice reply.
    VOICE_LLM_TEMPERATURE: float = 0.3
    # Raised from 200: at that ceiling a multi-part spoken answer got cut off
    # mid-sentence, which is what made replies feel shallow. ~320 tokens is
    # roughly 25 seconds of speech — enough for a real explanation, still far
    # below anything that would feel like a lecture.
    VOICE_LLM_MAX_TOKENS: int = 320
    VOICE_LLM_MAX_TOKENS_CAP: int = 450

    # Generic OpenAI-compatible LLM (any provider: Mistral, OpenRouter, a
    # self-hosted server, ...). Set per-session from the token request's
    # metadata (never from this .env) when the caller picks a custom model —
    # see registry.py's "custom_openai" provider and worker.py's
    # _params_for_job. Left blank here; these are only ever per-job overrides.
    CUSTOM_LLM_BASE_URL: str = ""
    CUSTOM_LLM_API_KEY: str = ""

    # RAG-in-voice: when a call enables RAG, the worker fetches relevant
    # document chunks from the API server (reusing the same embeddings /
    # vector store as text chat) before each reply. These say where to reach
    # the API and how many chunks to pull.
    VOICE_BACKEND_URL: str = "http://localhost:8000"
    API_KEY: str = ""  # forwarded as X-API-Key when the retrieve route is protected
    # Forwarded as X-Internal-Key to /voice/retrieve and /voice/history. Those
    # accept a tenant_id directly, so they must be unreachable from the public
    # frontend proxy — which knows API_KEY but never this. Falls back to
    # API_KEY when unset, matching the API server's own default.
    INTERNAL_API_KEY: str = ""
    # Lower than text chat's top_k on purpose: chunks are ~512 words each, so
    # every extra chunk is real input-token cost. 3 (reranked, so still the
    # most relevant ones) is plenty for a spoken answer.
    VOICE_RAG_TOP_K: int = 3
    # Each injected excerpt is capped to this many words before being added
    # to the turn — a spoken answer never needs a whole 512-word chunk, and
    # the reranker already put the most relevant part first.
    VOICE_RAG_EXCERPT_MAX_WORDS: int = 220
    # Prior text-chat turns to seed a continuing voice call with. Capped so a
    # long-running text conversation doesn't get replayed in full into every
    # voice session's starting context — only recent turns are relevant to
    # pick the conversation back up.
    VOICE_HISTORY_MAX_MESSAGES: int = 8

    # ---- Latency / turn-taking tuning ---------------------------------
    # These make the agent feel like a real voice assistant: it responds
    # quickly after you stop, starts speaking sooner, and handles barge-in
    # cleanly. All are overridable via .env.

    # Pause (s) after you stop talking before the agent takes its turn. This
    # is dead air on EVERY turn, so it dominates perceived latency more than
    # any model choice. 0.35 sits just above natural inter-word pauses, which
    # is as low as it can go without the agent talking over a mid-sentence
    # breath. max_delay bounds the wait when the endpoint is ambiguous.
    VOICE_ENDPOINTING_MIN_DELAY: float = 0.35
    VOICE_ENDPOINTING_MAX_DELAY: float = 0.9
    # Start synthesizing audio before the turn is fully confirmed, so the
    # first sound comes back faster (framework runs the LLM early already;
    # this extends that to TTS).
    VOICE_PREEMPTIVE_TTS: bool = True
    # Require at least this many spoken words to count as an interruption,
    # so a cough / "uh" / background noise doesn't make the agent stop —
    # barge-in stays deliberate and smooth.
    VOICE_INTERRUPTION_MIN_WORDS: int = 1
    # Silero end-of-speech silence window (s). Lower detects your turn end
    # faster (framework default is 0.55).
    VOICE_VAD_MIN_SILENCE: float = 0.45
    # Greet the user out loud the moment the call connects, like a real
    # voice agent — avoids the awkward "is this working?" silence.
    VOICE_GREET_ON_CONNECT: bool = True
    VOICE_GREETING_TEXT: str = "Hello! How can I help you today?"

    # HTTP port livekit-agents' WorkerOptions serves its built-in health
    # check on (GET / -> 200 while the worker is registered and accepting
    # jobs). The API server's GET /voice/health proxies this so the frontend
    # can show "voice is offline" instead of a generic call-failed error.
    VOICE_WORKER_HEALTH_PORT: int = 8081

    # Agent identity / behavior
    VOICE_AGENT_NAME: str = "voice-assistant"
    VOICE_AGENT_INSTRUCTIONS: str = (
        "You are a helpful, friendly voice assistant — a general assistant, "
        "not tied to any documents. Keep responses concise and conversational "
        "— you're being spoken aloud, not read as text. Avoid markdown, "
        "bullet points, or anything that doesn't make sense spoken out loud. "
        "Always reply in the SAME language the user is speaking to you in. "
        "When the user interrupts or changes topic, follow their lead "
        "naturally using the full conversation so far."
    )

    class Config:
        env_file = ".env"
        case_sensitive = True
        # The worker's .env is shared with the API server's, which declares
        # many keys this class doesn't need (Qdrant, Redis, CORS, ...) —
        # ignore rather than reject them, unlike app.config.Settings which
        # owns that file and should stay strict.
        extra = "ignore"


voice_settings = VoiceSettings()


# Voices the installed Sarvam plugin (bulbul:v3) actually accepts — the token
# endpoint validates the caller's picked speaker against this so a bad value
# can never reach and crash the worker. Grouped for the UI's male/female
# picker; taglines are informational only.
SUPPORTED_TTS_VOICES: dict[str, list[dict[str, str]]] = {
    "male": [
        {"id": "shubh", "label": "Shubh", "tagline": "Confident & Bold"},
        {"id": "rahul", "label": "Rahul", "tagline": "Deep & Authoritative"},
        {"id": "amit", "label": "Amit", "tagline": "Steady & Trustworthy"},
        {"id": "kabir", "label": "Kabir", "tagline": "Rich & Cinematic"},
        {"id": "dev", "label": "Dev", "tagline": "Casual & Relatable"},
    ],
    "female": [
        {"id": "priya", "label": "Priya", "tagline": "Cheerful & Engaging"},
        {"id": "ishita", "label": "Ishita", "tagline": "Polished & Articulate"},
        {"id": "neha", "label": "Neha", "tagline": "Energetic & Warm"},
        {"id": "roopa", "label": "Roopa", "tagline": "Gentle & Soothing"},
        {"id": "shreya", "label": "Shreya", "tagline": "Bright & Warm"},
    ],
}

SUPPORTED_TTS_VOICE_IDS: set[str] = {
    v["id"] for group in SUPPORTED_TTS_VOICES.values() for v in group
}

SUPPORTED_TTS_VOICE_LABELS: dict[str, str] = {
    v["id"]: v["label"] for group in SUPPORTED_TTS_VOICES.values() for v in group
}

# The Sarvam REST TTS endpoint (non-streaming) — used directly by
# /voice/preview for a one-shot "hear this voice" sample. The worker itself
# talks to Sarvam over the streaming WebSocket API (see providers/sarvam_tts.py);
# this constant matches what livekit-plugins-sarvam uses internally so a
# preview sounds exactly like the real call.
SARVAM_TTS_BASE_URL = "https://api.sarvam.ai/text-to-speech"


# Languages the STT model (saaras:v3) supports, with "Auto-Detect"
# ("unknown") as the default. Offered as a picker so a user can force a
# specific language if auto-detect ever mishears them.
SUPPORTED_STT_LANGUAGES: list[dict[str, str]] = [
    {"id": "unknown", "label": "Auto-Detect"},
    {"id": "en-IN", "label": "English"},
    {"id": "hi-IN", "label": "Hindi"},
    {"id": "bn-IN", "label": "Bengali"},
    {"id": "ta-IN", "label": "Tamil"},
    {"id": "te-IN", "label": "Telugu"},
    {"id": "kn-IN", "label": "Kannada"},
    {"id": "ml-IN", "label": "Malayalam"},
    {"id": "mr-IN", "label": "Marathi"},
    {"id": "gu-IN", "label": "Gujarati"},
    {"id": "pa-IN", "label": "Punjabi"},
    {"id": "od-IN", "label": "Odia"},
]
SUPPORTED_STT_LANGUAGE_IDS: set[str] = {lang["id"] for lang in SUPPORTED_STT_LANGUAGES}


# ---- Personas (only offered when RAG is OFF) --------------------------------
# Each maps to the persona-specific part of the system prompt. "custom" is a
# placeholder — the caller supplies its text. Exposed to the UI via
# GET /voice/personas so the picker and this stay in sync.
PERSONAS: list[dict[str, str]] = [
    {"id": "assistant", "label": "Assistant",
     "tagline": "Helpful & professional",
     "prompt": "You are a helpful, professional AI assistant. Be clear, accurate, and to the point."},
    {"id": "motivational", "label": "Motivational",
     "tagline": "Energetic & uplifting",
     "prompt": "You are an energetic motivational coach. Be encouraging, positive, and inspiring; "
               "pump the user up and help them believe in themselves."},
    {"id": "casual", "label": "Casual",
     "tagline": "Relaxed & informal",
     "prompt": "You are a relaxed, casual conversational partner. Keep it easygoing and informal, "
               "like chatting with a buddy — light humor is welcome."},
    {"id": "friend", "label": "Friend",
     "tagline": "Warm & caring",
     "prompt": "You are a warm, caring close friend. Be supportive, empathetic, and personable; "
               "listen well and respond with genuine care."},
    {"id": "custom", "label": "Custom",
     "tagline": "Your own prompt",
     "prompt": ""},
]
PERSONA_PROMPTS: dict[str, str] = {p["id"]: p["prompt"] for p in PERSONAS}

# Appended to every persona / RAG prompt — the rules that make any agent work
# well *spoken* rather than read.
# Applied to every voice session regardless of persona or RAG mode. Agreement
# is the default failure mode of an assistant: it is the cheapest thing a model
# can do and it feels pleasant, which is exactly why it goes unnoticed. A
# product people are meant to rely on has to be willing to say "that's wrong".
_HONESTY = (
    "\n\nBEING GENUINELY USEFUL\n"
    "Your job is to be right and useful, not agreeable. Agreement that isn't "
    "earned makes you useless — the user cannot tell your praise from your "
    "assessment, so both become worthless.\n"
    "- If the user states something incorrect, say so plainly and give the "
    "correct version. Do not soften it into meaninglessness, and do not bury "
    "it after a compliment.\n"
    "- If their plan or assumption has a real problem, name the problem and "
    "say what you'd do instead. Lead with the disagreement, not with "
    "validation.\n"
    "- If they push back and they're right, change your mind and say so. If "
    "they push back and they're still wrong, hold your position and explain "
    "why. Repetition and confidence are not arguments.\n"
    "- Never open with flattery ('great question', 'good catch', 'excellent "
    "point'). Answer instead.\n"
    "- Distinguish what you know from what you're inferring, and say which is "
    "which. 'I'm not sure' beats a confident invention every time.\n"
    "- When something genuinely is a good idea, say so briefly and move on. "
    "Praise means something only when it's rare."
)

_VOICE_STYLE = (
    "\n\nHOW TO SPEAK\n"
    "You are heard, not read. That changes the shape of a good answer, not its "
    "substance.\n"
    "- Lead with the answer. Never open with a preamble, a restatement of the "
    "question, or 'That's a great question'.\n"
    "- Length follows the question. A factual lookup deserves one or two "
    "sentences; a 'how does this work' or 'compare these' question deserves "
    "three to six. Never pad, and never truncate a real answer to seem brisk.\n"
    "- When something has multiple parts, speak them as a sequence a listener "
    "can follow — 'First… then… the last thing is…' — never as markdown, "
    "bullets, numbered lists, or headings. Those are meaningless aloud.\n"
    "- Say numbers, dates, and units the way a person would read them out: "
    "'about twelve percent', 'the third of March', 'two point five megabytes'.\n"
    "- Skip anything unpronounceable: no asterisks, no URLs read character by "
    "character, no file paths, no bracketed citation markers.\n"
    "- Speak plainly and warmly, like a capable colleague. No verbal tics, no "
    "filler sounds, no forced enthusiasm.\n"
    "- Be honest and specific about uncertainty. 'The document doesn't say' is "
    "a better answer than a confident guess.\n"
    "- Always reply in the same language the user speaks to you in.\n"
    "- If the user interrupts, stop and follow their lead using the whole "
    "conversation so far. Never restart an answer they cut off."
)

_RAG_PROMPT = (
    "You are Scribe, a research assistant who answers from the user's own "
    "documents in a spoken conversation.\n\n"
    "WORKING WITH EXCERPTS\n"
    "- Some turns attach 'Relevant excerpts' above the user's message. They "
    "were retrieved by similarity and are NOT guaranteed to be relevant.\n"
    "- Read them before answering. Use what genuinely answers the question and "
    "ignore the rest — never summarise an excerpt just because it was "
    "provided.\n"
    "- Synthesise across excerpts rather than reciting one. If two of them "
    "disagree, say so; that contradiction is usually the useful part.\n"
    "- Attribute naturally, the way a person would: 'your onboarding doc says…' "
    "or 'according to the Q3 report…'. Never read citation markers aloud.\n"
    "- Only say the documents don't cover something when the question actually "
    "needed them and nothing relevant came back. Do not fall back on general "
    "knowledge and present it as if it came from their files — if you step "
    "outside their documents, say that you are.\n"
    "- No excerpts attached means no lookup was needed: small talk, a "
    "follow-up, or an acknowledgement. Just respond naturally, and never "
    "re-explain something the user didn't ask about again.\n"
    "- If the user signals they're done with a topic, acknowledge it briefly "
    "and move on."
)


def build_instructions(
    *,
    rag_enabled: bool,
    persona: str | None = None,
    custom_prompt: str | None = None,
    gender: str = "female",
) -> str:
    """Resolve the final system prompt for a voice session.

    RAG on  -> a document-grounded assistant (persona is ignored, by design).
    RAG off -> the chosen persona, or a caller-supplied custom prompt.
    """
    if persona == "custom" and custom_prompt and custom_prompt.strip():
        # Keep custom prompt completely custom as requested: "until custom section give by user"
        base = custom_prompt.strip()
    else:
        # For default personas and RAG grounded assistant, enforce the name Scribe, human tone, filler words, and gender inflections
        if rag_enabled:
            base = _RAG_PROMPT
        else:
            base = PERSONA_PROMPTS.get(persona or "assistant") or PERSONA_PROMPTS["assistant"]

        # Filler sounds ("um", "uh") used to be requested here to seem human.
        # They read as hesitant and unpolished in a product people are meant to
        # trust, and they cost real TTS latency for no information — so warmth
        # now comes from phrasing instead.
        base += (
            f" Your name is Scribe. You are speaking with a {gender} voice: keep "
            f"pronouns, inflections, and verb conjugations consistent with that "
            f"throughout, which matters especially in gender-marked languages "
            f"such as Hindi (e.g. 'करती हूँ' when female, 'करता हूँ' when male)."
        )

    # _HONESTY applies even to a custom prompt: a caller can change the
    # assistant's character, but not license it to mislead the person using it.
    return base + _HONESTY + _VOICE_STYLE
