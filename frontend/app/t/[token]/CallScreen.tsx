"use client";

// The phone-call experience for voice callers: a status line, live timer,
// glowing voice orb, real-time live transcript feed, mute/unmute, and end call button.
// Mobile-first layout — designed for 320px+ screens.

import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, createAudioAnalyser } from "livekit-client";
import type { RemoteAudioTrack, RemoteTrack } from "livekit-client";
import {
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  User,
} from "lucide-react";

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

/* ─────────────────────────── styles (inline) ──────────────────────────── */
const S = {
  main: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column" as const,
    background: "var(--claude-bg)",
    color: "var(--claude-text)",
    fontFamily: "var(--font-sans, system-ui, sans-serif)",
    userSelect: "none" as const,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px 0",
    flexShrink: 0,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 9999,
    border: "1px solid var(--claude-border)",
    background: "var(--claude-surface)",
    color: "var(--claude-text)",
  },
  timer: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 9999,
    background: "var(--claude-surface)",
    color: "var(--claude-accent)",
    border: "1px solid var(--claude-border)",
    fontVariantNumeric: "tabular-nums" as const,
  },
  center: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: "8px 16px",
    minHeight: 0,
    overflow: "hidden",
  },
  statusText: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    textAlign: "center" as const,
    lineHeight: 1.2,
  },
  subText: {
    fontSize: 12,
    color: "var(--claude-muted)",
    textAlign: "center" as const,
    maxWidth: 260,
    lineHeight: 1.5,
  },
  orbWrap: {
    position: "relative" as const,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  subtitle: {
    width: "100%",
    maxWidth: 280,
    padding: "8px 14px",
    borderRadius: 16,
    border: "1px solid var(--claude-border)",
    background: "var(--claude-surface)",
    fontSize: 12,
    lineHeight: 1.5,
    textAlign: "center" as const,
    flexShrink: 0,
  },
  transcriptWrap: {
    width: "100%",
    maxWidth: 340,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  transcriptToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 9999,
    border: "1px solid var(--claude-border)",
    background: "var(--claude-surface)",
    color: "var(--claude-text-2)",
    cursor: "pointer",
    flexShrink: 0,
  },
  transcriptList: {
    width: "100%",
    flex: 1,
    minHeight: 0,
    overflowY: "auto" as const,
    borderRadius: 14,
    border: "1px solid var(--claude-border)",
    background: "var(--claude-surface)",
    padding: 8,
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    marginTop: 6,
    fontSize: 12,
  },
  msgBubble: (isUser: boolean) => ({
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    padding: "6px 10px",
    borderRadius: 12,
    background: isUser ? "var(--claude-accent-soft)" : "var(--claude-bg)",
    border: isUser ? "none" : "1px solid var(--claude-border)",
    marginLeft: isUser ? 24 : 0,
    marginRight: isUser ? 0 : 24,
  }),
  msgMeta: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 10,
    fontWeight: 600,
    color: "var(--claude-muted)",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    padding: "12px 16px 24px",
    flexShrink: 0,
  },
  ctrlBtn: (variant: "mute" | "muted" | "end") => ({
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    width: 56,
    height: 56,
    borderRadius: 9999,
    border:
      variant === "muted"
        ? "1.5px solid #d97706"
        : variant === "end"
        ? "none"
        : "1.5px solid var(--claude-border)",
    background:
      variant === "muted"
        ? "#fef3c7"
        : variant === "end"
        ? "#dc2626"
        : "var(--claude-surface)",
    color: variant === "muted" ? "#92400e" : variant === "end" ? "#fff" : "var(--claude-text)",
    cursor: "pointer",
    fontSize: 10,
    fontWeight: 600,
    transition: "transform 0.12s",
  }),
  startBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "12px 32px",
    borderRadius: 9999,
    fontSize: 14,
    fontWeight: 600,
    color: "#fff",
    background: "var(--claude-accent)",
    border: "none",
    cursor: "pointer",
    transition: "opacity 0.15s",
  },
};

/* ─────────────────────────── component ─────────────────────────────── */

