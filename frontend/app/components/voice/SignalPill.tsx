"use client";

import { ConnectionQuality } from "livekit-client";

import { signalReading } from "./useCallQuality";

/**
 * Always-visible connection strength for a live call.
 *
 * Three bars, filled by quality, next to a one-word label. Sits in the call
 * header beside the timer so it is readable at a glance on a phone without
 * competing with the call controls.
 *
 * The warning banner remains the thing that explains a problem; this is the
 * resting-state indicator that shows the connection is being watched. Asked for
 * directly after a call froze and the screen said nothing — a silent-until-bad
 * design gives no feedback in the moment someone is wondering whether it is
 * their network or the assistant.
 */
export function SignalPill({
  quality,
  isLive,
}: {
  quality: ConnectionQuality;
  isLive: boolean;
}) {
  const { bars, label, tone } = signalReading(quality, isLive);

  return (
    <span
      className={`call-signal call-signal-${tone}`}
      role="status"
      aria-live="off"
      aria-label={`Connection: ${label}`}
      title={`Connection: ${label}`}
    >
      <span className="call-signal-bars" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <i key={n} className={n <= bars ? "is-on" : undefined} />
        ))}
      </span>
      <span className="call-signal-label">{label}</span>
    </span>
  );
}
