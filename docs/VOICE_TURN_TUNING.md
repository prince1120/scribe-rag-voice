# Sarvam turn-taking and first-audio tuning

2026-10-06. Providers remain Sarvam STT (`saaras:v3`), LLM
(`sarvam-105b-conversations`) and TTS (`bulbul:v3`). No provider migration.

## Research applied to this stack

| Official source | Production pattern | Application here |
|---|---|---|
| [LiveKit](https://docs.livekit.io/agents/logic/turns/tuning/) | Separate activity, endpointing, interruptions and preemptive generation; discard speculative replies on resumed speech | Preserve existing SDK preemptive LLM and interruption handling; don't treat STT final as permission to play audio |
| [Vapi](https://docs.vapi.ai/customization/voice-pipeline-configuration) | Number, punctuation and no-punctuation rules; semantic models are a separate option | Number-tail waits; distinguish weak punctuation, ellipses and strong endings; incomplete words take priority |
| [Pipecat Smart Turn](https://github.com/pipecat-ai/smart-turn) | Audio-native semantic detection on silence; documented 8 MB quantized model and ~10–100 ms inference depending on hardware | Potential next step for prosody/breath detection; no extra model or dependency installed in this change |
| [Retell](https://docs.retellai.com/reliability/troubleshoot-latency) | Measure ASR/LLM/TTS per call; lowering ASR endpointing trades completeness for speed | Benchmark provider silence settings independently; retain a conservative rollback |
| [OpenAI](https://developers.openai.com/api/docs/guides/realtime-vad) | Semantic VAD adjusts waiting to perceived completion | Research reference only; Sarvam configuration cannot use OpenAI's semantic VAD |
| [Deepgram](https://developers.deepgram.com/docs/flux/voice-agent-eager-eot) | Eager preparation, resume cancellation, confirmed turn before playback | Research reference only; no Flux/Deepgram provider or events added |
| [ElevenLabs](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow) | Configurable eagerness; start TTS after enough words and a comma | Flush existing natural clauses instead of waiting for another provider sentence buffer |

[Sarvam's streaming guide](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/streaming-api)
documents 32 ms VAD frames at 16 kHz, separate speech-end events and transcripts,
and fine silence-frame options. The installed SDK reads `data.transcript` and
maps it into speech events. Sarvam's formatted transcription is not a semantic
end-of-turn guarantee. Our synthetic question returned strong punctuation in
all six samples of the punctuation-validation run; this does not guarantee
question marks, commas or accurate punctuation for real microphone speech.
Default transcribe mode may normalize fillers; this remains unchanged.

## Actual recent speech baseline

Latest six unique completed reply turns (not duplicate log entries):

| Metric | p50 | Observed range |
|---|---:|---:|
| Speech end to final transcript | 842 ms | 747–866 ms |
| LLM TTFT | 175 ms | 167–426 ms |
| First token to first audio frame | 492 ms | 442–590 ms |
| Speech end to server audio publication | 1,763 ms | 1,736–1,960 ms |

Endpointing overlaps STT, and generation can overlap turn confirmation. Don't
sum stage percentiles. Browser playback comes later than server publication.

## Measurements before enabling flags

All provider benchmarks use synthetic content; PCM remains in memory and no
transcripts/audio/keys are printed. Each comparison has only three samples.

| Experiment | p50 before → after | p95/p99 before → after | Observation |
|---|---|---|---|
| High sensitivity preset | 756 → 213 ms | 768 → 1,220 ms | Extra final segment; rejected for local default |
| Moderate 8-frame window, first run | 790 → 453 ms | 791 → 900 ms | No extra segment; all fixture words preserved |
| Moderate 8-frame window, punctuation validation | 785 → 410 ms | 1,001 → 931 ms | No extra segment; all fixture words preserved; strong terminal punctuation |
| Explicit clause flush, buffer 50 | 933 → 439 ms | 975 → 806 ms | ~495 ms p50 improvement on deliberately delayed second clause |

Moderate STT savings are ~337–375 ms in these small comparisons. TTS fixture
includes a deliberate 500 ms gap before its second clause, so its savings are
specific to buffering; don't claim all answers gain 495 ms. Provider variability
is substantial. No new end-of-speech-to-speaker before/after SLO is proven.

## Implemented rules and configuration

All new code defaults are off. Local root/backend `.env` can enable:

```dotenv
VOICE_STT_SILENCE_FRAMES=8
VOICE_STT_HIGH_VAD_SENSITIVITY=false
VOICE_SMART_TURN_HINTS=true
VOICE_TTS_FLUSH_CLAUSES=true
```

- Eight frames = 256 ms provider silence at 16 kHz; counts/window both set to 8.
  `0` restores provider defaults. High sensitivity remains off.
- Strong `.?!।`: 180–360 ms endpointing only on final transcripts after checking
  incomplete phrases and numeric tails. VAD still gates silence.
- Weak `,;:—–`: 500–750 ms; ellipses/thinking/incomplete endings: 650–1,000 ms.
- Numbers at the tail: 500–750 ms to avoid responding midway through a phone
  number or date. Unpunctuated speech retains configured dynamic delays.
- Hindi text retains combining marks; ASCII word regexes must not break words.
- `turn_hint` logs contain only opaque IDs, final status, punctuation class and
  delays. These rules are lightweight heuristics, not a semantic detector and
  not a guarantee against all breath/thinking-pause mistakes.
- Existing LLM settings, instructions, facts, tools, TTS voice/pace, local VAD,
  adaptive interruption/resume and hedging-off behavior remain intact.

Flags take effect in a fresh worker/session. Local watcher reloads source edits;
an env-only edit requires worker restart. Docker worker needs recreation with
updated environment. Roll back with silence frames `0`, hints `false` and
clause flush `false` if real call accuracy/prosody regresses.

## Ranked remaining work

1. Validate these flags using complete questions, breath pauses, "because...",
   phone numbers and Hinglish. Compare actual client first-audio and cutoff rate.
2. Profile Sarvam TTS first-frame variability and codec buffering if real calls
   remain above 1.5 seconds. Preserve natural clause boundaries.
3. A real audio semantic detector can improve subtle prosody/meaning cases.
   Pipecat's small model supports Hindi, but integrating it into LiveKit needs
   separate profiling, bounded audio buffering and pause tests; not installed.

Under-1.5-second playback remains a target. Deliberately incomplete thoughts
should wait longer; forcing all such pauses under a fixed SLO would cut users off.
