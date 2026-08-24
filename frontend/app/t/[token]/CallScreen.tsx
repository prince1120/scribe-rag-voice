"use client";

// The phone-call experience for voice callers: a status line, live timer,
// glowing voice orb, real-time live transcript feed, mute/unmute, and end call button.
// Mobile-first layout — designed for 320px+ screens.

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
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  User,
  WifiOff,
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
    maxHeight: "calc(100vh - 200px)",
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
        ? "1.5px solid var(--color-warning)"
        : variant === "end"
        ? "none"
        : "1.5px solid var(--claude-border)",
    background:
      variant === "muted"
        ? "var(--color-warning-soft)"
        : variant === "end"
        ? "#EF4444"
        : "var(--claude-surface)",
    color: variant === "muted" ? "#92400e" : variant === "end" ? "var(--claude-surface)" : "var(--claude-text)",
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
    color: "var(--claude-surface)",
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
  // True from the end of a user turn until the assistant answers.
  const [waitingForAgent, setWaitingForAgent] = useState(false);
  // The assistant greets first. Until it has, the screen must not say
  // "Listening to you" — that invites the caller to start talking over the
  // greeting, and a call that opens with both sides talking never recovers.
  const [agentHasSpoken, setAgentHasSpoken] = useState(false);
  // Reported by LiveKit from real packet loss and jitter on this call. Shown
  // for the same reason WhatsApp does: choppy audio caused by the caller's own
  // network is indistinguishable from a broken assistant unless you say so.
  const [quality, setQuality] = useState<ConnectionQuality>(
    ConnectionQuality.Excellent,
  );

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

    const body = JSON.stringify({
      duration_seconds: secondsRef.current,
      messages: msgs,
    });

    // `keepalive` so the request survives the page going away. A plain fetch is
    // cancelled when the document is torn down, which meant refreshing or
    // closing the tab mid-call silently discarded the whole transcript — the
    // call showed up in the owner's history with nothing in it.
    try {
      await fetch("/api/v1/voice/record_session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        keepalive: true,
        body,
      });
    } catch {
      /* ignore */
    }
  }, []);

  /** Fire-and-forget save for the unload path, where nothing can be awaited.
   *  sendBeacon is queued by the browser and delivered after the page is gone;
   *  it carries same-origin cookies, which is what the session needs. */
  const persistBeacon = useCallback(() => {
    const msgs = transcriptsRef.current
      .filter((t) => t.text.trim())
      .map((t) => ({ role: t.role, content: t.text.trim() }));
    if (msgs.length === 0) return;

    try {
      navigator.sendBeacon?.(
        "/api/v1/voice/record_session",
        new Blob(
          [JSON.stringify({ duration_seconds: secondsRef.current, messages: msgs })],
          { type: "application/json" }
        )
      );
    } catch {
      /* nothing useful to do while the page is being destroyed */
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

      // Real-time live transcript handling from LiveKit Room
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        const isLocal = participant?.isLocal ?? false;
        const role: "user" | "assistant" = isLocal ? "user" : "assistant";
        const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        // Drives the "still thinking" watchdog. A finished user turn starts the
        // clock; anything from the assistant stops it. Transcripts are used
        // rather than audio because they arrive first — the caller should be
        // told the reply is late before the silence has already felt broken.
        if (isLocal) {
          if (segments.some((s) => s.final && s.text)) setWaitingForAgent(true);
        } else if (segments.some((s) => s.text)) {
          setWaitingForAgent(false);
        }

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

      // Only the local participant's quality is actionable by the person
      // holding the phone. The agent's side is our problem, not theirs, and
      // showing it would just be a second bar they cannot act on.
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
      // Stated explicitly rather than left to browser defaults. Echo
      // cancellation matters most: without it, the assistant's own voice comes
      // back through the speaker into the mic, gets transcribed as if the
      // caller said it, and both confuses the reply and triggers false
      // interruptions — heard as the agent talking over itself.
      await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      setPhase("live");

      const tick = () => {
        const volume = analyserRef.current?.calculateVolume() ?? 0;
        const level = Math.min(1, volume * 3.4);
        if (orbRef.current) {
          orbRef.current.style.transform = `scale(${1 + level * 0.22})`;
        }
        const speaking = level > 0.05;
        setAgentSpeaking(speaking);
        if (speaking) setAgentHasSpoken(true);
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
        : agentHasSpoken
        ? "Listening to you…"
        // Connected, but the greeting has not arrived yet. Naming what is
        // about to happen turns an ambiguous silence into an expected one.
        : "Assistant is about to greet you…"
      : phase === "ended"
      ? "Call Ended"
      : phase === "error"
      ? "Couldn't connect"
      : "Ready to Talk";

  // Orb size: smaller on mobile
  // Guard an accidental refresh or tab close during a live call.
  //
  // Refreshing genuinely ends the call — the room connection drops and the
  // worker closes the session on participant disconnect ("closing agent session
  // due to participant disconnect" in its log) — so this is not a cosmetic
  // warning. Cancelling the dialog leaves the call running untouched.
  //
  // The wording is the browser's, not ours: every major browser has ignored
  // custom beforeunload text since ~2017, to stop pages writing scare messages
  // into a native dialog. So this can ask "are you sure" and cannot say "your
  // call is still going". The transcript is saved on the way out regardless,
  // because the caller may well confirm.
  useEffect(() => {
    if (phase !== "live") return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      persistBeacon();
      event.preventDefault();
      // Still assigned for older browsers that require it to show the dialog.
      event.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    // pagehide covers what beforeunload misses on mobile Safari, where a tab
    // can be discarded without beforeunload ever firing.
    window.addEventListener("pagehide", persistBeacon);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", persistBeacon);
    };
  }, [phase, persistBeacon]);

  const orbSize = phase === "live" ? 100 : 120;

  // Two different failures, deliberately kept apart. The first is the WebRTC
  // link; the second is the assistant going quiet, which the link cannot see
  // — a slow LLM or a stalled worker leaves quality at Excellent while the
  // caller hears nothing.
  const stallWarning = useAgentStall(phase === "live" && waitingForAgent && !agentSpeaking);
  const networkWarning =
    phase === "live" && quality === ConnectionQuality.Lost
      ? { text: "Reconnecting…", detail: "Your connection dropped." }
      : phase === "live" && quality === ConnectionQuality.Poor
      ? {
          text: "Weak network",
          detail: "Audio may break up. Try moving closer to your router.",
        }
      // A dropped link is the more urgent thing to say, so it wins.
      : stallWarning;

  return (
    <main style={S.main}>
      {networkWarning && (
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "8px 14px",
            fontSize: 12,
            fontWeight: 600,
            color: "#7c2d12",
            background: "#ffedd5",
            borderBottom: "1px solid #fed7aa",
          }}
        >
          <WifiOff size={14} aria-hidden="true" />
          <span>{networkWarning.text}</span>
          <span style={{ fontWeight: 500, opacity: 0.85 }}>
            {networkWarning.detail}
          </span>
        </div>
      )}

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
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {/* Connection strength sits beside the timer so both read in one
                glance on a phone, and so the caller can tell "my network" from
                "the assistant is stuck" without waiting for a warning. */}
            <SignalPill quality={quality} isLive />
            <span style={S.timer}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 9999,
                  background: "var(--color-success)",
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              />
              {formatDuration(seconds)}
            </span>
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
          <p style={{ ...S.subText, color: "var(--color-danger)" }}>{error}</p>
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
