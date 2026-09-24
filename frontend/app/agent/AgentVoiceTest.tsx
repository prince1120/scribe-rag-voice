"use client";

import { ownerFetch } from "../lib/ownerFetch";
import { extractApiErrorMessage, formatClientError } from "../lib/apiErrors";

// Call your own agent, from the console.
//
// Chat and voice are different pipelines: chat is HTTP → RAG → LLM → stream in
// the API process, while voice is WebRTC → LiveKit → STT → RAG → LLM → TTS in
// a separate worker. Testing chat proves the prompt reads well. It proves
// nothing about the voice you picked, the greeting, turn-taking, or whether
// the worker is even running — so the only way to know a call works is to make
// one.

import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, createAudioAnalyser } from "livekit-client";
import { NetworkBanner } from "../components/voice/NetworkBanner";
import { MIC_CAPTURE, useCallQuality, VOICE_ROOM_OPTIONS } from "../components/voice/useCallQuality";
import { VOICE_DATA_PACKETS } from "../components/voice/voiceEvents";
import type { RemoteAudioTrack, RemoteTrack } from "livekit-client";

type Phase = "idle" | "connecting" | "live" | "ended" | "error";

export function AgentVoiceTest({ deployed }: { deployed: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [speaking, setSpeaking] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const rafRef = useRef(0);
  const analyserRef = useRef<ReturnType<typeof createAudioAnalyser> | null>(null);
  const audioElsRef = useRef<HTMLAudioElement[]>([]);
  const orbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase !== "live") return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    analyserRef.current?.cleanup().catch(() => {});
    analyserRef.current = null;
    // Removed explicitly: an orphaned <audio> keeps the stream alive and the
    // device's in-call indicator lit after the call has visibly ended.
    audioElsRef.current.forEach((el) => el.remove());
    audioElsRef.current = [];
    // Null before disconnect so the Disconnected handler's teardown call
    // can't re-enter a second disconnect on an intentional hangup.
    const room = roomRef.current;
    roomRef.current = null;
    room?.disconnect();
    setActiveRoom(null);
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    setError("");
    setSeconds(0);
    setPhase("connecting");

    // Checked before LiveKit touches it: on a plain-http origin the browser
    // removes this API entirely, and the failure surfaces as an unreadable
    // "cannot read properties of undefined" from inside the SDK.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setError("Your microphone needs a secure connection. Open the console over https.");
      return;
    }

    try {
      const response = await ownerFetch("/api/v1/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Empty body on purpose: the server reads voice, greeting, language
        // and RAG from the saved agent, so this call tests what a customer
        // would actually reach rather than whatever the console asked for.
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error("Voice testing is unavailable or the assistant has not been deployed yet.");
        }
        if (response.status === 429) {
          throw new Error("Voice testing rate limit reached. Please wait a moment before trying again.");
        }
        if (response.status === 502 || response.status === 503) {
          const detail = await extractApiErrorMessage(response, "Voice worker is temporarily offline or unreachable.");
          throw new Error(detail);
        }
        const errDetail = await extractApiErrorMessage(response, "Could not start the test call.");
        throw new Error(errDetail);
      }

      const { token, url } = await response.json();
      const room = new Room(VOICE_ROOM_OPTIONS);
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

      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const str = new TextDecoder().decode(payload);
          const data = JSON.parse(str);
          if (data.type === VOICE_DATA_PACKETS.INTERRUPT) {
            audioElsRef.current.forEach((el) => {
              try {
                el.pause();
                el.currentTime = 0;
              } catch {}
            });
            // livekit-client only play()s on attach, so a paused element
            // would stay silent for the rest of the call. Resume shortly
            // after the ~50ms cut; skip anything already playing or torn
            // down so stacked interrupts can't storm play().
            setTimeout(() => {
              audioElsRef.current.forEach((el) => {
                if (el.paused && el.isConnected) el.play().catch(() => {});
              });
            }, 50);
            setSpeaking(false);
          }
        } catch {}
      });

      room.on(RoomEvent.Disconnected, () => { setPhase("ended"); teardown(); });

      await room.connect(url, token);
      // Same capture settings as a real call. Testing on the browser's raw
      // microphone meant the owner tuned their agent against different audio
      // conditions than their callers actually get — including the agent
      // interrupting itself through the speaker.
      await room.localParticipant.setMicrophoneEnabled(true, { ...MIC_CAPTURE });
      setActiveRoom(room);
      setPhase("live");

      // Written straight to the DOM node; setState here would re-render React
      // sixty times a second for a CSS transform.
      const tick = () => {
        const volume = analyserRef.current?.calculateVolume() ?? 0;
        const level = Math.min(1, volume * 3.4);
        if (orbRef.current) orbRef.current.style.transform = `scale(${1 + level * 0.14})`;
        setSpeaking(level > 0.06);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err: any) {
      setPhase("error");
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError" || err?.message?.toLowerCase().includes("permission")) {
        setError("Microphone permission was denied. Please allow microphone access in your browser to test voice.");
      } else {
        setError(formatClientError(err, "Could not start the test call."));
      }
      teardown();
    }
  }, [teardown]);

  async function toggleMute() {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }

  const status =
    phase === "connecting" ? "Connecting…"
    : phase === "live" ? (muted ? "Muted" : speaking ? "Speaking" : "Listening")
    : phase === "ended" ? "Call ended"
    : phase === "error" ? "Could not connect"
    : "Call your assistant to hear it";

  const { warning: networkWarning } = useCallQuality(activeRoom, phase === "live");

  return (
    <div className="vtest">
      <NetworkBanner warning={networkWarning} />
      <div className="vtest-main">
        <div
          ref={orbRef}
          className={`vtest-orb ${phase === "live" ? "is-live" : ""}`}
          aria-hidden="true"
        />
        <div className="vtest-status">
          <span className="vtest-status-main">{status}</span>
          {phase === "live" && (
            <span className="vtest-timer">
              {Math.floor(seconds / 60)}:{(seconds % 60).toString().padStart(2, "0")}
            </span>
          )}
        </div>
      </div>

      {!deployed && phase === "idle" && (
        <p className="dash-hint">
          Testing works on a draft. Shared links stay refused until you deploy.
        </p>
      )}
      {error && <p className="agent-error" role="alert">{error}</p>}

      <div className="vtest-controls">
        {phase === "live" ? (
          <>
            <button
              type="button"
              className={`links-btn ds-pressable ds-tap ${muted ? "is-on" : ""}`}
              onClick={toggleMute}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              className="links-btn links-btn-danger ds-pressable ds-tap"
              onClick={() => { teardown(); setPhase("ended"); }}
            >
              End call
            </button>
          </>
        ) : (
          <button
            type="button"
            className="signin-button ds-pressable ds-tap"
            onClick={start}
            disabled={phase === "connecting"}
          >
            {phase === "connecting" ? "Connecting…"
              : phase === "idle" ? "Start test call" : "Call again"}
          </button>
        )}
      </div>
    </div>
  );
}
