"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, createAudioAnalyser } from "livekit-client";
import type { RemoteTrack, RemoteAudioTrack, Participant, TranscriptionSegment } from "livekit-client";
import { PhoneOff, Mic, MicOff, X, Loader2, AudioLines, Check, Pencil, Play, Square, BookOpen, SlidersHorizontal, Sparkles, Radio, Volume2 } from "lucide-react";
import type { ToastType } from "./Toast";

type CallState = "idle" | "connecting" | "connected" | "error";
type Speaker = "user" | "agent" | null;

// If the agent hasn't produced any audio/transcript within this window after
// we connect, something is wrong server-side (bad Groq key, LLM/TTS down) —
// the browser connects fine in that case, so this timeout is how we notice.
const AGENT_RESPONSE_TIMEOUT_MS = 10000;

// Matches the backend's VoiceTokenRequest.custom_prompt validator — capped
// client-side too so the field never even lets you type past what the
// server would reject.
const MAX_CUSTOM_PROMPT_WORDS = 1000;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function capToWordLimit(text: string, maxWords: number): string {
  const words = text.split(/\s+/);
  return words.length <= maxWords ? text : words.slice(0, maxWords).join(" ");
}

interface TranscriptLine {
  id: string;
  role: "user" | "agent";
  text: string;
  final: boolean;
}

interface VoiceOption {
  id: string;
  label: string;
  tagline: string;
}
type VoiceGroups = { male: VoiceOption[]; female: VoiceOption[] };

interface PersonaOption {
  id: string;
  label: string;
  tagline: string;
}

type Analyser = ReturnType<typeof createAudioAnalyser>;

async function extractErrorDetail(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.detail === "string") return parsed.detail;
  } catch {
    /* not JSON — fall through to raw text */
  }
  return text || `HTTP ${response.status}`;
}

