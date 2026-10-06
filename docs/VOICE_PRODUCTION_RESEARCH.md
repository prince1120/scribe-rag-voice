# Voice production research and approval plan

Date: 2026-10-06. Scope now authorized: research and measurement (Steps 1–2).
Steps 3–5 require user approval. No deployment, new infrastructure, new paid
service, alternate model selection, network impairment or load test authorized
by this plan. Earlier opt-in transport and TTS work is preserved.

## Confirmed stack

- Python FastAPI API; separate LiveKit Agents 1.6.6 worker; Next.js browser client.
- Browser microphone → LiveKit WebRTC media → worker. Signalling uses WebSocket;
  it is distinct from the audio transport. Actual selected ICE transport is not
  verified; WebRTC may fall back to TCP.
- STT: LiveKit Sarvam SDK, `saaras:v3` default, persistent WebSocket, 16 kHz PCM
  input. Per-agent overrides remain supported.
- Speech/turn detection: prewarmed local Silero VAD (240 ms minimum silence),
  dynamic endpointing (240–550 ms), punctuation path (180–360 ms), conjunction
  path (550–750 ms). Semantic detector is disabled by default.
- LLM: default `sarvam-105b-conversations`, direct Sarvam `/v1/chat/completions`,
  OpenAI-compatible SDK over HTTP streaming/SSE. Explicit `reasoning_effort=null`;
  default output cap 220 tokens. Custom OpenAI-compatible endpoints remain supported.
- LiveKit preemptive LLM generation is already enabled on final transcripts
  before endpointing confirmation. It is not arbitrary interim-transcript speculation.
- TTS: LiveKit Sarvam SDK, `bulbul:v3`, persistent pooled WebSocket with idle pings;
  clause cleaning/chunking before synthesis. Installed plugin defaults to 22,050 Hz
  and MP3 provider audio, then decodes into frames. This differs from its API's
  possible PCM/24 kHz modes. No codec/sample-rate change made.
- Worker audio → LiveKit room track → browser audio element. Client already uses
  mono speech Opus preset, DTX and RED, plus echo/noise/gain processing.
- Deployment confirmed by user: local Docker. Checked-in compose uses local
  LiveKit with `node_ip: 127.0.0.1` and loopback-exposed ports. No TURN configured
  in that file. Live testing confirmed Docker infrastructure (LiveKit, Postgres,
  Redis, Qdrant) with the native API/worker: a hybrid deployment. The per-user
  Docker CLI was located and used. Host/provider geographic region remains unknown.

Relevant source: `session_factory.py`, `providers/`, `agent.py`, `worker.py`,
`frontend/app/components/voice/useCallQuality.ts`, `docker-compose.yml`,
`infra/livekit/livekit.yaml`.

## What the seven platforms do, and what to reuse

| Platform | Documented approach | Apply to Scribe |
|---|---|---|
| LiveKit Agents | Endpointing, interruption classification, preemptive generation, stage metrics, provider adapters and process-based job admission | Keep the framework; measure its existing features before adding another orchestration layer |
| Pipecat | Pluggable streaming pipeline; WebRTC for browser audio, WebSockets for controlled server links | Retain browser WebRTC and provider WebSockets; no migration needed |
| Vapi | Separate start/stop speaking plans, smart endpointing and configurable interruption gates | Tune silence waits independently from noise/backchannel gates |
| Retell | Per-call ASR/LLM/TTS and end-to-end latency; spoken prompting and first-sentence optimization | Track the first speakable unit, not just the first token |
| Deepgram Voice Agent/Flux | Streaming transcript and turn events; optional eager end-of-turn, cancelled by turn-resumed | Validate equivalent Sarvam signals before speculating on interim text |
| OpenAI Realtime | WebRTC/WebSocket/SIP; VAD/semantic VAD; cancellation and removal of unplayed audio from context | Audit playback-aware history and cancellation in LiveKit; adoption is not required |
| ElevenLabs Agents | Turn eagerness, soft timeout speech, interruption controls, heartbeat and percentile analytics | Bounded filler for slow work; explicit health and percentile telemetry |

