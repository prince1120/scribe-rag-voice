# Voice latency baseline and measurement runbook

Date: 2026-10-06. Docker infrastructure and a live native worker were verified.
No real microphone/speaker, controlled bad-network or concurrency load test was performed.

## Live worker text test

Three synthetic text turns traversed the real LiveKit worker, hosted Sarvam LLM,
Sarvam TTS and WebRTC receiving client. No local LLM was loaded. The temporary
test room was deleted after the test. HTTP/2 and ALPN `h2` were observed on the
worker's provider requests; prewarm and hedging were off.

| Metric (ms) | n | p50 | p95 | p99 |
|---|---:|---:|---:|---:|---:|
| LLM node TTFT | 3 | 155.9 | 646.6 | 646.6 |
| Text sent → first received audible audio | 3 | 885.3 | 1,349.4 | 1,349.4 |
| First LLM token → first server audio frame | 3 | 445.8 | 453.2 | 453.2 |
| TTS first decoded audio chunk | 3 | 445.9 | 453.2 | 453.2 |

Individual text-to-audio times: 1,349.4 / 852.0 / 885.3 ms. Nearest-rank p95/p99
equal the maximum with three turns; this is preliminary, not SLO validation.
Text input bypasses STT/endpointing. Received audible PCM is not physical speaker
playback. End-of-speech → speaker remains unmeasured. The one cold transport setup
recorded combined DNS/TCP 299.2 ms and TLS 118.4 ms. TTS exceeds its 200 ms budget.
No paired live H1 baseline exists, so no causal live optimization saving is claimed.

Deployment is hybrid: Docker LiveKit/Postgres/Redis/Qdrant, native Python API and
worker on this host. Both API and worker health endpoints returned HTTP 200.
HTTP/2 was enabled only in the launched API/worker process environment; no `.env`
or agent model changes were made. Geographic deployment/provider region is unknown.

## Budget

| Stage | Reference allocation |
|---|---:|
| Endpointing after acoustic speech end | 300 ms |
| LLM first usable token | 450 ms (desired range 400–500) |
| First token through clause buffering and first audio frame | 200 ms (desired range 150–250) |
| Network/audio playout | 75 ms (desired range 50–100) |
| Serial reference total | **1,025 ms** |

This is slightly above the p50 target of ~1,000 ms. A separate serial STT wait
would make it worse. Pipeline overlap, shorter stages or both are necessary.
Do not add independent p95 values to estimate the end-to-end p95; measure paired
turns. p95 target is under 1,500 ms, not verified. Fillers are not substantive replies.

## Historical log baseline

Numeric extraction only from `voice_worker.out.log`, `voice_worker.log`,
`voice_worker.err.log`, and `voice_worker.log.old`. Counts are log entries, not
verified unique calls/turns; files may overlap, and the workload includes past
configurations, models and auxiliary speech. No raw logs were printed.

| Metric (ms) | n | p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| LLM node TTFT | 398 | 726 | 3,061 | 5,640 |
| Speech end → first server audio publication | 352 | 2,600 | 6,657 | 16,314 |
| First token → first audio frame | 514 | 534 | 1,196 | 7,106 |
| Speech end → browser speaker playback | 0 | Unmeasured | Unmeasured | Unmeasured |
| STT final/endpointing delay | 0 | Missing in legacy logs | Missing | Missing |
| Interruption → browser silence | 0 | Unmeasured | Unmeasured | Unmeasured |

The old logger looked for user timings on assistant messages; LiveKit keeps those
on user messages. New instrumentation correlates those stages and preserves null
when a stage is unavailable. No browser playback or interruption measurement is
fabricated from server timestamps.

## Controlled provider experiments already performed

Hosted Sarvam API requests from this Windows host, not a locally loaded LLM.
Same default conversational model, ~768–769 input tokens, synthetic business
questions, 220 output-token cap, `reasoning_effort=null`, streaming, long-lived
HTTPX client per experiment. No impairment was injected; network quality was not
characterized. This is not the live owner prompt/tool/context workload.

