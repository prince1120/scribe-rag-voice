"use client";

// Assistant Studio: Voice & Chat prompts, TTS voice selector, model configuration,
// document knowledge integration, and real-time live deployment controls.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cpu,
  FileText,
  Languages,
  MessageSquare,
  Mic,
  Play,
  Radio,
  RefreshCw,
  Save,
  Sliders,
  Sparkles,
  Trash2,
  Volume2,
  Zap,
} from "lucide-react";

import { ownerFetch } from "../lib/ownerFetch";
import { AgentDocuments } from "./AgentDocuments";
import { AgentTest } from "./AgentTest";
import { ChannelModelPicker, type ModelOption } from "./ChannelModelPicker";
import { GuidedSetup } from "./GuidedSetup";
import { OwnerShell } from "../components/owner/OwnerShell";

type Channel = "voice" | "chat";

interface AgentConfig {
  name?: string;
  status?: string;
  script: string;
  voice_script?: string | null;
  chat_script?: string | null;
  voice_model?: string | null;
  chat_model?: string | null;
  voice_base_url?: string | null;
  chat_base_url?: string | null;
  voice_api_key?: string | null;
  chat_api_key?: string | null;
  voice_temperature?: number | null;
  chat_temperature?: number | null;
  voice_max_tokens?: number | null;
  chat_max_tokens?: number | null;
  voice_id: string;
  language?: string;
  rag_enabled: boolean;
  greeting: string | null;
  // Whether our delivery rules (reply length, spoken form, no markdown) are
  // appended to the owner's script. Shared across both channels.
  style_rules_enabled: boolean;
  configured: boolean;
}

interface Voice {
  id: string;
  label: string;
  tagline: string;
}

interface Channels {
  voice: boolean;
  chat: boolean;
  voice_blocked_reason?: string | null;
  chat_blocked_reason?: string | null;
}

const DEFAULT_MODELS: ModelOption[] = [
  {
    id: "openai/gpt-oss-20b",
    name: "GPT OSS 20B",
    description: "Fastest (1k tok/s). Default for calls — replaces llama-3.1-8b retired 08/16/26.",
    tag: "Instant",
    good_for: "voice",
  },
  {
    id: "openai/gpt-oss-120b",
    name: "GPT OSS 120B",
    description: "Most capable reasoning. Replaces llama-3.3-70b retired 08/16/26.",
    tag: "Premium",
    good_for: "chat",
  },
  {
    id: "qwen/qwen3.6-27b",
    name: "Qwen 3.6 27B",
    description: "Balanced multilingual & coding. Replaces qwen3-32b retired 07/17/26.",
    tag: "Balanced",
    good_for: "both",
  },
];

import { getWorkspaceCache, setWorkspaceCache, useWorkspace } from "../lib/workspaceCache";
import { AGENT_TEMPLATES, defaultTemplate, templateForCategory } from "./templates";

