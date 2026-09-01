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
import { MIC_CAPTURE, useAgentStall } from "../../components/voice/useCallQuality";
import { SignalPill } from "../../components/voice/SignalPill";
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

export function CallScreen({ name }: { name?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [waitingForAgent, setWaitingForAgent] = useState(false);
  const [agentHasSpoken, setAgentHasSpoken] = useState(false);
  const [quality, setQuality] = useState<ConnectionQuality>(
    ConnectionQuality.Excellent,
  );

  // Live transcript state
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);
  const [liveBooking, setLiveBooking] = useState<{ type: string; title: string; date?: string; time?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const transcriptListRef = useRef<HTMLDivElement>(null);

  const roomRef = useRef<Room | null>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const analyserRef = useRef<ReturnType<typeof createAudioAnalyser> | null>(null);
  const audioElsRef = useRef<HTMLAudioElement[]>([]);
  const transcriptsRef = useRef<TranscriptMessage[]>([]);
  const secondsRef = useRef(0);

  transcriptsRef.current = transcripts;
  secondsRef.current = seconds;

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
    const list = transcriptsRef.current;
    if (list.length === 0) return;
    try {
      const pathSegments = window.location.pathname.split("/");
      const token = pathSegments[pathSegments.length - 1];
      if (!token) return;

      await fetch(`/api/v1/contacts/t/${token}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "voice",
          messages: list.map((m) => ({
            role: m.role,
            content: m.text,
            time: m.time,
          })),
          duration_seconds: secondsRef.current,
        }),
      });
    } catch {
      /* ignore persist failure */
    }
  }, []);

  const persistBeacon = useCallback(() => {
    const list = transcriptsRef.current;
    if (list.length === 0) return;
    try {
      const pathSegments = window.location.pathname.split("/");
      const token = pathSegments[pathSegments.length - 1];
      if (!token) return;

      const body = JSON.stringify({
        channel: "voice",
        messages: list.map((m) => ({
          role: m.role,
          content: m.text,
          time: m.time,
        })),
        duration_seconds: secondsRef.current,
      });
      navigator.sendBeacon?.(`/api/v1/contacts/t/${token}/session`, body);
    } catch {
      /* ignore beacon failure */
    }
  }, []);

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    analyserRef.current = null;
    audioElsRef.current.forEach((el) => el.remove());
    audioElsRef.current = [];
    roomRef.current?.disconnect();
    roomRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
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

      // Real-time live transcript handling
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        for (const seg of segments) {
          const role = participant?.isLocal ? "user" : "assistant";
          const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

          if (role === "assistant") {
            setAgentSpeaking(true);
            setAgentHasSpoken(true);
            setWaitingForAgent(false);
          } else {
            setWaitingForAgent(true);
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
          if (data.type === "call_ended" || data.type === "end_call") {
            setPhase("ended");
            void persistSession();
            teardown();
            try { room.disconnect(); } catch {}
            return;
          }
          if (data.type === "booking_confirmed" || data.type === "booking_rescheduled" || data.type === "booking_cancelled") {
            setLiveBooking({
              type: data.type,
              title: data.text || (data.type === "booking_confirmed" ? "Appointment Booked" : data.type === "booking_rescheduled" ? "Appointment Rescheduled" : "Appointment Cancelled"),
              date: data.date,
              time: data.time,
            });
            setTimeout(() => setLiveBooking(null), 8000);
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
      await room.localParticipant.setMicrophoneEnabled(true, MIC_CAPTURE);
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
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Could not start the call.");
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
    phase === "live" && quality === ConnectionQuality.Lost
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

            {error && (
              <p className="text-xs text-rose-700 bg-rose-50 p-2.5 rounded-xl border border-rose-200 m-0 w-full">
                {error}
              </p>
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

              {liveBooking && (
                <div className="flex items-center gap-2 py-1.5 px-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold shadow-xs">
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
