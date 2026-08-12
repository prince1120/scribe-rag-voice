"use client";

import { WifiOff } from "lucide-react";

import type { NetworkWarning } from "./useCallQuality";

/**
 * The "your connection is bad" strip shown during a call.
 *
 * Renders nothing when the connection is fine — see useCallQuality for why an
 * always-on indicator is worse than no indicator.
 *
 * `role="status"` with `aria-live="polite"` so a screen reader announces the
 * change without interrupting whatever it is currently reading, which on a
 * voice call is likely the transcript.
 */
export function NetworkBanner({ warning }: { warning: NetworkWarning | null }) {
  if (!warning) return null;

  return (
    <div role="status" aria-live="polite" className="call-network-banner">
      <WifiOff size={14} aria-hidden="true" />
      <span className="call-network-text">{warning.text}</span>
      <span className="call-network-detail">{warning.detail}</span>
    </div>
  );
}