export function VoiceCallModal({
  isOpen,
  onClose,
  apiBase,
  userGroqKey,
  userSarvamKey,
  notify,
  tenantId = "default",
  conversationId,
  hasDocuments = false,
  selectedModel,
  customLlmBaseUrl,
  customLlmApiKey,
  clientId,
  temperature,
  maxTokens,
}: {
  isOpen: boolean;
  onClose: () => void;
  apiBase: string;
  userGroqKey?: string;
  userSarvamKey?: string;
  notify: (message: string, type?: ToastType) => void;
  tenantId?: string;
  conversationId?: string;
  hasDocuments?: boolean;
  selectedModel?: string;
  clientId?: string;
  // Same Settings-panel values text chat sends on QueryRequest — kept in
  // sync so a call sounds as deterministic/verbose as chat answers.
  temperature?: number;
  maxTokens?: number;
  // When set, this session's LLM is a caller-configured OpenAI-compatible
  // endpoint (any provider) instead of Groq — selectedModel above is then
  // the model name on THAT endpoint, not a Groq model id.
  customLlmBaseUrl?: string;
  customLlmApiKey?: string;
}) {
  const [state, setState] = useState<CallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState<Speaker>(null);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [greetOnConnect, setGreetOnConnect] = useState<boolean>(true);
  const [greetingText, setGreetingText] = useState<string>("Hello! How can I help you today?");

  useEffect(() => {
    try {
      const savedGreet = localStorage.getItem("demo_greet_on_connect");
      if (savedGreet !== null) setGreetOnConnect(savedGreet === "true");
      const savedText = localStorage.getItem("demo_greeting_text");
      if (savedText !== null) setGreetingText(savedText);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("demo_greet_on_connect", greetOnConnect ? "true" : "false");
      localStorage.setItem("demo_greeting_text", greetingText);
    } catch {
      /* ignore */
    }
  }, [greetOnConnect, greetingText]);

  type AgentState = "initializing" | "idle" | "listening" | "thinking" | "speaking" | null;
  const [agentState, setAgentState] = useState<AgentState>(null);
  const [activeTab, setActiveTab] = useState<"call" | "sidebar">("call");

  // Voice selection (fetched from the backend so the list always matches
  // what the worker actually supports). Persisted so it sticks between calls.
  const [voices, setVoices] = useState<VoiceGroups>({ male: [], female: [] });
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("voice_tts_speaker") || "";
  });
  const [gender, setGender] = useState<"male" | "female">("male");

  // RAG toggle: on = answer from the user's uploaded documents (same as
  // text chat); off = a plain persona-driven voice bot. Persona picker is
  // only meaningful when RAG is off. Defaults to on only if docs exist, and
  // is derived (not synced via effect) so it can never be true with no docs.
  const [ragEnabledPref, setRagEnabledPref] = useState(false);
  const ragEnabled = ragEnabledPref && hasDocuments;
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<string>(() => {
    if (typeof window === "undefined") return "assistant";
    return localStorage.getItem("voice_persona") || "assistant";
  });
  const [customPrompt, setCustomPrompt] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("voice_custom_prompt") || "";
  });

  const choosePersona = (id: string) => {
    setSelectedPersona(id);
    if (typeof window !== "undefined") localStorage.setItem("voice_persona", id);
  };

  const updateCustomPrompt = (text: string) => {
    const capped = capToWordLimit(text, MAX_CUSTOM_PROMPT_WORDS);
    setCustomPrompt(capped);
    if (typeof window !== "undefined") localStorage.setItem("voice_custom_prompt", capped);
  };

  // Custom prompt is edited in its own overlay rather than inline in the
  // sidebar — a full screen to write in, Save commits it, Cancel discards
  // the draft. `draftPrompt` is separate from `customPrompt` so Cancel never
  // loses what was already saved.
  const [customPromptModalOpen, setCustomPromptModalOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState("");

  const openCustomPromptEditor = () => {
    setDraftPrompt(customPrompt);
    setCustomPromptModalOpen(true);
  };

  const updateDraftPrompt = (text: string) => {
    setDraftPrompt(capToWordLimit(text, MAX_CUSTOM_PROMPT_WORDS));
  };

  const saveCustomPrompt = () => {
    updateCustomPrompt(draftPrompt);
    setCustomPromptModalOpen(false);
  };

  const roomRef = useRef<Room | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const localAnalyserRef = useRef<Analyser | null>(null);
  const agentAnalyserRef = useRef<Analyser | null>(null);
  const rafRef = useRef<number>(0);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gotAgentResponseRef = useRef(false);

  const clearWatchdog = () => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  // Called the moment the agent produces anything (audio or transcript) — it
  // means the server-side pipeline (Groq LLM + Sarvam TTS) is alive.
  const markAgentAlive = () => {
    gotAgentResponseRef.current = true;
    clearWatchdog();
  };

  // Drive the orb from *real* audio volume (not binary speaking/idle) via a
  // rAF loop that writes straight to the DOM node — never setState per frame,
  // which would thrash React 60×/sec.
  const runVolumeLoop = () => {
    const tick = () => {
      const u = localAnalyserRef.current?.calculateVolume() ?? 0;
      const a = agentAnalyserRef.current?.calculateVolume() ?? 0;
      const vol = Math.max(u, a);
      const boosted = Math.min(1, vol * 3.4);

      if (orbRef.current) {
        orbRef.current.style.transform = `scale(${1 + boosted * 0.22})`;
      }
      if (glowRef.current) {
        glowRef.current.style.opacity = String(0.18 + boosted * 0.62);
        glowRef.current.style.transform = `scale(${1 + boosted * 0.5})`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const teardown = () => {
    cancelAnimationFrame(rafRef.current);
    clearWatchdog();
    localAnalyserRef.current?.cleanup().catch(() => { });
    agentAnalyserRef.current?.cleanup().catch(() => { });
    localAnalyserRef.current = null;
    agentAnalyserRef.current = null;
    roomRef.current?.disconnect();
    roomRef.current = null;
    setActiveSpeaker(null);
    setAgentState(null);
    setActiveTab("call");
    setMuted(false);
  };

  const handleClose = () => {
    teardown();
    setState("idle");
    setError(null);
    setTranscript([]);
    onClose();
  };

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      roomRef.current?.disconnect();
    };
  }, []);

  // Auto-scroll the transcript as lines stream / update in place.
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript]);

  // Fetch the supported voice list once the panel opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch(`${apiBase}/voice/voices`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.voices) return;
        setVoices(data.voices);
        // Seed a default selection if none saved yet.
        setSelectedVoice((cur) => cur || data.default || data.voices.male?.[0]?.id || "");
        // Open on the tab that holds the current selection.
        const saved = localStorage.getItem("voice_tts_speaker") || data.default;
        if (data.voices.female?.some((v: VoiceOption) => v.id === saved)) setGender("female");
      })
      .catch(() => {
        /* non-fatal — the picker just won't show; call still works on default */
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, apiBase]);

  // Fetch the persona list once the panel opens (only shown/used when RAG
  // is off, but cheap enough to fetch alongside voices either way).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch(`${apiBase}/voice/personas`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.personas) setPersonas(data.personas);
      })
      .catch(() => {
        /* non-fatal — persona picker just won't show; default persona still used */
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, apiBase]);

  const chooseVoice = (id: string) => {
    setSelectedVoice(id);
    if (typeof window !== "undefined") localStorage.setItem("voice_tts_speaker", id);
  };

  // Voice preview ("hear this voice before picking it"). One shared <audio>
  // element so starting a new preview always stops whatever was playing;
  // fetched samples are cached per voice id for the life of this modal so
  // re-clicking the same voice doesn't re-hit Sarvam.
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewCacheRef = useRef<Map<string, string>>(new Map());
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [previewPlayingId, setPreviewPlayingId] = useState<string | null>(null);

  const stopPreview = () => {
    const el = previewAudioRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    setPreviewPlayingId(null);
  };

  const playPreview = async (voiceId: string) => {
    if (previewPlayingId === voiceId) {
      stopPreview();
      return;
    }
    if (!userSarvamKey) {
      notify("Add your Sarvam API key above to preview voices.", "error");
      return;
    }
    stopPreview();

    const cached = previewCacheRef.current.get(voiceId);
    if (cached) {
      const el = previewAudioRef.current;
      if (el) {
        el.src = cached;
        setPreviewPlayingId(voiceId);
        el.play().catch(() => setPreviewPlayingId(null));
      }
      return;
    }

    setPreviewLoadingId(voiceId);
    try {
      const res = await fetch(`${apiBase}/voice/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Sarvam-Key": userSarvamKey,
        },
        body: JSON.stringify({ speaker: voiceId }),
      });
      if (!res.ok) throw new Error(await extractErrorDetail(res));
      const { audio_base64, mime_type } = await res.json();
      const dataUrl = `data:${mime_type || "audio/mpeg"};base64,${audio_base64}`;
      previewCacheRef.current.set(voiceId, dataUrl);
      const el = previewAudioRef.current;
      if (el) {
        el.src = dataUrl;
        setPreviewPlayingId(voiceId);
        el.play().catch(() => setPreviewPlayingId(null));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't preview that voice";
      notify(msg, "error");
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const startCall = async () => {
    setState("connecting");
    setError(null);
    setTranscript([]);
    gotAgentResponseRef.current = false;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (userGroqKey) headers["X-User-Groq-Key"] = userGroqKey;
      if (userSarvamKey) headers["X-User-Sarvam-Key"] = userSarvamKey;
      if (clientId) headers["X-Client-Id"] = clientId;
      if (customLlmBaseUrl && customLlmApiKey) headers["X-User-Custom-LLM-Key"] = customLlmApiKey;
      const res = await fetch(`${apiBase}/voice/token`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...(selectedVoice ? { tts_speaker: selectedVoice } : {}),
          rag_enabled: ragEnabled,
          ...(ragEnabled ? {} : { persona: selectedPersona, custom_prompt: customPrompt }),
          tenant_id: tenantId,
          ...(conversationId ? { conversation_id: conversationId } : {}),
          llm_model: selectedModel,
          ...(typeof temperature === "number" ? { temperature } : {}),
          ...(typeof maxTokens === "number" ? { max_tokens: maxTokens } : {}),
          ...(customLlmBaseUrl ? { custom_llm_base_url: customLlmBaseUrl } : {}),
          greet_on_connect: greetOnConnect,
          greeting_text: greetingText,
        }),
      });
      if (!res.ok) throw new Error(await extractErrorDetail(res));
      const { url, token } = await res.json();

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) return;
        markAgentAlive(); // agent is publishing audio → server pipeline is healthy
        const el = track.attach();
        el.autoplay = true;
        el.style.display = "none";
        document.body.appendChild(el);
        // Analyser on the agent's voice → drives the orb while it speaks.
        try {
          const analyser = createAudioAnalyser(track as RemoteAudioTrack, {
            smoothingTimeConstant: 0.6,
          });
          (analyser.analyser.context as AudioContext).resume?.().catch(() => { });
          agentAnalyserRef.current = analyser;
        } catch {
          /* analyser is a nicety, not required for the call to work */
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove());
        agentAnalyserRef.current?.cleanup().catch(() => { });
        agentAnalyserRef.current = null;
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        if (speakers.some((p) => !p.isLocal)) setActiveSpeaker("agent");
        else if (speakers.some((p) => p.isLocal)) setActiveSpeaker("user");
        else setActiveSpeaker(null);
      });

      const handleAttributesChanged = (changedAttributes: Record<string, string>, participant: Participant) => {
        if (participant.isLocal) return;
        const stateAttr = participant.attributes["lk.agent.state"];
        if (stateAttr) {
          setAgentState(stateAttr as AgentState);
        }
      };

      room.on(RoomEvent.ParticipantAttributesChanged, handleAttributesChanged);

      room.on(RoomEvent.ParticipantConnected, (p: Participant) => {
        const stateAttr = p.attributes["lk.agent.state"];
        if (stateAttr) {
          setAgentState(stateAttr as AgentState);
        }
      });

      // Both the user's live STT transcript and the agent's streamed
      // response arrive here (on by default in the Agents framework).
      room.on(
        RoomEvent.TranscriptionReceived,
        (segments: TranscriptionSegment[], participant?: Participant) => {
          const role: "user" | "agent" = participant?.isLocal ? "user" : "agent";
          if (role === "agent") markAgentAlive();
          setTranscript((prev) => {
            const next = [...prev];
            for (const seg of segments) {
              if (!seg.text) continue;
              const idx = next.findIndex((l) => l.id === seg.id);
              const line: TranscriptLine = { id: seg.id, role, text: seg.text, final: seg.final };
              if (idx >= 0) next[idx] = line;
              else next.push(line);
            }
            return next;
          });
        }
      );

      room.on(RoomEvent.Disconnected, () => {
        // If the agent never responded and we didn't hang up on purpose, the
        // session likely failed server-side (bad key / service down). Name
        // whichever LLM key is actually in play — Groq by default, or the
        // custom endpoint's key when one is configured — so the message
        // doesn't blame Groq for a Mistral/OpenRouter/etc. key problem.
        if (!gotAgentResponseRef.current && roomRef.current) {
          const keyName = customLlmBaseUrl ? "your custom model's API key" : "your Groq API key";
          notify(
            `The voice session ended unexpectedly. ${keyName} may be invalid, or a service is temporarily unavailable.`,
            "error"
          );
        }
        teardown();
        setState("idle");
      });

      await room.connect(url, token);

      // Scan existing participants for state attribute immediately after connecting
      for (const p of room.remoteParticipants.values()) {
        const stateAttr = p.attributes["lk.agent.state"];
        if (stateAttr) {
          setAgentState(stateAttr as AgentState);
        }
      }

      await room.localParticipant.setMicrophoneEnabled(true);

      // Analyser on the mic → orb reacts to the user's voice too.
      const micTrack = room.localParticipant.getTrackPublication(
        Track.Source.Microphone
      )?.audioTrack;
      if (micTrack) {
        try {
          const analyser = createAudioAnalyser(micTrack, { smoothingTimeConstant: 0.6 });
          (analyser.analyser.context as AudioContext).resume?.().catch(() => { });
          localAnalyserRef.current = analyser;
        } catch {
          /* non-fatal */
        }
      }

      // Watchdog: if the agent produces nothing within the window, surface a
      // clear reason (the browser connected fine, so the failure is server-side).
      watchdogRef.current = setTimeout(() => {
        if (!gotAgentResponseRef.current) {
          const keyName = customLlmBaseUrl ? "your custom model's API key" : "your Groq API key";
          notify(
            `The assistant isn't responding. Double-check ${keyName} is valid; otherwise a service may be temporarily down.`,
            "error"
          );
        }
      }, AGENT_RESPONSE_TIMEOUT_MS);

      runVolumeLoop();
      setState("connected");
    } catch (e) {
      console.error("Voice call error:", e);
      const msg = e instanceof Error ? e.message : "Failed to start the voice call";
      setError(msg);
      setState("error");
      notify(msg, "error");
      teardown();
    }
  };

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  };

  if (!isOpen) return null;

  const agentActive = agentState === "speaking" || activeSpeaker === "agent";
  const agentThinking = agentState === "thinking";
  const userActive = agentState === "listening" || activeSpeaker === "user";
  const live = state === "connected";

  const statusLabel = !live
    ? state === "connecting"
      ? "Connecting"
      : state === "error"
        ? "Couldn't connect"
        : "Ready when you are"
    : agentActive
      ? "Speaking"
      : agentThinking
        ? "Thinking…"
        : muted
          ? "Muted"
          : "Listening";

  const subLabel = !live
    ? state === "connecting"
      ? "Setting up your voice space…"
      : state === "error"
        ? error || "Something went wrong"
        : "Talk naturally — interrupt any time"
    : agentActive
      ? "Your assistant is responding"
      : agentThinking
        ? "Formulating a response…"
        : muted
          ? "Your mic is off — tap the mic to resume"
          : "Go ahead, I'm listening";

  // Palette shifts with who holds the floor: indigo when the agent speaks,
  // warm gold when thinking, warm neutral otherwise.
  const orbCore = agentActive
    ? "var(--claude-accent)"
    : agentThinking
      ? "#d4a73b"
      : "#6b74bd";

  return (
    <div
      className="voice-overlay-enter fixed inset-0 z-50 flex flex-col"
      style={{
        background: agentActive
          ? "radial-gradient(120% 120% at 50% 38%, #E7E9F6 0%, var(--claude-bg) 62%)"
          : agentThinking
            ? "radial-gradient(120% 120% at 50% 38%, #FDF9E2 0%, var(--claude-bg) 62%)"
            : "radial-gradient(120% 120% at 50% 40%, var(--claude-surface) 0%, var(--claude-bg) 65%)",
        transition: "background 0.9s ease",
      }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 h-16 flex-shrink-0 border-b" style={{ borderColor: "var(--claude-border)" }}>
        <div className="flex items-center gap-2.5" style={{ color: "var(--claude-muted)" }}>
          <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-[var(--claude-accent-soft)]">
            <AudioLines className="w-3.5 h-3.5" style={{ color: "var(--claude-accent)" }} />
          </div>
          <span className="font-serif-display text-[16px] font-normal tracking-wide text-[var(--claude-text)]">
            Voice Studio
          </span>
        </div>

        {/* Mobile Tab Switcher */}
        <div className="flex md:hidden items-center gap-1 p-0.5 rounded-full" style={{ background: "var(--claude-surface-2)", border: "1px solid var(--claude-border)" }}>
          <button
            key="call"
            type="button"
            onClick={() => setActiveTab("call")}
            className="px-3.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider transition-all duration-200"
            style={{
              background: activeTab === "call" ? "var(--claude-accent)" : "transparent",
              color: activeTab === "call" ? "#fff" : "var(--claude-text-2)",
            }}
          >
            Call
          </button>
          <button
            key="sidebar"
            type="button"
            onClick={() => setActiveTab("sidebar")}
            className="px-3.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider transition-all duration-200"
            style={{
              background: activeTab === "sidebar" ? "var(--claude-accent)" : "transparent",
              color: activeTab === "sidebar" ? "#fff" : "var(--claude-text-2)",
            }}
          >
            {live ? "Transcript" : "Setup"}
          </button>
        </div>

        <button
          type="button"
          onClick={handleClose}
          aria-label="Close voice call"
          className="w-9 h-9 rounded-full inline-flex items-center justify-center transition-colors cursor-pointer"
          style={{ color: "var(--claude-muted)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--claude-surface-2)";
            e.currentTarget.style.color = "var(--claude-text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--claude-muted)";
          }}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main area */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        {/* Left column */}
        <div className={`flex-1 min-h-0 flex flex-col ${activeTab === "call" ? "flex" : "hidden md:flex"}`}>
          {/* Orb stage */}
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-8 px-6 py-4">
            <div className="relative flex items-center justify-center" style={{ width: 240, height: 240 }}>
              {/* Ripples */}
              {live && (agentActive || (userActive && !muted)) && (
                <>
                  <span
                    className="voice-ripple absolute rounded-full"
                    style={{ width: 200, height: 200, border: `1px solid ${orbCore}` }}
                  />
                  <span
                    className="voice-ripple-2 absolute rounded-full"
                    style={{ width: 200, height: 200, border: `1px solid ${orbCore}` }}
                  />
                </>
              )}

              {/* Soft outer glow */}
              <div
                ref={glowRef}
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{
                  background: `radial-gradient(circle, ${orbCore}55 0%, transparent 68%)`,
                  filter: "blur(14px)",
                  opacity: 0.2,
                  transition: "background 0.9s ease",
                }}
              />

              {/* The orb itself */}
              <div
                ref={orbRef}
                className="voice-orb-enter relative rounded-full overflow-hidden shadow-2xl"
                style={{
                  width: 176,
                  height: 176,
                  transition: "transform 0.08s ease-out",
                  boxShadow: `0 20px 60px -12px ${orbCore}66, inset 0 0 40px rgba(255,255,255,0.35)`,
                }}
              >
                {/* Base sheen */}
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: `radial-gradient(circle at 34% 30%, #ffffff 0%, ${orbCore}cc 46%, ${orbCore} 100%)`,
                    transition: "background 0.9s ease",
                  }}
                />
                {/* Drifting inner blobs */}
                <div className={`absolute rounded-full voice-blob-a ${live ? "" : "voice-breathe"}`}
                  style={{
                    width: "70%", height: "70%", top: "8%", left: "6%",
                    background: "radial-gradient(circle, rgba(255,255,255,0.9) 0%, transparent 70%)", filter: "blur(6px)"
                  }} />
                <div className="absolute rounded-full voice-blob-b"
                  style={{
                    width: "60%", height: "60%", bottom: "6%", right: "8%",
                    background: `radial-gradient(circle, ${orbCore} 0%, transparent 72%)`, filter: "blur(8px)", mixBlendMode: "overlay"
                  }} />
                <div className="absolute rounded-full voice-blob-c"
                  style={{
                    width: "50%", height: "50%", top: "24%", right: "18%",
                    background: "radial-gradient(circle, rgba(255,255,255,0.7) 0%, transparent 70%)", filter: "blur(7px)"
                  }} />

                {/* Center state icon */}
                <div className="absolute inset-0 flex items-center justify-center">
                  {state === "connecting" ? (
                    <Loader2 className="w-8 h-8 animate-spin text-white/90" />
                  ) : agentThinking ? (
                    <Loader2 className="w-8 h-8 animate-spin text-white/90" />
                  ) : live && !agentActive && !muted ? (
                    <div className="flex items-end gap-1 h-7">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className="voice-eq-bar"
                          style={{ height: "100%", animationDelay: `${i * 0.12}s`, background: "rgba(255,255,255,0.95)" }}
                        />
                      ))}
                    </div>
                  ) : muted && live ? (
                    <MicOff className="w-8 h-8 text-white/90" />
                  ) : (
                    <Mic className="w-8 h-8 text-white/90" />
                  )}
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="flex flex-col items-center gap-2 text-center">
              <p
                className="font-serif-display text-[32px] sm:text-[36px] leading-tight font-normal tracking-tight"
                style={{ color: state === "error" ? "#c0392b" : "var(--claude-text)" }}
              >
                {statusLabel}
              </p>
              <p className="text-[13px] max-w-xs leading-relaxed" style={{ color: "var(--claude-muted)" }}>
                {subLabel}
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-4 h-24 flex-shrink-0">
            {live ? (
              <>
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute" : "Mute"}
                  title={muted ? "Unmute" : "Mute"}
                  className="w-14 h-14 rounded-full inline-flex items-center justify-center border transition-all cursor-pointer hover:scale-105 active:scale-95"
                  style={{
                    borderColor: "var(--claude-border-strong)",
                    background: muted ? "var(--claude-bubble)" : "var(--claude-surface)",
                    color: muted ? "#F5F3EB" : "var(--claude-text-2)",
                  }}
                >
                  {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="End call"
                  title="End call"
                  className="h-14 px-7 rounded-full inline-flex items-center gap-2 text-white text-sm font-medium transition-transform hover:scale-[1.03] active:scale-95 cursor-pointer"
                  style={{ background: "#c0392b", boxShadow: "0 10px 30px -8px rgba(192,57,43,0.5)" }}
                >
                  <PhoneOff className="w-5 h-5" />
                  End call
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startCall}
                disabled={state === "connecting"}
                className="h-14 px-8 rounded-full inline-flex items-center gap-2.5 text-white text-[15px] font-medium transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-60 disabled:hover:scale-100 cursor-pointer shadow-lg"
                style={{ background: "var(--claude-accent)", boxShadow: "0 12px 34px -8px var(--claude-accent)" }}
              >
                {state === "connecting" ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <AudioLines className="w-5 h-5" />
                )}
                {state === "error" ? "Try again" : "Start conversation"}
              </button>
            )}
          </div>
        </div>

        {/* Shared player for voice preview samples */}
        <audio ref={previewAudioRef} onEnded={() => setPreviewPlayingId(null)} style={{ display: "none" }} />

        {/* ---- Side panel ---- */}
        {!live ? (
          <aside
            className={`w-full md:w-[380px] flex-1 min-h-0 md:flex-initial flex-shrink-0 border-t md:border-t-0 md:border-l overflow-y-auto px-5 py-6 pb-16 flex flex-col gap-6 ${activeTab === "sidebar" ? "flex" : "hidden md:flex"}`}
            style={{
              borderColor: "var(--claude-border)",
              background: "rgba(250, 249, 245, 0.65)",
              backdropFilter: "blur(12px)",
            }}
          >
            <div className="border-b pb-3.5" style={{ borderColor: "var(--claude-border)" }}>
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-[var(--claude-accent)]" />
                <h3
                  className="font-serif-display text-[22px] font-normal leading-tight"
                  style={{ color: "var(--claude-text)" }}
                >
                  Set up your call
                </h3>
              </div>
              <p className="text-[12px] mt-1" style={{ color: "var(--claude-muted)" }}>
                Choose how the assistant behaves and sounds.
              </p>
            </div>

            {/* Greeting configuration panel */}
            <div className="flex flex-col gap-2">
              <span
                className="text-[11px] uppercase tracking-wider font-semibold"
                style={{ color: "var(--claude-muted)" }}
              >
                Greeting behavior
              </span>
              <div
                className="rounded-xl border px-3 py-3.5 flex flex-col gap-3.5"
                style={{
                  borderColor: "var(--claude-border)",
                  background: "var(--claude-surface)",
                }}
              >
                {/* Toggle */}
                <div className="flex items-center justify-between">
                  <div className="text-left pr-2">
                    <div className="text-[12px] font-semibold" style={{ color: "var(--claude-text)" }}>
                      AI greets first
                    </div>
                    <div className="text-[10px]" style={{ color: "var(--claude-muted)" }}>
                      Speak opening phrase when call connects
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setGreetOnConnect((v) => !v)}
                    className="relative flex-shrink-0 w-10 h-6 rounded-full transition-colors overflow-hidden cursor-pointer"
                    style={{ background: greetOnConnect ? "var(--claude-accent)" : "var(--claude-border-strong)" }}
                  >
                    <span
                      className="absolute left-0 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                      style={{ transform: greetOnConnect ? "translateX(18px)" : "translateX(2px)" }}
                    />
                  </button>
                </div>

                {/* Static message input */}
                {greetOnConnect && (
                  <div className="flex flex-col gap-1.5 pt-3.5 border-t" style={{ borderColor: "var(--claude-border)" }}>
                    <label className="text-[11px] font-medium" style={{ color: "var(--claude-text-2)" }}>
                      Greeting Message
                    </label>
                    <input
                      type="text"
                      value={greetingText}
                      onChange={(e) => setGreetingText(e.target.value)}
                      placeholder="Type greeting, e.g. Hi, how are you?"
                      className="w-full rounded-lg border px-2.5 py-1.5 text-[11px] outline-none transition-all"
                      style={{
                        borderColor: "var(--claude-border)",
                        background: "var(--claude-bg)",
                        color: "var(--claude-text)",
                      }}
                    />
                    <p className="text-[9px]" style={{ color: "var(--claude-muted)" }}>
                      Plays instantly (skips LLM pass) for zero startup delay.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* RAG toggle */}
            <button
              type="button"
              onClick={() => hasDocuments && setRagEnabledPref((v) => !v)}
              disabled={!hasDocuments}
              title={hasDocuments ? undefined : "Upload a document in chat to enable this"}
              className="w-full flex items-center justify-between rounded-xl border px-3.5 py-3 transition-colors disabled:cursor-not-allowed"
              style={{
                borderColor: ragEnabled ? "var(--claude-accent)" : "var(--claude-border)",
                background: ragEnabled ? "var(--claude-accent-soft)" : "var(--claude-surface)",
                opacity: hasDocuments ? 1 : 0.55,
              }}
            >
              <div className="text-left min-w-0 pr-2">
                <div className="text-[13px] font-semibold" style={{ color: "var(--claude-text)" }}>
                  Talk with my documents
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: "var(--claude-muted)" }}>
                  {hasDocuments
                    ? ragEnabled
                      ? "On — grounded in your sources"
                      : "Off — plain voice bot"
                    : "No documents uploaded yet"}
                </div>
              </div>
              <span
                className="relative flex-shrink-0 w-10 h-6 rounded-full transition-colors overflow-hidden"
                style={{ background: ragEnabled ? "var(--claude-accent)" : "var(--claude-border-strong)" }}
              >
                <span
                  className="absolute left-0 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                  style={{ transform: ragEnabled ? "translateX(18px)" : "translateX(2px)" }}
                />
              </span>
            </button>

            {/* Personality — vertical list, only when RAG is off */}
            {!ragEnabled && personas.length > 0 && (
              <div className="flex flex-col gap-2">
                <span
                  className="text-[11px] uppercase tracking-wider font-semibold"
                  style={{ color: "var(--claude-muted)" }}
                >
                  Personality
                </span>
                <div className="flex flex-col gap-1.5">
                  {personas.map((p) => {
                    const active = p.id === selectedPersona;
                    const isCustom = p.id === "custom";
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          choosePersona(p.id);
                          if (isCustom) openCustomPromptEditor();
                        }}
                        className="w-full text-left rounded-xl border px-3 py-2 transition-all flex items-center justify-between gap-2"
                        style={{
                          borderColor: active ? "var(--claude-accent)" : "var(--claude-border)",
                          background: active ? "var(--claude-accent-soft)" : "var(--claude-surface)",
                        }}
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold" style={{ color: "var(--claude-text)" }}>
                            {p.label}
                          </div>
                          <div
                            className="text-[11px] mt-0.5 truncate"
                            style={{ color: "var(--claude-muted)" }}
                          >
                            {isCustom && customPrompt ? customPrompt : p.tagline}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isCustom && active && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                openCustomPromptEditor();
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  openCustomPromptEditor();
                                }
                              }}
                              title="Edit your prompt"
                              aria-label="Edit your prompt"
                              className="w-6 h-6 inline-flex items-center justify-center rounded-md transition-colors"
                              style={{ color: "var(--claude-accent)" }}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </span>
                          )}
                          {active && (
                            <Check className="w-4 h-4" style={{ color: "var(--claude-accent)" }} />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Voice — gender toggle + vertical list */}
            {(voices.male.length > 0 || voices.female.length > 0) && (
              <div className="flex flex-col gap-2">
                <span
                  className="text-[11px] uppercase tracking-wider font-semibold"
                  style={{ color: "var(--claude-muted)" }}
                >
                  Voice
                </span>
                <div
                  className="inline-flex self-start rounded-full p-1 gap-1"
                  style={{ background: "var(--claude-surface-2)", border: "1px solid var(--claude-border)" }}
                >
                  {(["male", "female"] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGender(g)}
                      className="px-4 h-7 rounded-full text-[12px] font-medium capitalize transition-colors"
                      style={{
                        background: gender === g ? "var(--claude-accent)" : "transparent",
                        color: gender === g ? "#fff" : "var(--claude-text-2)",
                      }}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-1.5">
                  {voices[gender].map((v) => {
                    const active = v.id === selectedVoice;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => chooseVoice(v.id)}
                        className="w-full text-left rounded-xl border px-3 py-2 transition-all flex items-center justify-between gap-2"
                        style={{
                          borderColor: active ? "var(--claude-accent)" : "var(--claude-border)",
                          background: active ? "var(--claude-accent-soft)" : "var(--claude-surface)",
                        }}
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-semibold" style={{ color: "var(--claude-text)" }}>
                            {v.label}
                          </div>
                          <div className="text-[11px] mt-0.5" style={{ color: "var(--claude-muted)" }}>
                            {v.tagline}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              playPreview(v.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.stopPropagation();
                                playPreview(v.id);
                              }
                            }}
                            title={previewPlayingId === v.id ? "Stop preview" : "Hear this voice"}
                            aria-label={previewPlayingId === v.id ? "Stop preview" : "Hear this voice"}
                            className="w-6 h-6 inline-flex items-center justify-center rounded-md transition-colors"
                            style={{ color: "var(--claude-accent)" }}
                          >
                            {previewLoadingId === v.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : previewPlayingId === v.id ? (
                              <Square className="w-3.5 h-3.5" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}
                          </span>
                          {active && (
                            <Check className="w-4 h-4" style={{ color: "var(--claude-accent)" }} />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

          </aside>
        ) : (
          <aside
            className={`w-full md:w-[380px] flex-1 min-h-0 md:flex-initial flex-shrink-0 border-t md:border-t-0 md:border-l overflow-y-auto px-4 py-4 flex flex-col gap-2 ${activeTab === "sidebar" ? "flex" : "hidden md:flex"}`}
            style={{
              borderColor: "var(--claude-border)",
              background: "rgba(250, 249, 245, 0.55)",
              backdropFilter: "blur(8px)",
            }}
          >
            {transcript.length === 0 ? (
              <p className="text-[12px] text-center py-4" style={{ color: "var(--claude-muted)" }}>
                Your conversation will appear here…
              </p>
            ) : (
              transcript.map((line) => (
                <div
                  key={line.id}
                  className={`voice-line-enter max-w-[88%] px-3 py-1.5 rounded-xl text-[13px] leading-snug ${line.role === "user" ? "self-end" : "self-start"
                    } ${!line.final ? "voice-caret opacity-90" : ""}`}
                  style={{
                    background:
                      line.role === "user" ? "var(--claude-bubble)" : "var(--claude-accent-soft)",
                    color: line.role === "user" ? "#F5F3EB" : "var(--claude-text)",
                  }}
                >
                  {line.text}
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </aside>
        )}
      </div>

      {/* Custom prompt editor — its own full screen instead of an inline
          textarea, so the sidebar stays short and scannable. Save commits
          and closes; Cancel discards the draft and closes, leaving whatever
          was previously saved untouched. */}
      {customPromptModalOpen && (
        <>
          <div
            onClick={() => setCustomPromptModalOpen(false)}
            className="fixed inset-0 z-[70]"
            style={{ background: "rgba(20, 20, 18, 0.45)" }}
          />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div
              className="w-full max-w-lg rounded-xl shadow-2xl flex flex-col"
              style={{ background: "var(--claude-bg)", border: "1px solid var(--claude-border)" }}
            >
              <div
                className="h-14 px-5 flex items-center justify-between border-b flex-shrink-0"
                style={{ borderColor: "var(--claude-border)" }}
              >
                <span className="text-[14px] font-semibold" style={{ color: "var(--claude-text)" }}>
                  Custom prompt
                </span>
                <button
                  type="button"
                  onClick={() => setCustomPromptModalOpen(false)}
                  aria-label="Close"
                  className="w-8 h-8 rounded-md inline-flex items-center justify-center transition-colors"
                  style={{ color: "var(--claude-muted)" }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-5 py-4 flex flex-col gap-2">
                <label className="text-[12px]" style={{ color: "var(--claude-muted)" }}>
                  Describe how the assistant should act — this replaces the
                  built-in personalities entirely.
                </label>
                <textarea
                  value={draftPrompt}
                  onChange={(e) => updateDraftPrompt(e.target.value)}
                  placeholder="Act as… (e.g. a patient tutor who explains things simply)"
                  rows={8}
                  autoFocus
                  className="w-full rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed outline-none resize-none"
                  style={{
                    borderColor: "var(--claude-border)",
                    background: "var(--claude-surface)",
                    color: "var(--claude-text)",
                  }}
                />
                <span
                  className="self-end text-[11px]"
                  style={{
                    color:
                      countWords(draftPrompt) >= MAX_CUSTOM_PROMPT_WORDS
                        ? "#c0392b"
                        : "var(--claude-muted)",
                  }}
                >
                  {countWords(draftPrompt)} / {MAX_CUSTOM_PROMPT_WORDS} words
                </span>
              </div>

              <div
                className="px-5 py-3 border-t flex-shrink-0 flex justify-end gap-2"
                style={{ borderColor: "var(--claude-border)" }}
              >
                <button
                  type="button"
                  onClick={() => setCustomPromptModalOpen(false)}
                  className="h-9 px-4 rounded-lg text-[13px] font-medium transition-colors"
                  style={{ color: "var(--claude-text-2)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveCustomPrompt}
                  disabled={!draftPrompt.trim()}
                  className="h-9 px-4 rounded-lg text-[13px] font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: "var(--claude-accent)" }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
