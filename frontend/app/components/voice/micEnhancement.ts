"use client";

// Background-*voice* suppression for the microphone, shared by every call screen.
//
// WebRTC `noiseSuppression` (see MIC_CAPTURE) only removes steady non-speech
// sound — fans, traffic, keyboards. A second person talking nearby is speech,
// which browsers deliberately preserve, so it sails through to STT and hijacks
// turns. This adds Krisp's Background Voice Cancellation (BVC): an on-device
// model that keeps the primary speaker and suppresses competing voices before
// audio ever leaves the browser.
//
// Cost/latency profile (why this is the default, not an option):
// - Free: the `@livekit/krisp-noise-filter` package runs locally, no Cloud
//   subscription, works with our self-hosted LiveKit server.
// - ~10-20ms per frame, no network hop, no added turn latency — filtering
//   happens inside the 20ms audio frame budget the mic already uses.
// - Fails open: if the model can't load (offline first visit, unsupported
//   browser, CDN blocked), calls fall back to plain MIC_CAPTURE. A call with
//   background voices is strictly better than no call.
// - Kill switch without a code change: NEXT_PUBLIC_VOICE_BVC_ENABLED=0.
//
// Do NOT also enable an agent-side NC model (Krisp VIVA / ai-coustics) while
// this runs — LiveKit warns stacked models produce artifacts, since each is
// trained on raw audio.

import type { Room } from "livekit-client";
import type { TrackProcessor, AudioProcessorOptions } from "livekit-client";
import { Track } from "livekit-client";
import { MIC_CAPTURE } from "./useCallQuality";

type AudioProc = TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>;

let cached: AudioProc | null = null;
let attempted = false;

function bvcDisabled(): boolean {
  return process.env.NEXT_PUBLIC_VOICE_BVC_ENABLED === "0";
}

/** Lazily loads the BVC model once per page lifetime. Never throws. */
export async function getVoiceIsolationProcessor(): Promise<AudioProc | undefined> {
  if (bvcDisabled()) return undefined;
  if (cached) return cached;
  if (attempted) return undefined;
  attempted = true;
  try {
    const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await import(
      "@livekit/krisp-noise-filter"
    );
    if (!isKrispNoiseFilterSupported()) return undefined;
    cached = KrispNoiseFilter({ useBVC: true });
    return cached;
  } catch {
    // Offline CDN, blocked script, old browser — plain mic still works.
    return undefined;
  }
}

/**
 * Drop-in replacement for `room.localParticipant.setMicrophoneEnabled(true,
 * { ...MIC_CAPTURE })`. Attaches BVC when available, plain capture otherwise.
 * `extra` merges caller-specific options (e.g. a chosen `deviceId`).
 */
export async function enableEnhancedMic(
  room: Room,
  extra?: Record<string, unknown>
): Promise<void> {
  const processor = await getVoiceIsolationProcessor();
  if (processor) {
    try {
      await room.localParticipant.setMicrophoneEnabled(true, {
        ...MIC_CAPTURE,
        ...extra,
        processor,
      });
      return;
    } catch (err) {
      console.warn("Krisp noise filter failed to attach, falling back to standard mic capture:", err);
    }
  }
  await room.localParticipant.setMicrophoneEnabled(true, {
    ...MIC_CAPTURE,
    ...extra,
  });
}
