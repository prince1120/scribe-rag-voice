"use client";

// Follow the user's audio hardware during a call.
//
// Browsers do not do this for you. A `getUserMedia` stream stays bound to the
// device it was opened with, so plugging in a headset mid-call leaves the
// agent listening to the laptop mic while the user talks into the headset —
// and unplugging can drop the input entirely with no visible cause. Assistants
// people compare this to (ChatGPT voice and friends) all follow the hardware,
// so not doing it reads as broken rather than as a missing nicety.
//
// The rule matches what people expect from every other audio app: plugging
// something in means "use this now"; unplugging means "fall back to whatever
// the system picked".

import { useEffect, useRef } from "react";
import type { Room } from "livekit-client";

export type DeviceChangeReason = "connected" | "disconnected";

export interface AudioDeviceSwitchingOptions {
  room: Room | null;
  enabled: boolean;
  /** Surface the switch in the UI — silently changing someone's microphone is
   *  alarming when they notice, and invisible when they don't. */
  onSwitch?: (label: string, reason: DeviceChangeReason) => void;
}

function isAudio(device: MediaDeviceInfo): boolean {
  return device.kind === "audioinput" || device.kind === "audiooutput";
}

/** Prefer a real named device over the synthetic "default" entry, which is an
 *  alias whose target moves and so tells us nothing about what was added. */
function pickNewest(
  previous: MediaDeviceInfo[],
  current: MediaDeviceInfo[],
  kind: MediaDeviceKind
): MediaDeviceInfo | undefined {
  const seen = new Set(previous.filter((d) => d.kind === kind).map((d) => d.deviceId));
  return current.find(
    (d) => d.kind === kind && d.deviceId !== "default" && !seen.has(d.deviceId)
  );
}

export function useAudioDeviceSwitching({
  room,
  enabled,
  onSwitch,
}: AudioDeviceSwitchingOptions): void {
  const devicesRef = useRef<MediaDeviceInfo[]>([]);
  // Kept in a ref so the effect does not resubscribe whenever the callback
  // identity changes, which would tear down and rebuild the listener on every
  // parent render.
  const onSwitchRef = useRef(onSwitch);
  onSwitchRef.current = onSwitch;

  useEffect(() => {
    if (!room || !enabled) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    let cancelled = false;

    const snapshot = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) devicesRef.current = devices.filter(isAudio);
      } catch {
        // Enumeration can reject if permission was revoked mid-call. Leaving
        // the previous snapshot in place is correct — it just means the next
        // comparison is against slightly stale data.
      }
    };

    void snapshot();

    const handleDeviceChange = async () => {
      let devices: MediaDeviceInfo[];
      try {
        devices = (await navigator.mediaDevices.enumerateDevices()).filter(isAudio);
      } catch {
        return;
      }
      if (cancelled) return;

      const previous = devicesRef.current;
      devicesRef.current = devices;

      // Something was plugged in — switch to it, input and output together so
      // a headset does not end up capturing the mic while playing through
      // laptop speakers.
      const addedInput = pickNewest(previous, devices, "audioinput");
      const addedOutput = pickNewest(previous, devices, "audiooutput");

      if (addedInput || addedOutput) {
        try {
          if (addedInput) await room.switchActiveDevice("audioinput", addedInput.deviceId);
          if (addedOutput) {
            // Output switching is unsupported on some browsers (notably
            // Firefox without setSinkId); the input switch above still stands.
            await room.switchActiveDevice("audiooutput", addedOutput.deviceId).catch(() => {});
          }
          onSwitchRef.current?.(
            addedInput?.label || addedOutput?.label || "New audio device",
            "connected"
          );
        } catch {
          // A failed switch must not end the call — the previous device is
          // still streaming.
        }
        return;
      }

      // Something was removed. If it was the device in use, the track is now
      // dead and must be moved to whatever the system considers default.
      const activeInputId = room.getActiveDevice("audioinput");
      const stillPresent = devices.some(
        (d) => d.kind === "audioinput" && d.deviceId === activeInputId
      );

      if (activeInputId && !stillPresent) {
        try {
          await room.switchActiveDevice("audioinput", "default");
          onSwitchRef.current?.("Default microphone", "disconnected");
        } catch {
          // Nothing further to fall back to; the UI mic indicator will show
          // the failure.
        }
      }
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [room, enabled]);
}