export default function AgentPage() {
  const ws = useWorkspace();
  const businessName = ws.businessName;

  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [voices, setVoices] = useState<Record<string, Voice[]>>({});
  const [languages, setLanguages] = useState<Array<{ id: string; label: string }>>([]);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [models, setModels] = useState<ModelOption[]>(DEFAULT_MODELS);

  const [tab, setTab] = useState<Channel>("voice");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewing, setPreviewing] = useState("");
  const [error, setError] = useState("");

  // Custom provider states
  const [isVoiceCustom, setIsVoiceCustom] = useState(false);
  const [isChatCustom, setIsChatCustom] = useState(false);
  const [voiceKeyInput, setVoiceKeyInput] = useState("");
  const [chatKeyInput, setChatKeyInput] = useState("");

  const loadChannels = useCallback(async () => {
    try {
      const res = await ownerFetch("/api/v1/workspace/channels");
      if (res.ok) setChannels(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const cached = getWorkspaceCache();
    if (cached.agentConfig) {
      setConfig(cached.agentConfig);
      setLoading(false);
      if (cached.agentConfig.voice_base_url || cached.agentConfig.voice_api_key) setIsVoiceCustom(true);
      if (cached.agentConfig.chat_base_url || cached.agentConfig.chat_api_key) setIsChatCustom(true);
    }
    if (cached.voices) setVoices(cached.voices);
    if (cached.languages) setLanguages(cached.languages);

    let cancelled = false;
    async function loadData() {
      try {
        const [agentRes, voicesRes, langsRes] = await Promise.all([
          ownerFetch("/api/v1/workspace/agent"),
          ownerFetch("/api/v1/voice/speakers"),
          ownerFetch("/api/v1/voice/languages"),
        ]);

        if (cancelled) return;
        if (agentRes.ok) {
          const cfg = await agentRes.json();
          setConfig(cfg);
          setWorkspaceCache({ agentConfig: cfg, status: cfg.status });
          if (cfg.voice_base_url || cfg.voice_api_key) setIsVoiceCustom(true);
          if (cfg.chat_base_url || cfg.chat_api_key) setIsChatCustom(true);
        }
        if (voicesRes.ok) {
          const vData = await voicesRes.json();
          setVoices(vData);
          setWorkspaceCache({ voices: vData });
        }
        if (langsRes.ok) {
          const lData = (await langsRes.json()).languages || [];
          setLanguages(lData);
          setWorkspaceCache({ languages: lData });
        }
        await loadChannels();
      } catch (err) {
        if (!config && !cancelled) setError("Could not load assistant configuration.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [loadChannels]);

  function update(patch: Partial<AgentConfig>) {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, any> = {
        name: (config.name || "").trim() || "Assistant",
        voice_script: config.voice_script,
        chat_script: config.chat_script,
        voice_model: config.voice_model,
        chat_model: config.chat_model,
        voice_base_url: config.voice_base_url,
        chat_base_url: config.chat_base_url,
        voice_temperature: config.voice_temperature,
        chat_temperature: config.chat_temperature,
        voice_max_tokens: config.voice_max_tokens,
        chat_max_tokens: config.chat_max_tokens,
        voice_id: config.voice_id,
        language: config.language,
        rag_enabled: config.rag_enabled,
        style_rules_enabled: config.style_rules_enabled !== false,
        greeting: config.greeting || undefined,
      };

      if (isVoiceCustom) {
        if (voiceKeyInput.trim()) payload.voice_api_key = voiceKeyInput.trim();
      } else if (config.voice_api_key) {
        payload.voice_api_key = "";
      }

      if (isChatCustom) {
        if (chatKeyInput.trim()) payload.chat_api_key = chatKeyInput.trim();
      } else if (config.chat_api_key) {
        payload.chat_api_key = "";
      }

      const response = await ownerFetch("/api/v1/workspace/agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not save assistant.");
      }
      const updated = await response.json();
      setConfig(updated);
      setVoiceKeyInput("");
      setChatKeyInput("");
      setSaved(true);
      await loadChannels();
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save assistant.");
    } finally {
      setSaving(false);
    }
  }

  async function deploy(live: boolean) {
    setDeploying(true);
    setError("");
    try {
      const response = await ownerFetch(`/api/v1/workspace/agent/${live ? "deploy" : "undeploy"}`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not update deployment status.");
      }
      const data = await response.json();
      setConfig((prev) => (prev ? { ...prev, status: data.status } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update status.");
    } finally {
      setDeploying(false);
    }
  }

  async function deleteAgent() {
    setDeleting(true);
    setError("");
    try {
      const response = await ownerFetch("/api/v1/workspace/agent", {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not reset assistant.");
      }
      const fresh = await ownerFetch("/api/v1/workspace/agent");
      if (fresh.ok) setConfig(await fresh.json());
      setConfirmDelete(false);
      await loadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset assistant.");
    } finally {
      setDeleting(false);
    }
  }

  async function preview(voiceId: string) {
    setPreviewing(voiceId);
    try {
      const response = await ownerFetch("/api/v1/voice/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speaker: voiceId }),
      });
      if (!response.ok) return;
      const data = await response.json();
      await new Audio(`data:${data.mime_type};base64,${data.audio_base64}`).play();
    } catch {
      /* ignore */
    } finally {
      setPreviewing("");
    }
  }

  if (loading) {
    return (
      <OwnerShell businessName={businessName}>
        <div style={S.loadingContainer}>Loading assistant studio…</div>
      </OwnerShell>
    );
  }

  if (!config) {
    return (
      <OwnerShell businessName={businessName}>
        <div style={S.errorBanner}>{error || "No assistant record found."}</div>
      </OwnerShell>
    );
  }

  const allVoices = [...(voices.female || []), ...(voices.male || [])];
  const isVoice = tab === "voice";

  const prompt = (isVoice ? config.voice_script : config.chat_script) ?? "";
  const currentModel = (isVoice ? config.voice_model : config.chat_model) ?? "";
  const currentBaseUrl = (isVoice ? config.voice_base_url : config.chat_base_url) ?? "";
  const currentSavedKey = isVoice ? config.voice_api_key : config.chat_api_key;
  const currentKeyInput = isVoice ? voiceKeyInput : chatKeyInput;
  const isCurrentCustom = isVoice ? isVoiceCustom : isChatCustom;

  const temperature = (isVoice ? config.voice_temperature : config.chat_temperature) ?? "";
  const maxTokens = (isVoice ? config.voice_max_tokens : config.chat_max_tokens) ?? "";

  const setPrompt = (value: string) => update(isVoice ? { voice_script: value } : { chat_script: value });
  const setTemperature = (value: number | null) =>
    update(isVoice ? { voice_temperature: value } : { chat_temperature: value });
  const setMaxTokens = (value: number | null) =>
    update(isVoice ? { voice_max_tokens: value } : { chat_max_tokens: value });

  const handleSelectGroqModel = (modelId: string) => {
    if (isVoice) {
      update({ voice_model: modelId, voice_base_url: "" });
      setIsVoiceCustom(false);
    } else {
      update({ chat_model: modelId, chat_base_url: "" });
      setIsChatCustom(false);
    }
  };

  const handleEnableCustom = () => {
    if (isVoice) {
      setIsVoiceCustom(true);
      if (!config.voice_base_url) update({ voice_base_url: "https://openrouter.ai/api/v1" });
    } else {
      setIsChatCustom(true);
      if (!config.chat_base_url) update({ chat_base_url: "https://openrouter.ai/api/v1" });
    }
  };

  const handleDisableCustom = (fallbackModelId?: string) => {
    if (isVoice) {
      setIsVoiceCustom(false);
      update({ voice_base_url: "", voice_model: fallbackModelId || "openai/gpt-oss-20b" });
      setVoiceKeyInput("");
    } else {
      setIsChatCustom(false);
      update({ chat_base_url: "", chat_model: fallbackModelId || "openai/gpt-oss-120b" });
      setChatKeyInput("");
    }
  };

  if (!config) {
    return (
      <OwnerShell businessName={businessName} status="draft">
        <main style={S.page}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0", color: "var(--claude-text-2)", fontSize: 13 }}>
              <RefreshCw size={16} className="animate-spin" style={{ color: "var(--claude-accent)" }} />
              <span>Loading assistant prompts and voice configuration from database…</span>
            </div>
            <div style={{ height: 180, borderRadius: 14, border: "1px solid var(--claude-border)", background: "var(--claude-bg)", opacity: 0.7 }} />
            <div style={{ height: 260, borderRadius: 14, border: "1px solid var(--claude-border)", background: "var(--claude-bg)", opacity: 0.7 }} />
          </div>
        </main>
      </OwnerShell>
    );
  }

  const isLive = config.status === "deployed";

  return (
    <OwnerShell businessName={businessName} status={config.status}>
      <main style={S.page}>
        {/* Header & Live Status Banner */}
        <header style={S.header}>
          <div>
            <h1 style={S.title}>Your AI Assistant</h1>
            <p style={S.subtitle}>
              Configure conversational prompts, speech persona, and live answering behavior.
            </p>
          </div>

          {/* Live / Draft Status Card */}
          <div
            style={{
              ...S.statusCard,
              background: isLive ? "#f0fdf4" : "var(--claude-bg)",
              borderColor: isLive ? "#bbf7d0" : "var(--claude-border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  ...S.statusDot,
                  background: isLive ? "#16a34a" : "var(--claude-text-2)",
                  boxShadow: isLive ? "0 0 8px #22c55e" : "none",
                }}
              />
              <div>
                <span style={{ fontSize: 13, fontWeight: 700, color: isLive ? "#15803d" : "var(--claude-text-2)" }}>
                  {isLive ? "Assistant is Live" : "Draft Mode (Offline)"}
                </span>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: isLive ? "#166534" : "var(--claude-text-2)" }}>
                  {isLive ? "Answering customer calls & chats" : "Links won't connect until deployed"}
                </p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                style={S.headerSaveBtn}
              >
                <Save size={14} />
                <span>{saving ? "Saving…" : saved ? "Saved!" : "Save Changes"}</span>
              </button>

              <button
                type="button"
                onClick={() => deploy(!isLive)}
                disabled={deploying || !(channels?.voice || channels?.chat)}
                style={{
                  ...S.deployBtn,
                  background: isLive ? "var(--claude-surface)" : "var(--claude-accent)",
                  color: isLive ? "#dc2626" : "var(--claude-surface)",
                  border: isLive ? "1px solid #fecaca" : "none",
                }}
              >
                {deploying ? "Working…" : isLive ? "Take Offline" : "Deploy Live"}
              </button>
            </div>
          </div>
        </header>

        {error && <div style={S.errorBanner}>{error}</div>}

        {/* ── Guided Quick Setup — make high-class agent in 30s (Phase 3b) ─ */}
        <div style={{ ...S.card, borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}>
          <div style={S.cardHeader}>
            <div style={{ ...S.iconWrap, background: "var(--claude-accent-soft)", color: "var(--claude-accent)" }}>
              <Sparkles size={18} />
            </div>
            <div>
              <h2 style={S.cardTitle}>Quick setup — 30 seconds</h2>
              <p style={S.cardSub}>Pick a template and tone → we compile a human-sounding, token-efficient prompt. Edit below if you want.</p>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            {[
              { id: "dental", label: "Dental" },
              { id: "salon", label: "Salon" },
              { id: "clinic", label: "Clinic" },
              { id: "coaching", label: "Coaching" },
              { id: "retail", label: "Retail" },
              { id: "restaurant", label: "Restaurant" },
              { id: "real_estate", label: "Real estate" },
            ].map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  const t = templateForCategory(c.id);
                  if (!t) return;
                  update({ greeting: t.greeting });
                  update({ voice_script: t.voice_script });
                  update({ chat_script: t.chat_script });
                  if (t.language) update({ language: t.language });
                  if (t.voice_id) update({ voice_id: t.voice_id });
                }}
                className="ds-pressable"
                style={{
                  padding: "6px 12px",
                  borderRadius: 9999,
                  border: "1px solid var(--claude-border)",
                  background: "var(--claude-bg)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {[
              { id: "warm", label: "Warm & friendly", temp: 0.3 },
              { id: "pro", label: "Professional", temp: 0.2 },
              { id: "concise", label: "Concise", temp: 0.15 },
            ].map((tone) => (
              <button
                key={tone.id}
                type="button"
                onClick={() => update({ voice_temperature: tone.temp, chat_temperature: Math.min(0.5, tone.temp + 0.15) })}
                className="ds-pressable"
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--claude-border-strong)",
                  background: "var(--claude-surface-2)",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                title={`Sets voice temp ${tone.temp} — saves tokens & sounds human`}
              >
                {tone.label}
              </button>
            ))}
            <span style={{ fontSize: 11, color: "var(--claude-muted)", alignSelf: "center" }}>→ Low thinking, saves tokens, stays human</span>
          </div>
        </div>

        {/* ── Card 1: Identity & Name ─────────────────────────── */}
        <div style={S.card}>
          <div style={S.cardHeader}>
            <div style={{ ...S.iconWrap, background: "#ede9fe", color: "var(--claude-accent)" }}>
              <Bot size={18} />
            </div>
            <div>
              <h2 style={S.cardTitle}>Assistant Identity</h2>
              <p style={S.cardSub}>How your AI assistant introduces itself to callers and visitors.</p>
            </div>
          </div>

          <div style={S.formGrid}>
            <div>
              <label style={S.label}>Assistant Name</label>
              <input
                style={S.input}
                value={config.name || ""}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="e.g. Asha, Alex"
                maxLength={120}
              />
            </div>

            <div>
              <label style={S.label}>
                First Spoken Greeting <span style={{ color: "var(--claude-text-2)", fontWeight: 400 }}>(Optional)</span>
              </label>
              <input
                style={S.input}
                value={config.greeting || ""}
                onChange={(e) => update({ greeting: e.target.value })}
                placeholder="Hello! Thanks for calling. How can I help you today?"
                maxLength={500}
              />
            </div>
          </div>
        </div>

        {/* ── Channel Selector Tabs ───────────────────────────── */}
        <div style={S.channelTabs}>
          {(["voice", "chat"] as const).map((ch) => {
            const ready = ch === "voice" ? channels?.voice : channels?.chat;
            const active = tab === ch;
            return (
              <button
                key={ch}
                type="button"
                onClick={() => setTab(ch)}
                style={{
                  ...S.channelTab,
                  background: active ? "var(--claude-surface)" : "transparent",
                  color: active ? "var(--claude-text)" : "var(--claude-text-2)",
                  boxShadow: active ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                  fontWeight: active ? 700 : 500,
                }}
              >
                {ch === "voice" ? <Mic size={15} /> : <MessageSquare size={15} />}
                <span>{ch === "voice" ? "Voice Calls" : "Text Chat"}</span>
                <span
                  style={{
                    ...S.channelDot,
                    background: ready ? "#22c55e" : "var(--claude-border)",
                  }}
                  title={ready ? "Configured & Ready" : "Prompt required"}
                />
              </button>
            );
          })}
        </div>

        {/* ── Card 2: Conversational Prompt ───────────────────── */}
        <div style={S.card}>
          <div style={S.cardHeader}>
            <div style={{ ...S.iconWrap, background: isVoice ? "#fdf2f8" : "#eff6ff", color: isVoice ? "#db2777" : "var(--claude-accent)" }}>
              {isVoice ? <Mic size={18} /> : <MessageSquare size={18} />}
            </div>
            <div>
              <h2 style={S.cardTitle}>
                {isVoice ? "Voice Call Prompt & Script" : "Text Chat Prompt & Guidelines"}
              </h2>
              <p style={S.cardSub}>
                {isVoice
                  ? "Spoken aloud over audio. Keep responses concise, friendly, and natural."
                  : "Used for structured text chat. Answers can be detailed and cite uploaded documents."}
              </p>
            </div>
          </div>

          {/* Quick templates — only shown when prompt is empty/short so owners aren't staring at blank */}
          {prompt.trim().length < 40 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: "var(--claude-muted)", alignSelf: "center", marginRight: 4 }}>Start from template:</span>
              {Object.keys(AGENT_TEMPLATES).slice(0, 5).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    const tmpl = AGENT_TEMPLATES[cat];
                    const target = isVoice ? tmpl.voice_script : tmpl.chat_script;
                    setPrompt(target);
                    if (tmpl.greeting && !config?.greeting) update({ greeting: tmpl.greeting });
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 9999,
border: "1px solid var(--claude-border)",
                    background: "var(--claude-bg)",
                    color: "var(--claude-text-2)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {cat.replace(/_/g, " ")}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const tmpl = defaultTemplate(config?.name || ws.businessName || "");
                  setPrompt(isVoice ? tmpl.voice_script : tmpl.chat_script);
                }}
                style={{
                  padding: "4px 10px",
                  borderRadius: 9999,
                  border: "1px solid var(--claude-border)",
                  background: "var(--claude-surface)",
color: "var(--claude-text-2)",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Generic
              </button>
            </div>
          )}

          <div>
            <textarea
              style={S.promptArea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              maxLength={8000}
              placeholder={
                isVoice
                  ? "You are a customer assistant for our business. Answer inquiries politely and concisely…"
                  : "You answer customer questions based on our store policies and documents…"
              }
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--claude-muted)" }}>
              <span>Pro Tip: Specify required information (e.g. caller name, reason for visit).</span>
              <span>{prompt.length} / 8000 characters</span>
            </div>
          </div>

          {/* Voice-specific settings */}
          {isVoice && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 10, paddingTop: 16, borderTop: "1px solid var(--claude-surface-2)" }}>
              {/* Language Selection */}
              <div>
                <label style={S.label}>Caller Spoken Language</label>
                <select
                  style={S.input}
                  value={config.language || "unknown"}
                  onChange={(e) => update({ language: e.target.value })}
                >
                  {languages.length === 0 && <option value="unknown">Auto-detect Language</option>}
                  {languages.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Speaker Voice Selection */}
              <div>
                <label style={S.label}>Assistant Voice Persona</label>
                <div style={S.voicesGrid}>
                  {allVoices.map((voice) => {
                    const isSelected = config.voice_id === voice.id;
                    return (
                      <div
                        key={voice.id}
                        onClick={() => update({ voice_id: voice.id })}
                        style={{
                          ...S.voiceCard,
                          borderColor: isSelected ? "var(--claude-accent)" : "var(--claude-border)",
                          background: isSelected ? "#eef2ff" : "var(--claude-surface)",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? "var(--claude-accent)" : "var(--claude-text)" }}>
                            {voice.label}
                          </span>
                          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--claude-text-2)" }}>
                            {voice.tagline}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void preview(voice.id);
                          }}
                          style={S.playVoiceBtn}
                          title="Listen to sample"
                        >
                          <Play size={12} className={previewing === voice.id ? "animate-spin" : ""} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* RAG on Voice Toggle */}
              <label style={S.toggleBox}>
                <input
                  type="checkbox"
                  checked={config.rag_enabled}
                  onChange={(e) => update({ rag_enabled: e.target.checked })}
style={{ width: 16, height: 16, accentColor: "var(--claude-accent)", cursor: "pointer" }}
                />
                <div>
<span style={{ fontSize: 13, fontWeight: 600, color: "var(--claude-text)", display: "block" }}>
                    Enable Document Knowledge Search on Voice Calls
                  </span>
                  <span style={{ fontSize: 11, color: "var(--claude-muted)" }}>
                    Look up answers from uploaded documents during live phone calls.
                  </span>
                </div>
              </label>
            </div>
          )}

          {/* Delivery rules. Shown on both tabs because the setting is shared —
              an owner who wants their prompt honoured verbatim means it
              everywhere, not on calls only. Framed as what turning it OFF
              costs, since the default is on and the risk is switching it off
              without realising the agent will start reading markdown aloud. */}
          <label style={{ ...S.toggleBox, marginTop: 12 }}>
            <input
              type="checkbox"
              // `!== false` rather than a plain read: a config cached from
              // before this field existed has it undefined, and that must show
              // as on (the server default) instead of silently rendering the
              // rules as switched off.
              checked={config.style_rules_enabled !== false}
              onChange={(e) => update({ style_rules_enabled: e.target.checked })}
              style={{ width: 16, height: 16, accentColor: "var(--claude-accent)", cursor: "pointer" }}
            />
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--claude-text)", display: "block" }}>
                Keep replies short and natural
              </span>
              <span style={{ fontSize: 11, color: "var(--claude-muted)" }}>
                {isVoice
                  ? "Adds our speaking rules on top of your prompt: one to three sentences, plain spoken language, numbers and dates read aloud properly, no markdown. Turn this off only if your prompt already covers all of that — without it, replies tend to run long and callers wait."
                  : "Adds our writing rules on top of your prompt: answer first, no filler openings or closing summaries. Your prompt still leads."}
              </span>
            </div>
          </label>

          <div style={S.cardFooter}>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              style={S.primarySaveBtn}
            >
              <Save size={14} />
              <span>{saving ? "Saving…" : saved ? "Saved!" : "Save Prompt & Persona"}</span>
            </button>
          </div>
        </div>

        {/* ── Card 3: Model & Sampling ────────────────────────── */}
        <ChannelModelPicker
          channel={tab}
          models={models}
          selectedModel={currentModel}
          baseUrl={currentBaseUrl}
          savedApiKey={currentSavedKey}
          apiKeyInput={currentKeyInput}
          isCustom={isCurrentCustom}
          onSelectGroqModel={handleSelectGroqModel}
          onEnableCustom={handleEnableCustom}
          onDisableCustom={handleDisableCustom}
          onChangeBaseUrl={(val) =>
            update(isVoice ? { voice_base_url: val } : { chat_base_url: val })
          }
          onChangeApiKey={(val) => {
            if (isVoice) setVoiceKeyInput(val);
            else setChatKeyInput(val);
          }}
          onChangeCustomModel={(val) =>
            update(isVoice ? { voice_model: val } : { chat_model: val })
          }
        />

        {/* ── Card 4: Knowledge Documents ─────────────────────── */}
        <AgentDocuments />

        {/* ── Card 5: Danger Zone / Reset ─────────────────────── */}
        <div style={{ ...S.card, borderColor: "#fee2e2", background: "#fef2f2" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>
                Reset Assistant
              </span>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#b91c1c" }}>
                Clear all custom prompts and restore default assistant settings.
              </p>
            </div>

            {confirmDelete ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={deleteAgent}
                  style={S.confirmDeleteBtn}
                >
                  {deleting ? "Resetting…" : "Confirm Reset"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  style={S.cancelBtn}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                style={S.deleteBtn}
              >
                <Trash2 size={13} />
                <span>Reset to Default</span>
              </button>
            )}
          </div>
        </div>

        {/* ── Bottom Main Action Bar ─────────────────────────── */}
        <div style={S.bottomActionBar}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              style={S.mainSaveBtn}
            >
              <Save size={16} />
              <span>{saving ? "Saving Changes…" : saved ? "Changes Saved!" : "Save Assistant Changes"}</span>
            </button>

            <button
              type="button"
              onClick={() => deploy(!isLive)}
              disabled={deploying || !(channels?.voice || channels?.chat)}
              style={{
                ...S.mainDeployBtn,
                background: isLive ? "#fee2e2" : "#16a34a",
                color: isLive ? "#b91c1c" : "var(--claude-surface)",
                border: isLive ? "1px solid #fecaca" : "none",
              }}
            >
              <Radio size={15} />
              <span>
                {deploying
                  ? "Updating…"
                  : isLive
                  ? "Disable / Take Offline"
                  : "Enable / Deploy Live"}
              </span>
            </button>
          </div>

          {saved && (
            <span style={{ fontSize: 13, fontWeight: 600, color: "#16a34a", display: "flex", alignItems: "center", gap: 6 }}>
              <CheckCircle2 size={16} /> All configuration saved & updated
            </span>
          )}
        </div>
      </main>
    </OwnerShell>
  );
}