export function CallScreen({ name }: { name?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);

  // Live transcript state
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [currentSubtitle, setCurrentSubtitle] = useState("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);

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

  // Auto scroll transcript to bottom
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts, currentSubtitle]);

  // Save session transcript to backend on call end
  const persistSession = useCallback(async () => {
    const msgs = transcriptsRef.current
      .filter((t) => t.text.trim())
      .map((t) => ({
        role: t.role,
        content: t.text.trim(),
      }));

    if (msgs.length === 0) return;

    try {
      await fetch("/api/v1/voice/record_session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          duration_seconds: secondsRef.current,
          messages: msgs,
        }),
      });
    } catch {
      /* ignore */
    }
  }, []);

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    analyserRef.current?.cleanup().catch(() => {});
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
    setCurrentSubtitle("");
    setPhase("connecting");

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

      // Real-time live transcript handling from LiveKit Room
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        const isLocal = participant?.isLocal ?? false;
        const role: "user" | "assistant" = isLocal ? "user" : "assistant";
        const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        for (const seg of segments) {
          if (!seg.text) continue;
          setCurrentSubtitle(seg.text);

          setTranscripts((prev) => {
            const idx = prev.findIndex((p) => p.id === seg.id);
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

      // Data packets (chat turns / assistant subtitles)
      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const str = new TextDecoder().decode(payload);
          const data = JSON.parse(str);
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
            setCurrentSubtitle(data.text);
          }
        } catch {
          /* ignore */
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        setPhase("ended");
        void persistSession();
        teardown();
      });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setPhase("live");

      const tick = () => {
        const volume = analyserRef.current?.calculateVolume() ?? 0;
        const level = Math.min(1, volume * 3.4);
        if (orbRef.current) {
          orbRef.current.style.transform = `scale(${1 + level * 0.22})`;
        }
        setAgentSpeaking(level > 0.05);
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
      ? "Connecting…"
      : phase === "live"
      ? muted
        ? "Microphone Muted"
        : agentSpeaking
        ? "Assistant Speaking…"
        : "Listening to you…"
      : phase === "ended"
      ? "Call Ended"
      : phase === "error"
      ? "Couldn't connect"
      : "Ready to Talk";

  // Orb size: smaller on mobile
  const orbSize = phase === "live" ? 100 : 120;

  return (
    <main style={S.main}>
      {/* ── Top Bar ─────────────────────────────────────────── */}
      <header style={S.header}>
        {name ? (
          <span style={S.badge}>
            <User size={13} style={{ color: "var(--claude-accent)" }} />
            {name}
          </span>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--claude-muted)" }}>
            Guest Call
          </span>
        )}

        {phase === "live" && (
          <span style={S.timer}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 9999,
                background: "#22c55e",
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
            {formatDuration(seconds)}
          </span>
        )}
      </header>

      {/* ── Center Content ──────────────────────────────────── */}
      <div style={S.center}>
        {/* Status text */}
        <h1 style={S.statusText}>{status}</h1>
        {phase === "idle" && (
          <p style={S.subText}>Tap below to connect your voice with the AI assistant.</p>
        )}
        {error && (
          <p style={{ ...S.subText, color: "#dc2626" }}>{error}</p>
        )}

        {/* Animated Voice Orb */}
        <div style={S.orbWrap}>
          <div
            ref={orbRef}
            className={`call-orb ${phase === "live" ? "is-live" : ""}`}
            style={{ width: orbSize, height: orbSize }}
            aria-hidden="true"
          />
          {agentSpeaking && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 9999,
                border: "2px solid rgba(99,102,241,0.3)",
                animation: "ping 1s cubic-bezier(0,0,0.2,1) infinite",
                pointerEvents: "none",
                width: orbSize,
                height: orbSize,
              }}
            />
          )}
        </div>

        {/* Live subtitle — only when transcript drawer is collapsed */}
        {phase === "live" && currentSubtitle && !showTranscript && (
          <div style={S.subtitle}>
            <span
              style={{
                display: "block",
                fontSize: 10,
                fontWeight: 700,
                color: "var(--claude-accent)",
                marginBottom: 2,
              }}
            >
              {agentSpeaking ? "Assistant:" : "You:"}
            </span>
            <p style={{ margin: 0, fontStyle: "italic", lineHeight: 1.45 }}>
              {currentSubtitle.length > 120
                ? currentSubtitle.slice(-120) + "…"
                : currentSubtitle}
            </p>
          </div>
        )}

        {/* Real-time Transcript Drawer */}
        {phase === "live" && (
          <div style={S.transcriptWrap}>
            <button
              type="button"
              onClick={() => setShowTranscript((v) => !v)}
              style={S.transcriptToggle}
            >
              <MessageSquare size={12} style={{ color: "var(--claude-accent)" }} />
              Transcript ({transcripts.length})
              {showTranscript ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>

            {showTranscript && (
              <div style={S.transcriptList}>
                {transcripts.length === 0 ? (
                  <p
                    style={{
                      textAlign: "center",
                      color: "var(--claude-muted)",
                      padding: "16px 0",
                      fontStyle: "italic",
                      fontSize: 11,
                    }}
                  >
                    Start speaking… your conversation will appear here.
                  </p>
                ) : (
                  transcripts.map((t) => (
                    <div key={t.id} style={S.msgBubble(t.role === "user")}>
                      <div style={S.msgMeta}>
                        <span>{t.role === "user" ? name || "You" : "Assistant"}</span>
                        <span>{t.time}</span>
                      </div>
                      <p style={{ margin: 0, lineHeight: 1.45, color: "var(--claude-text)" }}>
                        {t.text}
                      </p>
                    </div>
                  ))
                )}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom Controls ─────────────────────────────────── */}
      <footer style={S.footer}>
        {phase === "live" ? (
          <>
            <button
              type="button"
              onClick={toggleMute}
              style={S.ctrlBtn(muted ? "muted" : "mute")}
              aria-pressed={muted}
              title={muted ? "Unmute Microphone" : "Mute Microphone"}
            >
              {muted ? <MicOff size={20} /> : <Mic size={20} />}
              <span>{muted ? "Unmute" : "Mute"}</span>
            </button>

            <button
              type="button"
              onClick={end}
              style={S.ctrlBtn("end")}
              title="Hang up call"
            >
              <PhoneOff size={22} />
              <span>End</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={phase === "connecting"}
            style={{
              ...S.startBtn,
              opacity: phase === "connecting" ? 0.5 : 1,
              pointerEvents: phase === "connecting" ? "none" : "auto",
            }}
          >
            <Phone size={16} />
            {phase === "connecting"
              ? "Connecting…"
              : phase === "ended" || phase === "error"
              ? "Call Again"
              : "Start Voice Call"}
          </button>
        )}
      </footer>
    </main>
  );
}