| Configuration | Successful requests | LLM TTFT p50 | p95 | p99 |
|---|---:|---:|---:|---:|
| Existing H1.1 pooled client, no HEAD warmup | 12 | 477 ms | 1,950 ms | 1,950 ms |
| H2 only, no HEAD warmup | 12 | 194 ms | 1,177 ms | 1,177 ms |
| H2 plus HEAD warmup | 12 | 887 ms | 2,581 ms | 2,581 ms |

Nearest-rank percentiles; with 12 samples p95 and p99 equal the maximum.
Runs were sequential, not randomized or paired. Provider load/cache changes
can confound differences. H2 negotiated `HTTP/2` and ALPN `h2` in all measured
H2 responses; H1 negotiated `http/1.1`.

Observed H2-only difference: **283 ms lower p50 and 773 ms lower p95/p99**.
This is not a proven causal saving or end-to-end improvement. Prewarm's subsequent
run was slower overall: **693 ms higher p50** than H2-only. Its first request was
439 ms versus 1,177 ms for H2-only, but that also is not a controlled comparison.
Prewarm remains optional/off; no general improvement is claimed.

One additional synthetic test of the current Bulbul stack sent a first comma
clause, delayed the next clause by 500 ms, and reused the SDK's pooled socket.
Baseline first-clause → first decoded audio frame: n=6, p50 **1,286 ms**, p95/p99
**2,412 ms**. That includes the deliberate 500 ms input gap, sentence buffering,
provider work and cold/warm setup. No optimized TTS or speaker comparison was run.

Alternate candidate API tests performed before the user's clarification are not
used to select or change a model. Further alternate-model tests have stopped.

## Before/after SLO coverage

| Scenario | LLM TTFT before / after | Speech end → actual playback before / after |
|---|---|---|
| Host → Sarvam API, no injected impairment | Above small-sample transport experiment | Unmeasured / unmeasured |
| Live hybrid worker, three text turns | Current 156 / 647 / 647 ms; no paired before | Speech-end/speaker unmeasured; text/received-audio measured above |
| 200/500 ms delay, 5/15% loss, jitter, disconnect | Not run; Step 3 approval required | Not run |
| N concurrent calls / CPU / RSS per call | Not run; Step 5 approval required | No capacity claim |

## Instrumentation and limits

- `VOICE_LATENCY` records contain opaque call/turn/request IDs and numeric
  measurements, not API keys, headers, bodies, URLs, transcripts or audio.
- `turn`: budget/targets, LLM node TTFT, first-token-to-frame, speech-end-to-server
  audio, user transcript delay, endpointing and user-hook time. Auxiliary speech
  and interrupted replies are labelled. Browser playback remains **null**.
- `llm_transport`: request start → response headers, HTTP version, negotiated
  ALPN, connection trace durations. `dns_tcp_ms` is combined DNS+TCP acquisition;
  installed httpcore does not expose a separate DNS span. Missing setup spans
  are not recorded as zero or proof of a new connection.
- `llm_stream`/`llm_metrics`: first chunk, stream completion, cancelled flag and
  usage. SDK first chunk is not always a spoken token; stream end is not exactly
  the last content token. The benchmark explicitly finds first/last content delta.
- `stt_metrics`/`tts_metrics`: SDK acquisition/reuse, duration and first-chunk
  measurements. The installed 1.6.6 session metrics event is deprecated but still
  required for acquisition/duration fields absent from ChatMessage metrics.
- These do not measure acoustic ground truth, browser jitter-buffer latency,
  device output latency, interruption silence, or prove stream RST cancellation.
- No client/server wall-clock subtraction is used. A future browser probe must
  timestamp speech end and playout on one monotonic clock and label estimates.
