"use client";

// Network quality for a live call, and the microphone settings every call
// should capture with.
//
// Both of these existed on the invite-link screen (`/t/[token]`) and nowhere
// else, so the owner's own test panel and the personal app ran with no network
// warning at all and — more consequentially — with the browser's raw
// microphone: no echo cancellation, no noise suppression, no gain control.
// That is why background noise behaves differently depending on which screen a
// call is placed from.
//
// Shared here rather than copied a third time.

import { useCallback, useEffect, useState } from "react";
import { ConnectionQuality, Room, RoomEvent } from "livekit-client";

/**
 * Microphone capture settings for `setMicrophoneEnabled`.
 *
 * `noiseSuppression` removes steady non-speech sound — a fan, traffic, a
 * keyboard. It does NOT remove a second person talking nearby: that is speech,
 * and browser suppression is built to preserve speech. Background *voices* need
 * either a speech-aware filter (LiveKit Cloud's Krisp plugin) or an
 * interruption mode that waits for words rather than audio.
 *
 * `echoCancellation` matters more than it looks on this stack: without it the
 * agent's own voice leaves the speaker, re-enters the microphone, and
 * interrupts the agent mid-sentence. The assistant talking over itself is
 * indistinguishable from background noise in the logs.
 */
export const MIC_CAPTURE = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const;

export interface NetworkWarning {
  text: string;
  detail: string;
}

/** How long the agent may be silent after you finish speaking before the UI
 *  says something. Turn metrics on a healthy call land at 2-4s end to end, so
 *  this sits above normal and below the point where a caller assumes the line
 *  is dead and hangs up. */
const STALL_AFTER_MS = 6000;
/** Past this it is not slow, it is broken. */
const STALL_BAD_AFTER_MS = 14000;

/**
 * Whether the assistant has gone quiet for too long after a user turn.
 *
 * This is a different failure from a weak network and needs its own detector.
 * ConnectionQuality describes the WebRTC transport only: when the link is
 * healthy but the LLM is slow, the provider is rate-limiting, or the worker has
 * stalled, quality stays "Excellent" while the caller hears nothing at all.
 * Reported from a real call as "voice and LLM response get stuck and I didn't
 * get anything on my screen" — correctly, because nothing was watching for it.
 *
 * `waiting` should be true from the moment the user's turn ends until the first
 * agent audio arrives.
 */
export function useAgentStall(waiting: boolean): NetworkWarning | null {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!waiting) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    // 500ms rather than per-frame: this drives a text swap, and a call screen
    // is already animating an orb.
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [waiting]);

  if (!waiting || elapsed < STALL_AFTER_MS) return null;
  if (elapsed < STALL_BAD_AFTER_MS) {
    return {
      text: "Still thinking…",
      detail: "The assistant is taking longer than usual to reply.",
    };
  }
  return {
    text: "No response",
    detail: "The assistant hasn't replied. Try speaking again, or hang up and redial.",
  };
}

/**
 * Tracks the *local* participant's connection quality.
 *
 * Only the local side is reported. The agent's quality is our problem to fix,
 * not something the caller can act on, and showing it would be a second
 * indicator they can do nothing about.
 */
export function useCallQuality(room: Room | null, isLive: boolean) {
  const [quality, setQuality] = useState<ConnectionQuality>(
    ConnectionQuality.Excellent
  );

  const reset = useCallback(() => setQuality(ConnectionQuality.Excellent), []);

  useEffect(() => {
    if (!room) return;

    const onQuality = (q: ConnectionQuality, participant?: { isLocal?: boolean }) => {
      if (participant?.isLocal) setQuality(q);
    };
    const onReconnecting = () => setQuality(ConnectionQuality.Lost);
    const onReconnected = () => setQuality(ConnectionQuality.Good);

    room.on(RoomEvent.ConnectionQualityChanged, onQuality);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);

    return () => {
      room.off(RoomEvent.ConnectionQualityChanged, onQuality);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
    };
  }, [room]);

  // Surfaced only when it is bad. A green "Excellent" badge on every call is
  // decoration that trains people to ignore the indicator on the one occasion
  // it has something useful to say.
  const warning: NetworkWarning | null = !isLive
    ? null
    : quality === ConnectionQuality.Lost
    ? { text: "Reconnecting…", detail: "Your connection dropped." }
    : quality === ConnectionQuality.Poor
    ? {
        text: "Weak network",
        detail: "Audio may break up. Try moving closer to your router.",
      }
    : null;

  return { quality, warning, reset };
}

/**
 * A compact always-visible signal reading: bars filled, a label, and a colour.
 *
 * Separate from `warning`, which stays silent until something is wrong. Both
 * exist because they answer different questions: the banner interrupts to say
 * "this is why the audio is breaking up", while this lets someone glance at the
 * screen mid-call and see that the connection is being watched at all.
 *
 * `Unknown` is reported as connecting rather than as a fault — LiveKit reports
 * it briefly before the first quality sample arrives, and showing a red bar for
 * the first second of every call would be a lie.
 */
export function signalReading(quality: ConnectionQuality, isLive: boolean) {
  if (!isLive) return { bars: 0, label: "Offline", tone: "idle" as const };
  switch (quality) {
    case ConnectionQuality.Excellent:
      return { bars: 3, label: "Strong", tone: "good" as const };
    case ConnectionQuality.Good:
      return { bars: 2, label: "Good", tone: "good" as const };
    case ConnectionQuality.Poor:
      return { bars: 1, label: "Weak", tone: "warn" as const };
    case ConnectionQuality.Lost:
      return { bars: 0, label: "Lost", tone: "bad" as const };
    default:
      return { bars: 0, label: "Connecting", tone: "idle" as const };
  }
}
