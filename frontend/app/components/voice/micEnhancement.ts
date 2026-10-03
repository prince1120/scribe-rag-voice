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
import { ConnectionState, Track } from "livekit-client";
import { MIC_CAPTURE } from "./useCallQuality";

type AudioProc = TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>;

function bvcDisabled(): boolean {
  return process.env.NEXT_PUBLIC_VOICE_BVC_ENABLED === "0";
}

/** Lazily imports BVC; use a fresh processor for each microphone track. */
export async function getVoiceIsolationProcessor(): Promise<AudioProc | undefined> {
  if (bvcDisabled()) return undefined;
  try {
    const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await import(
      "@livekit/krisp-noise-filter"
    );
    if (!isKrispNoiseFilterSupported()) return undefined;
    return KrispNoiseFilter({ useBVC: true });
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
  extra?: Record<string, unknown>,
  isActive: () => boolean = () => true,
): Promise<void> {
  const processor = await getVoiceIsolationProcessor();
  if (!isActive() || room.state !== ConnectionState.Connected) return;
  if (processor) {
    try {
      await room.localParticipant.setMicrophoneEnabled(true, {
        ...MIC_CAPTURE,
        ...extra,
        processor,
      });
      if (!isActive() || room.state !== ConnectionState.Connected) stopMicrophone(room);
      return;
    } catch (err) {
      console.warn("Krisp noise filter failed to attach, falling back to standard mic capture:", err);
    }
  }
  if (!isActive() || room.state !== ConnectionState.Connected) return;
  await room.localParticipant.setMicrophoneEnabled(true, {
    ...MIC_CAPTURE,
    ...extra,
  });
  if (!isActive() || room.state !== ConnectionState.Connected) stopMicrophone(room);
}

/** Release capture immediately, even if signalling or disconnect fails. */
export function stopMicrophone(room: Room): void {
  room.localParticipant.audioTrackPublications.forEach(({ track }) => {
    try { track?.mediaStreamTrack.stop(); } catch {}
    try { track?.stop(); } catch {}
  });
}