- Existing content-bearing worker/SDK debug/error log sites need the separate
  privacy-hardening audit. New timing records are content-free; this milestone
  does not claim all legacy logs are sanitized.

## Summary commands

From `backend`, read existing local logs without printing their contents:

```powershell
../venv/Scripts/python.exe scripts/voice_latency_report.py voice_worker.out.log voice_worker.log --format markdown
```

From the workspace root, summarize Docker logs through stdin (Docker must be
installed/running and available on PATH):

```powershell
docker compose --profile docker-app logs --no-color --no-log-prefix voice-worker | .\venv\Scripts\python.exe backend/scripts/voice_latency_report.py - --format markdown
```

The reporter only prints allowlisted metrics and percentiles. It accepts JSON
worker logging and legacy lines. Keep experiments/time windows separate; do not
combine historical entries with a controlled before/after trial. The backend
Dockerfile copies `app`, not `scripts`; run the reporter on the host against logs.

For the latest live call only, excluding old/duplicated structured events:

```powershell
../venv/Scripts/python.exe scripts/voice_latency_report.py voice_worker.log --last-call --format markdown
```

Live test harness: `scripts/test_live_voice_worker.py`, using the existing hybrid
environment and private credentials. It dispatches a temporary worker room, sends
three synthetic texts, measures received decoded audio, and deletes that room.

Provider benchmark harnesses exist but no additional runs are scheduled:
`scripts/benchmark_voice_llm.py` and `scripts/benchmark_voice_tts.py`. They use
only synthetic content and print timings/status/usage; keys are read privately.

## Flags currently present

| Setting | Default | Meaning |
|---|---|---|
| `VOICE_LLM_HTTP2` | `false` | Enable H2 where provider negotiates it; inspect `alpn=h2`, not just the flag |
| `VOICE_LLM_PREWARM` | `false` | Start bounded unauthenticated HEAD `/models` requests at session prewarm; any status establishes transport only |
| `VOICE_LLM_KEEPALIVE_SECONDS` | `30` | HEAD interval when prewarm is enabled; code enforces minimum 10 seconds |
| `VOICE_LLM_HEDGE_ENABLED` | `false` | Keep off: enabling fails explicitly pending validated RST_STREAM transport |
| `VOICE_LLM_HEDGE_THRESHOLD_MS` | `477` | Reserved historical experimental p50; no hedged request is sent |
| `VOICE_LLM_HEDGE_MAX_PARALLEL` | `2` | Reserved; hedging remains disabled |
| `VOICE_TTS_FLUSH_CLAUSES` | `false` | Earlier opt-in explicit provider segment flush; no measured live benefit yet |
| `VOICE_TTS_MIN_BUFFER_CHARS` | `50` | Preserve installed default; plugin accepts 30–200 |
| `VOICE_LLM_FALLBACK_ENABLED` | `false` | Reserved only; **not implemented—do not enable** |
| `VOICE_LLM_FALLBACK_PROVIDER` / `MODEL` | Groq / `llama-3.1-8b-instant` | Reserved placeholders, not a configured or validated fallback |
| `VOICE_LLM_TTFT_TIMEOUT_SECONDS` | `1.5` | Reserved fallback deadline; currently not enforced as an application TTFT limit |

Flags apply to Sarvam/custom OpenAI-compatible factory; native Groq/Mistral
factories still use their installed SDK clients. No per-agent model/key change,
publish, env edit or deployment was performed. Compose loads root `.env`; set
only desired flags there and recreate the worker after approval, preserving
credentials. Generic endpoints negotiate H1 if they do not support H2.

## Approval milestone

Research is complete; stage/budget logging and the summary script are available.
Step 2 remains incomplete for actual browser playback and interruption silence
until a real call and client-side timing validation are available. The proposed
Step 3–5 plan is in `VOICE_PRODUCTION_RESEARCH.md`. Wait for user approval before
implementing resilience/fallback/scaling or running impairment/load tests.
