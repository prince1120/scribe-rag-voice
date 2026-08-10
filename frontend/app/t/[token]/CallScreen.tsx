"use client";

// The whole experience for a voice-only link: a status line, a timer, mute,
// and end. Nothing else.
//
// Deliberately not the main VoiceCall component. That one carries tabs, a
// settings panel, a persona picker and a transcript sidebar — all correct for
// the owner tuning their assistant, all noise for someone who tapped a link to
// ask a question. This is written against livekit-client directly so the
// surface stays exactly as small as the job.

import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, createAudioAnalyser } from "livekit-client";
import type { RemoteAudioTrack, RemoteTrack } from "livekit-client";

type Phase = "idle" | "connecting" | "live" | "ended" | "error";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CallScreen({ name }: { name?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const analyserRef = useRef<ReturnType<typeof createAudioAnalyser> | null>(null);
  const audioElsRef = useRef<HTMLAudioElement[]>([]);

  // Call duration. Restarted per call rather than derived from a start
  // timestamp so a reconnect doesn't show a misleading total.
  useEffect(() => {
    if (phase !== "live") return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    analyserRef.current?.cleanup().catch(() => {});
    analyserRef.current = null;
    // Detached explicitly: an orphaned <audio> keeps the stream alive and the
    // phone's in-call indicator lit after the call has visibly ended.
    audioElsRef.current.forEach((el) => el.remove());
    audioElsRef.current = [];
    roomRef.current?.disconnect();
    roomRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    setError("");
    setSeconds(0);
    setPhase("connecting");

    // Checked before LiveKit touches it: on a plain-http origin the browser
    // removes this API entirely and the failure surfaces as an unreadable
    // "cannot read properties of undefined" from inside the SDK.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setError(
        "Your microphone needs a secure connection. Open this link over https."
      );
      return;
    }

    try {
      const response = await fetch("/api/v1/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rag_enabled: true }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not start the call.");
      }

      const { token, url } = await response.json();
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;

        const element = track.attach() as HTMLAudioElement;
        element.autoplay = true;
        document.body.appendChild(element);
        audioElsRef.current.push(element);

        const analyser = createAudioAnalyser(track as RemoteAudioTrack, {
          smoothingTimeConstant: 0.6,
        });
        (analyser.analyser.context as AudioContext).resume?.().catch(() => {});
        analyserRef.current = analyser;
      });

      room.on(RoomEvent.Disconnected, () => {
        setPhase("ended");
        teardown();
      });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setPhase("live");

      // Volume drives the orb straight through the DOM node. setState here
      // would re-render React sixty times a second for a CSS transform.
      const tick = () => {
        const volume = analyserRef.current?.calculateVolume() ?? 0;
        const level = Math.min(1, volume * 3.4);
        if (orbRef.current) {
          orbRef.current.style.transform = `scale(${1 + level * 0.18})`;
        }
        setAgentSpeaking(level > 0.06);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Could not start the call.");
      teardown();
    }
  }, [teardown]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted]);

  const end = useCallback(() => {
    teardown();
    setPhase("ended");
  }, [teardown]);

  const status =
    phase === "connecting" ? "Connecting…"
    : phase === "live" ? (muted ? "Muted" : agentSpeaking ? "Speaking" : "Listening")
    : phase === "ended" ? "Call ended"
    : phase === "error" ? "Couldn't connect"
    : "Ready when you are";

  return (
    <main className="call-screen">
      <div className="call-inner">
        <div
          ref={orbRef}
          className={`call-orb ${phase === "live" ? "is-live" : ""}`}
          aria-hidden="true"
        />

        <div className="call-status">
          <p className="call-status-main">{status}</p>
          {phase === "live" && (
            <p className="call-timer" aria-label="Call duration">
              {formatDuration(seconds)}
            </p>
          )}
          {phase === "idle" && name && (
            <p className="call-status-sub">Hello {name} — tap to start talking</p>
          )}
          {error && <p className="call-error">{error}</p>}
        </div>

        <div className="call-controls">
          {phase === "live" ? (
            <>
              <button
                type="button"
                onClick={toggleMute}
                className={`call-btn call-btn-mute ds-pressable ds-tap ${muted ? "is-on" : ""}`}
                aria-pressed={muted}
              >
                {muted ? "Unmute" : "Mute"}
              </button>
              <button
                type="button"
                onClick={end}
                className="call-btn call-btn-end ds-pressable ds-tap"
              >
                End
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={phase === "connecting"}
              className="call-btn call-btn-start ds-pressable ds-tap"
            >
              {phase === "connecting" ? "Connecting…"
                : phase === "ended" || phase === "error" ? "Call again"
                : "Start call"}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
