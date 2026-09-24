"use client";

// The phone-call experience for voice callers:
// 1. Idle: Clean centered Hero Card with breathing 3D Orb + Start Call button.
// 2. Live: Dual-column workspace with active Orb, sound bars & integrated control dock.
// 3. Ended: Symmetrical Call Summary Recap Card with conversation history & Call Again button.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConnectionQuality,
  Room,
  RoomEvent,
  Track,
  createAudioAnalyser,
} from "livekit-client";
import type { RemoteAudioTrack, RemoteTrack } from "livekit-client";
import { MIC_CAPTURE, useAgentStall, VOICE_ROOM_OPTIONS } from "../../components/voice/useCallQuality";
import { SignalPill } from "../../components/voice/SignalPill";
import { VOICE_DATA_PACKETS } from "../../components/voice/voiceEvents";
import {
  Check,
  CheckCircle2,
  Copy,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RotateCcw,
  Sparkles,
  User,
  Volume2,
  WifiOff,
  X,
} from "lucide-react";

import "../../styles/callscreen.css";
import { extractApiErrorMessage, formatClientError } from "../../lib/apiErrors";
import { useAudioDevices, AudioDeviceSelector } from "../../components/voice/AudioDeviceControls";
import { useAudioDeviceSwitching } from "../../components/voice/useAudioDeviceSwitching";
import { Headphones, Sliders } from "lucide-react";

type Phase = "idle" | "connecting" | "live" | "ended" | "error";

interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
  isFinal: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CallScreen({
  name,
  onSwitchToChat,
}: {
  name?: string;
  onSwitchToChat?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [waitingForAgent, setWaitingForAgent] = useState(false);
  const [agentIssue, setAgentIssue] = useState<"rate_limited" | "provider_busy" | "">("");
  const [agentHasSpoken, setAgentHasSpoken] = useState(false);
  const [quality, setQuality] = useState<ConnectionQuality>(
    ConnectionQuality.Excellent,
  );
  const [showAudioSettings, setShowAudioSettings] = useState(false);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const audioDevices = useAudioDevices(roomRef.current);

  useAudioDeviceSwitching({
    room: roomRef.current,
    enabled: phase === "live",
    onSwitch: (label, reason) => {
      setDeviceNotice(
        reason === "connected" ? `Switched to ${label}` : `${label} disconnected — using default`
      );
    },
  });

  useEffect(() => {
    if (!deviceNotice) return;
    const timer = setTimeout(() => setDeviceNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [deviceNotice]);

  // Live transcript state
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);
  const [liveBooking, setLiveBooking] = useState<{ type: string; title: string; date?: string; time?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const callIdRef = useRef<string | null>(null);
  const persistedRef = useRef<string | null>(null);

  const transcriptListRef = useRef<HTMLDivElement>(null);

  const orbRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const analyserRef = useRef<ReturnType<typeof createAudioAnalyser> | null>(null);
  const audioElsRef = useRef<HTMLAudioElement[]>([]);
  const transcriptsRef = useRef<TranscriptMessage[]>([]);
  const secondsRef = useRef(0);

  // Keep disconnect persistence independent from React render timing.
  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  useEffect(() => {
    secondsRef.current = seconds;
  }, [seconds]);

  // Call duration counter
  useEffect(() => {
    if (phase !== "live") return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // Auto scroll transcript container to bottom
  useEffect(() => {
    if (transcriptListRef.current) {
      transcriptListRef.current.scrollTo({
        top: transcriptListRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [transcripts, showMobileDrawer]);

  const copyTranscript = useCallback(() => {
    if (transcripts.length === 0) return;
    const text = transcripts
      .map((t) => `[${t.time}] ${t.role === "user" ? name || "You" : "Assistant"}: ${t.text}`)
      .join("\n\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [transcripts, name]);

  const persistSession = useCallback(async () => {
    if (!callIdRef.current || persistedRef.current === callIdRef.current) return;
    persistedRef.current = callIdRef.current;
    const currentCall = callIdRef.current;
    setSaveState("saving");
    try {
      const res = await fetch("/api/v1/voice/record_session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_id: callIdRef.current,
          messages: transcriptsRef.current.filter(m => m.isFinal && m.text.trim()).map(m => ({ role: m.role, content: m.text })),
          duration_seconds: secondsRef.current,
        }),
      });
      if (!res.ok) throw new Error("Could not confirm the saved transcript.");
      if (callIdRef.current === currentCall) setSaveState("saved");
    } catch {
      persistedRef.current = null;
      if (callIdRef.current === currentCall) setSaveState("error");
    }
  }, []);

  const persistBeacon = useCallback(() => {
    if (!callIdRef.current || persistedRef.current === callIdRef.current) return;
    persistedRef.current = callIdRef.current;
    const body = JSON.stringify({
      call_id: callIdRef.current,
      messages: transcriptsRef.current.filter(m => m.isFinal && m.text.trim()).map(m => ({ role: m.role, content: m.text })),
      duration_seconds: secondsRef.current,
    });
    const blob = new Blob([body], { type: "application/json" });
    if (blob.size < 60000) navigator.sendBeacon?.("/api/v1/voice/record_session", blob);
  }, []);

  const teardown = useCallback(async () => {
    cancelAnimationFrame(rafRef.current);
    analyserRef.current = null;
    audioElsRef.current.forEach((el) => {
      try {
        el.pause();
        el.srcObject = null;
        el.remove();
      } catch {}
    });
    audioElsRef.current = [];
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try {
        await room.localParticipant?.setMicrophoneEnabled(false);
        room.localParticipant?.audioTrackPublications.forEach((pub) => {
          try { pub.track?.stop(); } catch {}
        });
        await room.disconnect(true);
      } catch {}
    }
  }, []);

  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  const start = useCallback(async () => {
    if (phase === "connecting") return;
    if (roomRef.current) {
      await teardown();
      await new Promise((r) => setTimeout(r, 250));
    }
    callIdRef.current = null;
    persistedRef.current = null;
    setSaveState("idle");
    setLiveBooking(null);
    setError("");
    setSeconds(0);
    setTranscripts([]);
    setPhase("connecting");
    setAgentHasSpoken(false);
    setQuality(ConnectionQuality.Excellent);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setError("Your microphone needs a secure connection. Open this link over https.");
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
        if (response.status === 403) {
          throw new Error("Voice is unavailable for this link or the assistant is not currently deployed.");
        }
        if (response.status === 429) {
          throw new Error("Voice service is currently rate limited. Please wait a moment before trying again.");
        }
        if (response.status === 502 || response.status === 503) {
          const detail = await extractApiErrorMessage(response, "Voice service is temporarily offline.");
          throw new Error(detail);
        }
        const errDetail = await extractApiErrorMessage(response, "Could not start the call.");
        throw new Error(errDetail);
      }

      const { token, url, call_id } = await response.json();
      callIdRef.current = call_id || null;
      const room = new Room(VOICE_ROOM_OPTIONS);
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        const element = track.attach() as HTMLAudioElement;
        element.autoplay = true;
        if (audioDevices.activeOutputId && audioDevices.activeOutputId !== "default" && "setSinkId" in element) {
          (element as any).setSinkId(audioDevices.activeOutputId).catch(() => {});
        }
        document.body.appendChild(element);
        audioElsRef.current.push(element);

        const analyser = createAudioAnalyser(track as RemoteAudioTrack, {
          smoothingTimeConstant: 0.6,
        });
        (analyser.analyser.context as AudioContext).resume?.().catch(() => {});
        analyserRef.current = analyser;
      });

      // Real-time live transcript handling
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        for (const seg of segments) {
          const role = participant?.isLocal ? "user" : "assistant";
          const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

          if (role === "assistant") {
            setAgentSpeaking(true);
            setAgentHasSpoken(true);
            setWaitingForAgent(false);
          } else if (seg.final) {
            // Only start the response timer once STT has finalized an
            // utterance. Starting it for interim text creates a false "No
            // response" warning while the caller is still talking.
            setWaitingForAgent(true);
            setAgentIssue("");
          }

          setTranscripts((prev) => {
            const idx = prev.findIndex((m) => m.id === seg.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = { ...copy[idx], text: seg.text, isFinal: seg.final };
              return copy;
            }
            return [
              ...prev,
              { id: seg.id, role, text: seg.text, time: nowTime, isFinal: seg.final },
            ];
          });
        }
      });

      // Data packets
      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const str = new TextDecoder().decode(payload);
          const data = JSON.parse(str);
          if (data.type === VOICE_DATA_PACKETS.CALL_ENDED || data.type === VOICE_DATA_PACKETS.END_CALL) {
            setPhase("ended");
            void persistSession();
            teardown();
            try { room.disconnect(); } catch {}
            return;
          }
          if (data.type === VOICE_DATA_PACKETS.INTERRUPT) {
            // Instant hardware-level audio cutoff on user barge-in
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
            setAgentSpeaking(false);
            setWaitingForAgent(false);
            return;
          }
          if (data.type === VOICE_DATA_PACKETS.AGENT_UNAVAILABLE) {
            setWaitingForAgent(false);
            setAgentSpeaking(false);
            setAgentIssue(data.reason === "rate_limited" ? "rate_limited" : "provider_busy");
            return;
          }
          if (data.type === "booking_pending" || data.type === "booking_confirmed" || data.type === "booking_rescheduled" || data.type === "booking_cancelled" || data.type === "booking_failed") {
            setLiveBooking({
              type: data.type,
              title: data.text || (data.type === "booking_pending" ? "Confirming appointment…" : data.type === "booking_confirmed" ? "Appointment booked" : data.type === "booking_rescheduled" ? "Appointment rescheduled" : data.type === "booking_cancelled" ? "Appointment cancelled" : "Booking could not be confirmed"),
              date: data.date,
              time: data.time,
            });
            setTimeout(() => setLiveBooking(null), data.type === "booking_pending" ? 15000 : 8000);
          }
          if (data.text) {
            const role = data.role === "user" ? "user" : "assistant";
            const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            setTranscripts((prev) => [
              ...prev,
              {
                id: Math.random().toString(36).slice(2),
                role,
                text: data.text,
                time: nowTime,
                isFinal: true,
              },
            ]);
            if (role === "assistant") setAgentIssue("");
          }
        } catch {
          /* ignore */
        }
      });

      // Remote agent disconnected
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (!participant.isLocal) {
          setPhase("ended");
          void persistSession();
          teardown();
        }
      });

      room.on(RoomEvent.ConnectionQualityChanged, (q, participant) => {
        if (participant?.isLocal) setQuality(q);
      });

      room.on(RoomEvent.Reconnecting, () => setQuality(ConnectionQuality.Lost));
      room.on(RoomEvent.Reconnected, () => setQuality(ConnectionQuality.Good));

      room.on(RoomEvent.Disconnected, () => {
        setPhase("ended");
        void persistSession();
        teardown();
      });

      await room.connect(url, token);
      const micOptions = {
        ...MIC_CAPTURE,
        ...(audioDevices.activeInputId && audioDevices.activeInputId !== "default"
          ? { deviceId: { exact: audioDevices.activeInputId } }
          : {}),
      };
      await room.localParticipant.setMicrophoneEnabled(true, micOptions);

      if (audioDevices.activeOutputId && audioDevices.activeOutputId !== "default") {
        await room.switchActiveDevice("audiooutput", audioDevices.activeOutputId).catch(() => {});
      }
      setPhase("live");

      // Audio analysis visualizer tick
      let lastSpokeAt = 0;
      const tick = () => {
        if (analyserRef.current && orbRef.current) {
          const values = analyserRef.current.calculateVolume();
          const scale = 1 + Math.min(values * 1.4, 0.38);
          orbRef.current.style.transform = `scale(${scale.toFixed(3)})`;
          if (values > 0.08) {
            lastSpokeAt = performance.now();
            setAgentSpeaking(true);
            setAgentHasSpoken(true);
            setWaitingForAgent(false);
          } else if (performance.now() - lastSpokeAt > 350) {
            setAgentSpeaking(false);
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err: any) {
      setPhase("error");
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError" || err?.message?.toLowerCase().includes("permission")) {
        setError("Microphone permission was denied. Please allow microphone access in your browser settings to speak.");
      } else {
        setError(formatClientError(err, "Could not start the call."));
      }
      teardown();
    }
  }, [persistSession, teardown]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted]);

  const end = useCallback(() => {
    void persistSession();
    teardown();
    setPhase("ended");
  }, [persistSession, teardown]);

  const status =
    phase === "connecting"
      ? "Connecting Audio…"
      : phase === "live"
      ? muted
        ? "Microphone Muted"
        : agentSpeaking
        ? "Assistant Speaking…"
        : agentHasSpoken
        ? "Listening to you…"
        : "Assistant is about to greet you…"
      : phase === "ended"
      ? "Call Ended"
      : phase === "error"
      ? "Couldn't connect"
      : "Ready to Talk";

  useEffect(() => {
    if (phase !== "live") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      persistBeacon();
      event.preventDefault();
      event.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", persistBeacon);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", persistBeacon);
    };
  }, [phase, persistBeacon]);

  const stallWarning = useAgentStall(phase === "live" && waitingForAgent && !agentSpeaking);
  const timeWarning =
    phase === "live" && seconds >= 840 && seconds < 900
      ? { text: `1 min left — call ends at 15:00 (${formatDuration(900 - seconds)} remaining)`, detail: "" }
      : phase === "live" && seconds >= 880
      ? { text: `Ending in ${900 - seconds}s — wrap up`, detail: "" }
      : null;
  const networkWarning =
    phase === "live" && agentIssue
      ? agentIssue === "rate_limited"
        ? { text: "Assistant is temporarily busy", detail: "Please try your question again in a moment." }
        : { text: "Assistant is reconnecting", detail: "Please try your question again in a moment." }
      : phase === "live" && quality === ConnectionQuality.Lost
      ? { text: "Reconnecting…", detail: "Your connection dropped." }
      : phase === "live" && quality === ConnectionQuality.Poor
      ? { text: "Weak network", detail: "Audio may break up. Try moving closer to your router." }
      : timeWarning
      ? timeWarning
      : stallWarning;

  return (
    <main className="callscreen-root">
      <div className="callscreen-bg-glow-1" />
      <div className="callscreen-bg-glow-2" />

      {/* Network or stall alert banner */}
      {networkWarning && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 py-2 px-4 text-xs font-semibold text-amber-900 bg-amber-200/90 border-b border-amber-300 backdrop-blur-md z-30 shrink-0"
        >
          <WifiOff size={14} aria-hidden="true" />
          <span>{networkWarning.text}</span>
          <span className="font-normal opacity-85">{networkWarning.detail}</span>
        </div>
      )}

      {/* ── Top Header Bar ────────────────────────────────────────── */}
      <header className="callscreen-header">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-[var(--claude-accent-soft)] border border-[var(--claude-border)] flex items-center justify-center text-[var(--claude-accent)] shrink-0">
            <User size={15} />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-[var(--claude-text)] truncate flex items-center gap-1.5">
              <span className="truncate">{name || "Guest Caller"}</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-[var(--claude-accent-soft)] text-[var(--claude-accent)] border border-[var(--claude-border)] shrink-0">Live HD</span>
            </div>
            <p className="text-[10px] text-[var(--claude-muted)] m-0 truncate">AI Voice Assistant</p>
          </div>
        </div>

        {phase === "live" ? (
          <div className="flex items-center gap-2.5 shrink-0">
            <SignalPill quality={quality} isLive />
            <div className="flex items-center gap-1.5 py-1 px-2.5 rounded-full bg-[var(--claude-surface-2)] border border-[var(--claude-border)] text-xs font-mono font-bold text-[var(--claude-accent)] shadow-xs">
              <span className="w-2 h-2 rounded-full bg-[var(--claude-accent)] animate-ping" />
              <span>{formatDuration(seconds)}</span>
            </div>
          </div>
        ) : phase === "ended" && seconds > 0 ? (
          <div className="text-xs font-semibold text-[var(--claude-muted)] bg-[var(--claude-surface-2)] px-2.5 py-1 rounded-full border border-[var(--claude-border)] shrink-0">
            Duration: {formatDuration(seconds)}
          </div>
        ) : null}
      </header>

      {/* ── Main Viewport Content ─────────────────────────────────── */}
      <div className="callscreen-viewport-content">
        
        {/* ── STATE 1: IDLE / CONNECTING ──────────────────────────── */}
        {(phase === "idle" || phase === "connecting" || phase === "error") && (
          <div className="idle-card-container">
            <div className="inline-flex items-center gap-2 py-1.5 px-4 rounded-full bg-[var(--claude-surface-2)] border border-[var(--claude-border)] text-xs font-semibold text-[var(--claude-text)] shadow-xs">
              <Sparkles size={13} className="text-[var(--claude-accent)]" />
              <span>{status}</span>
            </div>

            <div
              className="voice-orb-wrapper"
              onClick={phase === "idle" ? start : undefined}
              title="Click to start call"
            >
              <div className="voice-orb-3d" />
            </div>

            <p className="text-xs text-[var(--claude-muted)] max-w-xs m-0 leading-relaxed">
              Connect your microphone to speak naturally in real time with the assistant.
            </p>

            {/* Audio Device Selector: Mic & Headphones / Speakers + Live Volume Bar */}
            <div className="w-full max-w-xs text-left">
              <AudioDeviceSelector state={audioDevices} showTitle={false} compact={true} />
            </div>

            {error && (
              <div className="w-full max-w-xs space-y-2">
                <p className="text-xs text-rose-700 bg-rose-50 p-2.5 rounded-xl border border-rose-200 m-0 w-full text-center">
                  {error}
                </p>
                {onSwitchToChat && (
                  <button
                    type="button"
                    onClick={onSwitchToChat}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-4 rounded-xl bg-white border border-[var(--claude-border)] text-xs font-semibold text-[var(--claude-text)] hover:bg-[var(--claude-surface-2)] transition shadow-xs cursor-pointer"
                  >
                    <MessageSquare size={14} className="text-[var(--claude-accent)]" />
                    <span>Type in text chat instead</span>
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={start}
              disabled={phase === "connecting"}
              className="w-full max-w-xs flex items-center justify-center gap-2.5 py-3 px-6 rounded-full text-white text-xs font-bold shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              style={{
                background: "var(--claude-accent, #4854A8)",
                boxShadow: "0 6px 16px rgba(72, 84, 168, 0.3)",
              }}
            >
              <Phone size={15} />
              <span>{phase === "connecting" ? "Connecting Audio…" : "Start Voice Call"}</span>
            </button>
          </div>
        )}

        {/* ── STATE 2: ACTIVE LIVE CALL ───────────────────────────── */}
        {phase === "live" && (
          <div className="live-workspace-grid">
            
            {/* Main Hero Card (Status + Orb + Sound Bars + Self-Contained Symmetrical Controls) */}
            <section className="live-hero-card">
              <div className="inline-flex items-center gap-2 py-1.5 px-4 rounded-full bg-[var(--claude-surface-2)] border border-[var(--claude-border)] text-xs font-semibold text-[var(--claude-text)] shadow-xs">
                <Sparkles size={13} className="text-[var(--claude-accent)]" />
                <span>{status}</span>
              </div>

              {deviceNotice && (
                <div className="inline-flex items-center gap-1.5 py-1 px-3 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold animate-pulse shadow-xs">
                  <Headphones size={13} />
                  <span>{deviceNotice}</span>
                </div>
              )}

              {liveBooking && (
                <div className={`flex items-center gap-2 py-1.5 px-3.5 rounded-xl text-xs font-bold shadow-xs ${liveBooking.type === "booking_failed" ? "bg-rose-50 border border-rose-300 text-rose-800" : liveBooking.type === "booking_pending" ? "bg-amber-50 border border-amber-300 text-amber-800" : "bg-emerald-50 border border-emerald-300 text-emerald-800"}`}>
                  <span>✓</span>
                  <span>{liveBooking.title}</span>
                </div>
              )}

              {/* Center 3D Voice Orb */}
              <div className="voice-orb-wrapper">
                {agentSpeaking && (
                  <>
                    <div className="voice-wave-halo" />
                    <div className="voice-wave-halo delayed" />
                  </>
                )}

                <div
                  ref={orbRef}
                  className={`voice-orb-3d ${agentSpeaking ? "speaking" : ""} ${muted ? "muted" : ""}`}
                />
              </div>

              {/* Waveform visualizer bars */}
              <div className="voice-bars-container">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className={`voice-bar ${agentSpeaking ? "active" : ""}`}
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>

              {/* Symmetrical Control Actions (Directly centered inside the card!) */}
              <div className="live-card-controls-row">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowAudioSettings((v) => !v)}
                    className={`callscreen-pill-btn ${showAudioSettings ? "is-chat-active" : ""}`}
                    title="Microphone & Headphone Settings"
                    aria-label="Audio Devices"
                  >
                    <Headphones size={16} />
                    <span>Audio</span>
                  </button>

                  {showAudioSettings && (
                    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-40 w-72 shadow-2xl animate-in fade-in slide-in-from-bottom-2 text-left">
                      <AudioDeviceSelector state={audioDevices} showTitle={true} compact={false} />
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={toggleMute}
                  className={`callscreen-pill-btn ${muted ? "is-muted" : ""}`}
                  aria-pressed={muted}
                  title={muted ? "Unmute Microphone" : "Mute Microphone"}
                >
                  {muted ? <MicOff size={16} /> : <Mic size={16} />}
                  <span>{muted ? "Unmute" : "Mute"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowMobileDrawer((v) => !v)}
                  className={`callscreen-pill-btn md:hidden ${showMobileDrawer ? "is-chat-active" : ""}`}
                  title="Toggle Transcript"
                >
                  <MessageSquare size={16} />
                  <span>Transcript</span>
                </button>

                <button
                  type="button"
                  onClick={end}
                  className="callscreen-pill-btn is-end"
                  title="Hang up call"
                >
                  <PhoneOff size={16} />
                  <span>End Call</span>
                </button>
              </div>
            </section>

            {/* Live Transcript Card (Desktop side-by-side / Mobile bottom sheet) */}
            <aside className={`live-transcript-card ${showMobileDrawer ? "mobile-drawer-open" : ""}`}>
              {/* Mobile Drag Indicator */}
              <div className="mobile-drawer-handle md:hidden" />

              <div className="transcript-header-bar">
                <div className="flex items-center gap-2">
                  <MessageSquare size={14} className="text-[var(--claude-accent)]" />
                  <span className="font-bold">Live Transcript</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[var(--claude-surface)] text-[var(--claude-muted)] border border-[var(--claude-border)]">
                    {transcripts.length}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {transcripts.length > 0 && (
                    <button
                      type="button"
                      onClick={copyTranscript}
                      className="flex items-center gap-1 text-[11px] font-semibold text-[var(--claude-accent)] hover:underline cursor-pointer bg-[var(--claude-surface)] px-2 py-1 rounded-md border border-[var(--claude-border)]"
                      title="Copy transcript"
                    >
                      {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                      <span>{copied ? "Copied" : "Copy"}</span>
                    </button>
                  )}
                  {showMobileDrawer && (
                    <button
                      type="button"
                      onClick={() => setShowMobileDrawer(false)}
                      className="p-1 rounded text-[var(--claude-muted)] hover:text-[var(--claude-text)] md:hidden cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>

              <div ref={transcriptListRef} className="transcript-message-stream">
                {transcripts.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[var(--claude-muted)] text-xs">
                    <Volume2 size={24} className="mb-2 opacity-40" />
                    <p className="m-0">Speak naturally — your conversation will stream here in real time.</p>
                  </div>
                ) : (
                  transcripts.map((t) => (
                    <div
                      key={t.id}
                      className={t.role === "user" ? "transcript-bubble-user" : "transcript-bubble-assistant"}
                    >
                      <div className="flex items-center justify-between text-[10px] opacity-75 mb-1 font-semibold">
                        <span>{t.role === "user" ? name || "You" : "Assistant"}</span>
                        <span>{t.time}</span>
                      </div>
                      <p className="m-0 text-xs leading-relaxed">
                        {t.text}
                        {!t.isFinal && <span className="opacity-60 animate-pulse"> ●</span>}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </div>
        )}

        {/* ── STATE 3: CALL ENDED RECAP CARD ──────────────────────── */}
        {phase === "ended" && (
          <div className="ended-recap-card">
            <div className="recap-header">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                <span className="font-bold text-xs text-[var(--claude-text)] truncate">Conversation Summary</span>
                <span className="text-[10px] font-mono text-[var(--claude-muted)] bg-[var(--claude-surface)] px-2 py-0.5 rounded-full border border-[var(--claude-border)] shrink-0">
                  {transcripts.length} turns
                </span>
              </div>
              {transcripts.length > 0 && (
                <button
                  type="button"
                  onClick={copyTranscript}
                  className="flex items-center gap-1 text-[11px] font-semibold text-[var(--claude-accent)] hover:underline cursor-pointer bg-[var(--claude-surface)] px-2.5 py-1 rounded-md border border-[var(--claude-border)] shrink-0"
                >
                  {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              )}
            </div>

            <div className="recap-content-stream">
              <p role="status" className="business-muted">{saveState === "saved" ? "Your conversation has been saved." : saveState === "saving" ? "Saving your conversation…" : saveState === "error" ? "We could not confirm the saved transcript. Please retry." : "Call ended."}</p>
              {saveState === "error" && <button type="button" className="business-button secondary" onClick={() => void persistSession()}>Retry saving</button>}
              {transcripts.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[var(--claude-muted)] text-xs">
                  <Volume2 size={24} className="mb-2 opacity-40" />
                  <p className="m-0">No spoken speech recorded for this call.</p>
                </div>
              ) : (
                transcripts.map((t) => (
                  <div
                    key={t.id}
                    className={t.role === "user" ? "transcript-bubble-user" : "transcript-bubble-assistant"}
                  >
                    <div className="flex items-center justify-between text-[10px] opacity-75 mb-1 font-semibold">
                      <span>{t.role === "user" ? name || "You" : "Assistant"}</span>
                      <span>{t.time}</span>
                    </div>
                    <p className="m-0 text-xs leading-relaxed">{t.text}</p>
                  </div>
                ))
              )}
            </div>

            <div className="recap-footer-bar">
              <button
                type="button"
                onClick={start}
                className="flex items-center justify-center gap-2 py-2.5 px-6 rounded-full text-white text-xs font-bold shadow-sm transition-all active:scale-95 cursor-pointer"
                style={{ background: "var(--claude-accent, #4854A8)" }}
              >
                <RotateCcw size={14} />
                <span>Call Again</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