/* ─────────────────────────── Styles ─────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    maxWidth: "56rem",
    paddingBottom: 80,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 14,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    margin: 0,
    color: "var(--claude-text)",
  },
  subtitle: {
    fontSize: 13,
    color: "var(--claude-muted)",
    marginTop: 4,
    margin: 0,
  },
  statusCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "10px 16px",
    borderRadius: 12,
    border: "1px solid var(--claude-border)",
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 9999,
  },
  deployBtn: {
    padding: "6px 14px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: "20px 22px",
    borderRadius: 16,
    background: "var(--claude-surface)",
    border: "1px solid var(--claude-border)",
    boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    borderBottom: "1px solid var(--claude-surface-2)",
    paddingBottom: 12,
  },
  iconWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 38,
    height: 38,
    borderRadius: 10,
    flexShrink: 0,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--claude-text)",
    margin: 0,
  },
  cardSub: {
    fontSize: 12,
    color: "var(--claude-muted)",
    margin: "2px 0 0",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 14,
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--claude-text-2)",
    marginBottom: 5,
  },
  input: {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid var(--claude-border-strong)",
    background: "var(--claude-surface)",
    fontSize: 13,
    color: "var(--claude-text)",
    boxSizing: "border-box",
    outline: "none",
  },
  channelTabs: {
    display: "flex",
    gap: 6,
    background: "var(--claude-surface-2)",
    padding: 4,
    borderRadius: 10,
    width: "fit-content",
  },
  channelTab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    fontSize: 13,
    cursor: "pointer",
    transition: "all 0.12s",
  },
  channelDot: {
    width: 7,
    height: 7,
    borderRadius: 9999,
    marginLeft: 4,
  },
  promptArea: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid var(--claude-border-strong)",
    background: "var(--claude-surface)",
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--claude-text)",
    boxSizing: "border-box",
    outline: "none",
    fontFamily: "inherit",
  },
  voicesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 10,
  },
  voiceCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--claude-border)",
    cursor: "pointer",
    transition: "all 0.12s",
  },
  playVoiceBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 9999,
    border: "1px solid var(--claude-border-strong)",
    background: "var(--claude-surface)",
    color: "var(--claude-accent)",
    cursor: "pointer",
    flexShrink: 0,
  },
  toggleBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 10,
    background: "var(--claude-bg)",
    border: "1px solid var(--claude-border)",
    cursor: "pointer",
  },
  headerSaveBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 14px",
    borderRadius: 8,
    border: "none",
    background: "var(--claude-accent)",
    color: "var(--claude-surface)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(79, 70, 229, 0.25)",
  },
  cardFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingTop: 12,
    borderTop: "1px solid var(--claude-surface-2)",
  },
  bottomActionBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderRadius: 14,
    background: "var(--claude-surface)",
    border: "1px solid var(--claude-border)",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
  },
  mainSaveBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "10px 22px",
    borderRadius: 8,
    border: "none",
    background: "var(--claude-accent)",
    color: "var(--claude-surface)",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(79, 70, 229, 0.3)",
  },
  mainDeployBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 18px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  primarySaveBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    background: "var(--claude-accent)",
    color: "var(--claude-surface)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(79, 70, 229, 0.25)",
  },
  deleteBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #fca5a5",
    background: "var(--claude-surface)",
    color: "#dc2626",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  confirmDeleteBtn: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "none",
    background: "#dc2626",
    color: "var(--claude-surface)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  cancelBtn: {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid var(--claude-border-strong)",
    background: "var(--claude-surface)",
    color: "var(--claude-text-2)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
  loadingContainer: {
    textAlign: "center",
    padding: "60px 0",
    color: "var(--claude-muted)",
    fontSize: 14,
  },
  errorBanner: {
    padding: "12px 16px",
    borderRadius: 10,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: 500,
  },
};
