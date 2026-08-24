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

from app.services import prompt_rules


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
    MISTRAL_API_KEY: str = ""
    VOICE_LLM_MODEL: str = "openai/gpt-oss-20b"
    # Deliberately lower than text chat's rag_pipeline.py default (800): a
    # spoken answer needs to stay short to be listenable (800 tokens is
    # roughly a minute of TTS) and short is also cheap. The Settings panel's
    # temperature/max tokens sliders can still override this per-session via
    # the token request, but worker.py clamps it to VOICE_LLM_MAX_TOKENS_CAP
    # so a chat-sized value never gets sent straight to a voice reply.
    # Kept low, deliberately. Raising this is the obvious way to stop an agent
    # sounding repetitive and it is the wrong one: sampling temperature is also
    # what governs how tightly the model holds to its instructions, and the
    # failures on this stack have been instruction failures — scripting both
    # sides of the call, answering on the caller's behalf, ignoring the
    # one-question rule. Trading script adherence for variety would buy a
    # livelier agent that takes orders wrongly.
    #
    # Variation belongs where it cannot cost correctness: in the delivery
    # (VOICE_TTS_TEMPERATURE, which varies the voice and not the words) and in
    # the filler phrases, which are chosen in code from a fixed list the model
    # never sees.
    VOICE_LLM_TEMPERATURE: float = 0.3
    # ~320 tokens is roughly 25 seconds of speech. That is the ceiling for a
    # reply that ran long, not the target — the delivery rules ask for one to
    # three sentences, and a turn that hits this number has already ignored
    # them.
    VOICE_LLM_MAX_TOKENS: int = 320
    # The hard ceiling on whatever the caller or the owner asked for. Chat's
    # slider goes to 4000; a spoken reply that long is unlistenable and
    # expensive, so it is clamped rather than trusted.
    #
    # Two ceilings, because the owner's delivery-rules toggle decides who is
    # responsible for length. With the rules on we asked for one to three
    # sentences, so the backstop sits close to that — a cap only does work once
    # the prompt has already failed, and the models fast enough for voice are
    # exactly the ones that ignore a length instruction. ~200 tokens is about
    # fifteen seconds, already a long conversational turn.
    #
    # With the rules off the owner has taken length into their own prompt, and
    # clamping them to our number would make the toggle a lie. They still get a
    # ceiling — this is a phone call — just a far looser one.
    VOICE_LLM_STYLED_MAX_TOKENS_CAP: int = 200
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

    # ---- Call cost ceilings -------------------------------------------------
    # A call runs on the owner's provider keys, so an unbounded one is an
    # unbounded bill. Both are 0-to-disable, and both are overridden per session
    # from the token endpoint — a caller who arrived from the public directory
    # gets far tighter values than someone the owner sent a link to.
    #
    # Hard ceiling on wall-clock call length.
    # ---- Sounding human ----------------------------------------------------
    # SECONDS the model may think before the agent makes a noise. Below the
    # point where silence reads as a dropped call, above the point where a fast
    # reply would be preceded by a pointless "okay". 0 disables it.
    VOICE_THINKING_FILLER_DELAY: float = 0.7

    # Sarvam speech shaping. pace 1.0 is the model's default rate; a touch under
    # reads as considered rather than hurried, and gives a listener room to
    # follow an unfamiliar accent. temperature varies the delivery between
    # utterances, so the same sentence twice does not sound like a recording.
    VOICE_TTS_PACE: float = 0.95
    VOICE_TTS_TEMPERATURE: float = 0.6

    VOICE_MAX_CALL_SECONDS: int = 0
    # Ends a call after this much silence with nobody speaking. This is the one
    # that catches a line left open: a caller who connects and walks away costs
    # exactly as much as one who is talking, and never hangs up. The watcher
    # asks "are you there?" at this mark and ends 10s later if still nothing.
    VOICE_IDLE_TIMEOUT_SECONDS: int = 15

    # ---- Latency / turn-taking tuning ---------------------------------
    # These make the agent feel like a real voice assistant: it responds
    # quickly after you stop, starts speaking sooner, and handles barge-in
    # cleanly. All are overridable via .env.

    # Pause (s) after you stop talking before the agent takes its turn. This
    # is dead air on EVERY turn, so it dominates perceived latency more than
    # any model choice. 0.35 sits just above natural inter-word pauses, which
    # is as low as it can go without the agent talking over a mid-sentence
    # breath. max_delay bounds the wait when the endpoint is ambiguous.
    # Silence (s) after you stop before the agent takes its turn.
    #
    # 0.35 was tuned purely for snappiness and it was below the length of an
    # ordinary mid-sentence pause — the gap while someone thinks of the next
    # word. The result was one sentence arriving as two turns, with the agent
    # answering the first half ("मतलब सर में दर्द है।" → reply → "तो क्या कोई
    # फिजियोलॉजिस्ट है?" → second reply). Splitting a turn is far more damaging
    # than waiting an extra fifth of a second: the caller has to repeat
    # themselves and the agent has already committed to answering a fragment.
    VOICE_ENDPOINTING_MIN_DELAY: float = 0.4
    # The hard stop for an *ambiguous* ending — when the framework isn't sure
    # you're finished, this is how long it waits before taking the turn anyway.
    #
    # 0.9 was the bigger of the two bugs. A pause that reads as ambiguous (very
    # common when switching languages mid-sentence, or reciting a phone number
    # in groups) got force-ended at 0.9s no matter what. The framework's own
    # default is 3.0; 2.0 keeps most of that safety without letting a genuinely
    # finished turn hang.
    VOICE_ENDPOINTING_MAX_DELAY: float = 2.0
    # "dynamic" adapts the wait to the caller's own speaking rhythm rather than
    # applying one fixed number to everyone. Free — no model, no extra process.
    # "fixed" restores the previous single-value behaviour.
    VOICE_ENDPOINTING_MODE: str = "dynamic"

    # Use a local semantic end-of-turn model to decide whether the caller
    # finished a *thought*, rather than inferring it from silence alone. This
    # is the correct fix for one sentence arriving as two turns, and no timer
    # value substitutes for it.
    #
    # OFF, and the reason is memory rather than quality. Measured on this
    # project: the model runs in its own inference process at a 2.26 GB
    # resident baseline with no call in progress, and ~31s to initialise. That
    # does not fit a free hosting tier, which is what this product deploys to.
    #
    # It is deliberately left switched off in development too, rather than
    # enabled locally and disabled in production. Tuning turn-taking against
    # behaviour the deployed system will never have produces numbers that are
    # wrong for the thing users actually call.
    #
    # To enable (needs ~4 GB): pip install livekit-plugins-turn-detector,
    # run `python -m app.services.voice.worker download-files`, set this true,
    # and drop VOICE_ENDPOINTING_MAX_DELAY to ~1.2 — the slack above exists
    # purely to avoid guillotining an ambiguous pause, which the model would
    # instead classify.
    VOICE_SEMANTIC_TURN_DETECTION: bool = False
    # Start synthesising audio before the turn is confirmed. OFF: the
    # framework retries a preemptive generation as the transcript changes, and
    # once TTS is running a superseded attempt can reach the speaker — heard as
    # the agent giving two different answers to one question. The LLM still
    # runs preemptively (see session_factory), which is the bulk of the win
    # without the risk. Turn on only if you need the last ~200ms more than you
    # need the agent to answer once.
    VOICE_PREEMPTIVE_TTS: bool = False

    # How overlapping speech is judged.
    #
    #   "vad"      — Silero hears speech, the agent stops. Local, instant, and
    #                the only option that works without extra services.
    #   "adaptive" — classifies the overlapping speech before deciding. Reads
    #                better on paper, but it is backed by a HOSTED LiveKit
    #                inference service (AdaptiveInterruptionDetector takes
    #                base_url/api_key/api_secret). Without those credentials
    #                there is no detector to consult and interruptions never
    #                fire at all — the agent talks until its TTS drains, no
    #                matter how loudly you talk over it. Do not enable this
    #                without configuring the service.
    #
    # The bug that made barge-in feel broken was never the mode. It was
    # min_duration below, at 0.2s — shorter than a breath, so a cough or an
    # "okay" stopped the agent and the false-interruption resume then replayed
    # the sentence from the start. Fixing the threshold fixes that while
    # keeping barge-in instant.
    VOICE_INTERRUPTION_MODE: str = "vad"
    # Minimum words before overlapping speech counts as an interruption.
    # Consulted in STT-driven modes only — "vad" cuts on audio, not words — so
    # this is 0 to make it explicit that nothing here waits for a transcript.
    VOICE_INTERRUPTION_MIN_WORDS: int = 0
    # How long you must be speaking before the agent stops. This is the real
    # barge-in knob — with mode="vad" it is measured on audio, so nothing waits
    # for a transcript and the cut lands as soon as this elapses.
    #
    # 0.25 is about one syllable: effectively "stop the moment I start". This
    # was 0.2 originally and caused false cuts on coughs and breaths, so the
    # obvious read is that we are walking back into that bug. Two things
    # changed since:
    #
    #   - The browser now explicitly requests echoCancellation. Before, the
    #     agent's own voice came out the speaker and back in the mic, and the
    #     loudest source of "random" interruptions was the agent interrupting
    #     itself. That is gone, which is most of why 0.2 misbehaved.
    #   - preemptive_tts is off, so a cut can no longer collide with a
    #     half-spoken preemptive generation.
    #
    # If background noise still cuts the agent off mid-sentence, this is the
    # number to raise — 0.4 is a good next step. Note the interaction with
    # VOICE_RESUME_FALSE_INTERRUPTION below: a false cut is cheap to recover
    # from only because the agent resumes.
    #
    # Raised to 0.4 after exactly that happened on a live call: the agent was
    # cut mid-question repeatedly, and each false cut produced a noise-only user
    # turn that the model answered by asking again — six re-phrasings of the
    # same question in one 14.8s turn. The empty-turn guard in agent.py is the
    # real fix for the repetition; this reduces how often the cut happens at
    # all. 0.4 is still well inside "stop the moment I start" for real speech,
    # and above the length of a breath or a single-syllable room noise.
    VOICE_INTERRUPTION_MIN_DURATION: float = 0.4
    # After an interruption turns out to be false — you were cut off by a noise
    # and then said nothing for ~2s — resume what was being said.
    #
    # Kept ON, and it is the safety net that makes the aggressive
    # min_duration above affordable. Without it a false cut leaves the agent
    # silent mid-sentence with no user turn to answer, and the call just sits
    # there dead until someone speaks. Resuming is the lesser fault: worst
    # case you hear part of a sentence twice, rather than the assistant
    # appearing to hang up on you.
    VOICE_RESUME_FALSE_INTERRUPTION: bool = True
    # Silero end-of-speech silence window (s) — how long Silero must hear
    # nothing before it reports that speech ended. This is the floor under
    # VOICE_ENDPOINTING_MIN_DELAY: no endpointing decision can happen sooner
    # than Silero reports silence, so setting the two independently is how you
    # end up with a min_delay that never actually applies. Tracks min_delay.
    VOICE_VAD_MIN_SILENCE: float = 0.4
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
    "\n\nGENUINE & ACCURATE ASSISTANCE\n"
    "Your job is to be right and useful, not agreeable. Agreement that isn't "
    "earned makes you useless — the user cannot tell your praise from your "
    "assessment, so both become worthless.\n"
    "- Be helpful, clear, warm, and accurate.\n"
    "- If the user says something incorrect, say so plainly and give the "
    "correct version. Don't soften it into meaninglessness, and don't bury it "
    "after a compliment.\n"
    "- If their plan or assumption has a real problem, name the problem and "
    "say what you'd do instead. Lead with that, not with validation.\n"
    "- If they push back and they're right, change your mind and say so. If "
    "they push back and they're still wrong, hold your position and explain "
    "why. Repetition and confidence are not arguments.\n"
    "- Never open with flattery ('great question', 'good catch'). Answer "
    "instead.\n"
    "- Always reply in the same language the user is speaking to you in.\n"
    "- Never use markdown, bullet points, or headings — they are meaningless "
    "spoken aloud.\n"
    "- If you are unsure of an answer, state it clearly rather than guessing.\n"
    "- Distinguish facts from inferences naturally in conversation."
)

# Delivery rules come from the shared module rather than a voice-local copy.
# This used to be a fifty-line block with worked dialogue examples, a
# verbal-nods section ("Mmhmm", "Gotcha") and a numbered structure. It was
# replaced because length itself was the problem: personal-mode voice runs on
# the same fast models as business mode, and their instruction-following falls
# off as the prompt grows, so the long version bought fewer rules followed
# rather than more. The verbal nods in particular produced exactly the padding
# these rules exist to remove.
_VOICE_STYLE = prompt_rules.VOICE_DELIVERY

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