Sources: [LiveKit tuning](https://docs.livekit.io/agents/logic/turns/tuning/),
[Pipecat transports](https://docs.pipecat.ai/client/concepts/choosing-a-transport),
[Vapi timing](https://docs.vapi.ai/customization/voice-pipeline-configuration),
[Retell latency](https://docs.retellai.com/reliability/troubleshoot-latency),
[Deepgram eager turns](https://developers.deepgram.com/docs/flux/voice-agent-eager-eot),
[OpenAI conversations](https://developers.openai.com/api/docs/guides/realtime-conversations),
[ElevenLabs flow](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow).

## Research by topic

1. **Transport.** WebRTC/RTP over UDP can play recent audio without waiting for
   TCP retransmission of old packets. It includes timestamping, jitter handling,
   congestion control and ICE recovery. WebSocket/TCP remains appropriate for
   provider connections; SIP integrates telephone networks with their codec and
   carrier constraints. UDP must actually be reachable; WebRTC over TURN/TCP loses
   some of this advantage. Keep our current transport and inspect selected ICE
   pairs before changing infrastructure.
   [Pipecat](https://docs.pipecat.ai/client/concepts/choosing-a-transport),
   [LiveKit connectivity](https://docs.livekit.io/oss/test-monitor/).

2. **Audio.** Opus supports variable bitrate, packet loss concealment, in-band
   FEC and DTX. RED is additional packet redundancy, not synonymous with Opus FEC.
   A 20 ms frame is a starting point, not a mandatory value for every provider
   buffer. Opus RTP uses a 48 kHz clock even when STT/TTS use 16/24 kHz PCM.
   Let the browser adapt its jitter buffer; forcing it too small can worsen
   dropouts. Verify negotiated FEC/packetization and inbound loss/concealment stats.
   `adaptiveStream`/`dynacast` are primarily video features and do not prove audio
   bitrate adaptation. Preserve our existing DTX/RED speech preset.
   [Opus RTP standard](https://www.rfc-editor.org/info/rfc7587/),
   [LiveKit publication options](https://docs.livekit.io/reference/client-sdk-js/interfaces/TrackPublishDefaults.html).

3. **VAD/turn detection.** Acoustic VAD finds speech, not completed meaning.
   Semantic detectors can protect pauses and trailing “um,” with an inference
   cost. Vapi separates speaking waits from interruption sensitivity; LiveKit
   supports adaptive interruption classification and speculative generation.
   Test our punctuation heuristic, “um,” incomplete clauses and noisy speech
   before reducing timers. Do not indiscriminately discard “yes/no/haan.”
   [Vapi](https://docs.vapi.ai/customization/voice-pipeline-configuration),
   [LiveKit](https://docs.livekit.io/agents/logic/turns/tuning/),
   [OpenAI VAD](https://developers.openai.com/api/docs/guides/realtime-vad).

4. **Streaming STT.** Interim text can change; segment-final text and a complete
   user turn are different signals. Deepgram Flux has eager/final/resumed events
   for cancelling preparation without prematurely speaking. A provider's claimed
   final latency is not our measured end-to-final latency. Sarvam is already
   streaming; measure its final transcript and chunk cadence before changing it.
   Current Sarvam documentation also describes a realtime STT variant, but
   switching model/API is outside this step and requires SDK compatibility checks.
   [Deepgram](https://developers.deepgram.com/docs/flux/voice-agent-eager-eot),
   [Sarvam production guide](https://docs.sarvam.ai/api/integration/pipecat-production-guide).

5. **LLM.** Streaming, small spoken completions, concise tool definitions and
   a stable prompt prefix are established latency practices. Prompt caching
   depends on provider cache support/hits; there is no universal cache flag.
   Our static prefix, short delivery rules, token cap and disabled reasoning
   already exist. Keep the selected conversational Sarvam model. Preserve owner
   facts and tool safety when considering shorter prompts. Speculation must not
   execute tools or play speech until committed. Future fallback must retain
   matching endpoint/key ownership.
   [Retell custom LLM practices](https://docs.retellai.com/integrate-llm/llm-best-practice),
   [Sarvam v1](https://docs.sarvam.ai/api-reference/chat/chat-completions-v1),
   [Groq latency guidance](https://console.groq.com/docs/production-readiness/optimizing-latency).

6. **TTS.** Persistent WebSockets and early sentence/clause delivery overlap
   synthesis with generation. Extra client/server sentence buffers can defeat
   an upstream clause chunker. Sarvam's guide flags this pattern; our installed
   plugin adds its own sentence tokenizer and 50-character provider buffer.
   Its supported local minimum is 30 characters, so the guide's Pipecat-specific
   20-character setting cannot be copied unchanged. Earlier opt-in explicit
   clause flush is retained, disabled and awaiting live validation. Fixed greeting
   or filler audio can avoid synthesis latency, but caching must include voice,
   language, format and expiry; never cache variable personal/business replies
   across tenants.
   [Sarvam streaming](https://docs.sarvam.ai/api-reference/text-to-speech/stream),
   [Sarvam guide](https://docs.sarvam.ai/api/integration/pipecat-production-guide).

7. **Interruptions.** Stop queued playback, cancel generation/synthesis and
   retain only spoken history. OpenAI Realtime manages unplayed-context truncation
   for its WebRTC/SIP connections; WebSocket clients need playback bookkeeping.
   Our SDK already handles interruptions and forwarded-text history, but browser
   pause/resume signals and any replay after false interruption need real testing.
   Local cancellation does not prove provider-side cancellation or billing stops.
   Installed httpcore closes/releases an H2 response without sending RST_STREAM;
   user explicitly chose to keep hedging disabled pending validation.
   [OpenAI interruptions](https://developers.openai.com/api/docs/guides/realtime-conversations),
   [Deepgram interruption reporting](https://developers.deepgram.com/docs/flux-tts/interrupt-handling).

8. **Network/regions.** HTTP/2 multiplexes LLM requests and shares setup; both
   peers must negotiate it. HTTP/3 reduces cross-stream TCP head-of-line blocking,
   but requires endpoint and client support and does not remove model queue time
   or RTT. HTTPX here offers H1/H2, not H3. Sarvam H2 was verified with ALPN `h2`.
   The existing SDK already keeps an HTTP client alive per session. Optional
   prewarm has not demonstrated a general latency improvement. Our local Docker
   stack has no known cloud region, and API hostname/IP does not establish Sarvam's
   inference location. Measure candidate regional RTT/TTFT before any move;
   public UDP/TURN/TLS configuration is a separate deployment approval.
   [HTTPX](https://www.python-httpx.org/http2/),
   [HTTP/3 standard](https://www.rfc-editor.org/rfc/rfc9114.pdf),
   [LiveKit deployment](https://docs.livekit.io/oss/test-monitor/).

9. **Reliability.** LiveKit provides provider fallback adapters with unhealthy
   provider tracking/recovery; it avoids swapping after audible TTS or emitted
   LLM output by default. Use explicit first-token deadlines, cooldowns and
   bounded retries; honor 429 backoff without retry storms. STT failover needs
   bounded audio replay and transcript deduplication. Circuit breakers cannot be
   a timer-only wrapper that forgets whether output/tools already happened.
   Implement and fault-test this only after approval.
   [LiveKit fallbacks](https://docs.livekit.io/agents/logic/fallback-strategies/),
   [Deepgram connection warnings](https://developers.deepgram.com/docs/voice-agent-errors-warnings).

10. **Observability.** Separate stage timings and request/call/turn correlation
    from content; show counts and missing values with percentiles. Retell and
    ElevenLabs expose percentile views, and LiveKit exposes conversation/provider
    metrics. Our default RoomAudioOutput reports track publication, not browser
    speaker playback. Do not relabel it. Future browser playback and
    interruption-to-silence probes must use one monotonic clock, account for
    buffering and distinguish filler from actual replies. Existing raw-content
    debug/log sites still need a privacy-hardening audit; the new timing records
    contain no transcript/audio/header/body/URL/key content.
    [LiveKit metrics](https://docs.livekit.io/testing/observability/data/),
    [Retell actual latency](https://docs.retellai.com/reliability/check-actual-latency),
    [ElevenLabs analytics](https://elevenlabs.io/docs/eleven-agents/dashboard).

11. **Scaling.** LiveKit supports load-based admission, prewarmed job processes,
    per-job memory ceilings and graceful draining. Production/start mode differs
    from development mode. SDK or SFU benchmark capacity is not this application's
    provider/tool/RAG capacity. Measure worker CPU, RSS, event-loop lag and provider
    concurrency while generating real media; increase N until latency/error SLOs
    fail, then retain headroom. Docker stop grace must allow configured drain;
    readiness must stop admitting jobs during drain. No capacity number is claimed.
    [LiveKit self-hosted agents](https://docs.livekit.io/deploy/custom/deployments/),
    [startup modes](https://docs.livekit.io/agents/server/startup-modes/),
    [job shutdown](https://docs.livekit.io/agents/server/job/).

## Ranked plan and approval boundary

Expected gains below are hypotheses, not measured savings.

| Rank | Change | Expected value | Effort/risk | Status |
|---|---|---|---|---|
| 1 | Correct stage correlation, budget, percentile summary and playback measurement contract | Enables trustworthy SLO diagnosis | Low; diagnostics only | Current Steps 1–2 |
| 2 | Validate explicit early TTS flush and remove duplicate buffering | Avoids waiting for later clauses; potentially hundreds of ms | Moderate; prosody/segmentation regression risk | Earlier opt-in retained; activation awaits approval |
| 3 | Verify selected UDP ICE pair, codec/FEC/DTX and mobile ICE restart; fix reconnect teardown | Keeps calls usable after loss/switching | Moderate | Step 3, approval required |
| 4 | Pause/noise corpus; tune endpointing and speculative cancellation | Potentially overlaps 100–300+ ms | Moderate correctness/cost risk | Steps 3–4, approval required |
| 5 | First-token timeout, provider fallbacks and cooldown | Controls tail failures, not necessarily median | Moderate; credentials, billing, tool safety | Step 4, approval required |
| 6 | Fixed phrase audio cache | Removes synthesis wait for fixed phrases only | Low/moderate; language/voice invalidation | Step 4, approval required |
| 7 | Privacy audit, metrics alerts, admission/memory/drain and real call load test | Safe production operation and capacity estimate | Moderate | Step 5, approval required |
| 8 | Regional/edge/TURN infrastructure or H3 transport | Potential RTT/loss improvement; amount unknown | Higher; infrastructure/cost change | Separate explicit approval |

After approval: change one item at a time, test isolated good-network calls, then
200/500 ms delay, jitter, 5/15% loss, full disconnect and network switching.
Use netem on the UDP media path: Toxiproxy alone only exercises TCP/provider links.
Record which direction each delay affects and actual selected ICE transport.
Latency targets on a 500 ms impaired path cannot be presumed achievable.
Then load-test N concurrent media sessions and document the SLO-limited capacity.

No Steps 3–5 implementation or claims are included in this research milestone.
