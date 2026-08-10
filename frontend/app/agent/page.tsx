"use client";

// The business owner's whole product surface: one agent, configured here.
//
// Organised by channel rather than by field. Voice and chat are different
// jobs — a spoken answer must be short and cannot use formatting, a typed one
// can be structured and long — so each owns its prompt, model, and sampling
// outright.
//
// A channel with no prompt is not offered anywhere: not in the test panel, not
// in the link picker, not by the API. An unwritten prompt is an assistant with
// nothing to say, and sending someone a link to one is worse than not
// offering the channel at all.

import { useCallback, useEffect, useState } from "react";

import { ownerFetch } from "../lib/ownerFetch";
import { AgentDocuments } from "./AgentDocuments";
import { AgentTest } from "./AgentTest";
import { ChannelModelPicker, type ModelOption } from "./ChannelModelPicker";
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
    id: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B",
    description: "Fastest to first word. The default for calls.",
    tag: "Instant",
    good_for: "voice",
  },
  {
    id: "openai/gpt-oss-20b",
    name: "GPT OSS 20B",
    description: "Quick and capable for everyday answers.",
    tag: "Fast",
    good_for: "both",
  },
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B",
    description: "Stronger reasoning for detailed questions.",
    tag: "Versatile",
    good_for: "chat",
  },
  {
    id: "openai/gpt-oss-120b",
    name: "GPT OSS 120B",
    description: "The most capable, and the slowest.",
    tag: "Premium",
    good_for: "chat",
  },
  {
    id: "qwen/qwen3.6-27b",
    name: "Qwen 3.6 27B",
    description: "Strong multilingual and coding ability.",
    tag: "Reasoning",
    good_for: "both",
  },
];

export default function AgentPage() {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [voices, setVoices] = useState<Record<string, Voice[]>>({});
  const [languages, setLanguages] = useState<Array<{ id: string; label: string }>>([]);
  const [channels, setChannels] = useState<Channels | null>(null);
  const [models, setModels] = useState<ModelOption[]>(DEFAULT_MODELS);
  const [businessName, setBusinessName] = useState<string | null>(null);

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
      const response = await ownerFetch("/api/v1/workspace/channels");
      if (response.ok) setChannels(await response.json());
    } catch {
      // The panel assumes nothing rather than blocking on this; the server
      // refuses an impossible channel anyway.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [agentRes, voicesRes, langRes, wsRes, modelsRes] = await Promise.all([
          ownerFetch("/api/v1/workspace/agent"),
          ownerFetch("/api/v1/voice/voices"),
          ownerFetch("/api/v1/voice/languages"),
          ownerFetch("/api/v1/workspace"),
          ownerFetch("/api/v1/workspace/models"),
        ]);
        if (cancelled) return;

        if (agentRes.status === 403) {
          setError("Only the workspace owner can change the agent.");
          return;
        }
        if (agentRes.ok) {
          const cfg = await agentRes.json();
          setConfig(cfg);
          setIsVoiceCustom(Boolean(cfg.voice_base_url));
          setIsChatCustom(Boolean(cfg.chat_base_url));
        }
        if (voicesRes.ok) setVoices((await voicesRes.json()).voices || {});
        if (langRes.ok) setLanguages((await langRes.json()).languages || []);
        if (wsRes.ok) setBusinessName((await wsRes.json()).business_name);
        if (modelsRes.ok) {
          const data = await modelsRes.json();
          if (Array.isArray(data.models) && data.models.length > 0) {
            setModels(data.models);
          }
        }
        await loadChannels();
      } catch {
        setError("Could not load your agent.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadChannels]);

  const update = useCallback((patch: Partial<AgentConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaved(false);
  }, []);

  async function save() {
    if (!config) return;
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: config.name,
        script: config.script,
        voice_script: config.voice_script || undefined,
        chat_script: config.chat_script || undefined,
        voice_model: config.voice_model || undefined,
        chat_model: config.chat_model || undefined,
        voice_base_url: isVoiceCustom ? config.voice_base_url || "" : "",
        chat_base_url: isChatCustom ? config.chat_base_url || "" : "",
        voice_temperature: config.voice_temperature ?? undefined,
        chat_temperature: config.chat_temperature ?? undefined,
        voice_max_tokens: config.voice_max_tokens ?? undefined,
        chat_max_tokens: config.chat_max_tokens ?? undefined,
        voice_id: config.voice_id,
        language: config.language,
        rag_enabled: config.rag_enabled,
        greeting: config.greeting || undefined,
      };

      if (isVoiceCustom) {
        if (voiceKeyInput.trim()) {
          payload.voice_api_key = voiceKeyInput.trim();
        }
      } else if (config.voice_api_key) {
        payload.voice_api_key = "";
      }

      if (isChatCustom) {
        if (chatKeyInput.trim()) {
          payload.chat_api_key = chatKeyInput.trim();
        }
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
        throw new Error(body?.detail || "Could not save.");
      }
      const updated = await response.json();
      setConfig(updated);
      setVoiceKeyInput("");
      setChatKeyInput("");
      setSaved(true);
      await loadChannels();
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
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
        throw new Error(body?.detail || "Could not change the status.");
      }
      const data = await response.json();
      setConfig((prev) => (prev ? { ...prev, status: data.status } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the status.");
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
        throw new Error(body?.detail || "Could not delete the assistant.");
      }
      const fresh = await ownerFetch("/api/v1/workspace/agent");
      if (fresh.ok) {
        setConfig(await fresh.json());
      }
      setConfirmDelete(false);
      await loadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the assistant.");
    } finally {
      setDeleting(false);
    }
  }

  /** Hearing a voice before committing beats reading a one-line tagline */
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
      // A failed preview must not block configuring the agent.
    } finally {
      setPreviewing("");
    }
  }

  if (loading) {
    return (
      <OwnerShell businessName={businessName}>
        <main className="agent-page">
          <div className="agent-inner">
            <span className="ds-skeleton agent-skeleton" />
            <span className="ds-skeleton agent-skeleton" />
          </div>
        </main>
      </OwnerShell>
    );
  }

  if (!config) {
    return (
      <OwnerShell businessName={businessName}>
        <main className="agent-page">
          <div className="agent-inner">
            <p className="agent-error" role="alert">
              {error || "No agent found."}
            </p>
          </div>
        </main>
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
      update({ voice_base_url: "", voice_model: fallbackModelId || "llama-3.1-8b-instant" });
      setVoiceKeyInput("");
    } else {
      setIsChatCustom(false);
      update({ chat_base_url: "", chat_model: fallbackModelId || "llama-3.3-70b-versatile" });
      setChatKeyInput("");
    }
  };

  const blocked = isVoice ? channels?.voice_blocked_reason : channels?.chat_blocked_reason;

  return (
    <OwnerShell businessName={businessName} status={config.status}>
      <main className="agent-page ds-scroll">
        <div className="agent-inner">
          <header className="agent-header">
            <div>
              <h1 className="agent-title">Your assistant</h1>
              <p className="agent-sub">What your customers hear and read when they use your link.</p>
            </div>
          </header>

          <div className={`agent-status ${config.status === "deployed" ? "is-live" : ""}`}>
            <span className="agent-status-dot" aria-hidden="true" />
            <span>
              {config.status === "deployed"
                ? "Live — your links are working"
                : "Draft — links will not connect until you deploy"}
            </span>
            <button
              type="button"
              className="agent-status-btn ds-pressable ds-tap"
              onClick={() => deploy(config.status !== "deployed")}
              disabled={deploying || !(channels?.voice || channels?.chat)}
              title={
                channels?.voice || channels?.chat
                  ? undefined
                  : "Write a prompt for at least one channel first"
              }
            >
              {deploying ? "Working…" : config.status === "deployed" ? "Take offline" : "Deploy"}
            </button>
          </div>

          <section className="agent-section">
            <label className="agent-label" htmlFor="agent-name">
              What is your assistant called?
            </label>
            <input
              id="agent-name"
              className="agent-input"
              value={config.name || ""}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Asha"
              maxLength={120}
            />
          </section>

          {/* One tab per channel */}
          <div className="chan-tabs" role="tablist" aria-label="Channel">
            {(["voice", "chat"] as const).map((ch) => {
              const ready = ch === "voice" ? channels?.voice : channels?.chat;
              return (
                <button
                  key={ch}
                  type="button"
                  role="tab"
                  aria-selected={tab === ch}
                  className={`chan-tab ${tab === ch ? "is-active" : ""}`}
                  onClick={() => setTab(ch)}
                >
                  {ch === "voice" ? "Voice" : "Chat"}
                  <span
                    className={`chan-dot ${ready ? "is-ready" : ""}`}
                    aria-label={ready ? "ready" : "not ready"}
                  />
                </button>
              );
            })}
          </div>

          <div className="chan-panel">
            {blocked && <p className="agent-hint">{blocked}</p>}

            <section className="agent-section">
              <label className="agent-label" htmlFor="chan-prompt">
                What should it say on {isVoice ? "calls" : "chat"}?
              </label>
              <p className="agent-hint">
                {isVoice
                  ? "Keep it conversational. This is spoken aloud, so it cannot use lists or formatting."
                  : "Answers here always use your documents, and can be longer and structured."}
              </p>
              <textarea
                id="chan-prompt"
                className="agent-textarea ds-scroll"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={8}
                maxLength={8000}
                placeholder={
                  isVoice
                    ? "You answer calls for this business. Be warm and brief…"
                    : "You answer questions from our documents. Cite what you use…"
                }
              />
            </section>

            {isVoice && (
              <>
                <section className="agent-section">
                  <label className="agent-label" htmlFor="greeting">
                    First thing it says <span className="agent-optional">optional</span>
                  </label>
                  <input
                    id="greeting"
                    className="agent-input"
                    value={config.greeting || ""}
                    onChange={(e) => update({ greeting: e.target.value })}
                    placeholder="Hello! Thanks for calling. How can I help?"
                    maxLength={500}
                  />
                </section>

                <section className="agent-section">
                  <label className="agent-label" htmlFor="agent-language">
                    What language will callers speak?
                  </label>
                  <select
                    id="agent-language"
                    className="agent-input"
                    value={config.language || "unknown"}
                    onChange={(e) => update({ language: e.target.value })}
                  >
                    {languages.length === 0 && <option value="unknown">Auto-detect</option>}
                    {languages.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </section>

                <section className="agent-section">
                  <span className="agent-label">Voice</span>
                  <div className="agent-voices">
                    {allVoices.map((voice) => (
                      <button
                        key={voice.id}
                        type="button"
                        className={`agent-voice ds-pressable ds-tap ${
                          config.voice_id === voice.id ? "is-active" : ""
                        }`}
                        onClick={() => update({ voice_id: voice.id })}
                      >
                        <span className="agent-voice-name">{voice.label}</span>
                        <span className="agent-voice-tag">{voice.tagline}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          className="agent-voice-play"
                          onClick={(e) => {
                            e.stopPropagation();
                            void preview(voice.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              void preview(voice.id);
                            }
                          }}
                        >
                          {previewing === voice.id ? "…" : "▶"}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="agent-section">
                  <label className="agent-toggle">
                    <input
                      type="checkbox"
                      checked={config.rag_enabled}
                      onChange={(e) => update({ rag_enabled: e.target.checked })}
                    />
                    <span>
                      <span className="agent-label">Answer from my documents</span>
                      <span className="agent-hint">
                        Chat always uses them; this is for calls, where every lookup costs a pause before
                        the assistant speaks.
                      </span>
                    </span>
                  </label>
                </section>
              </>
            )}

            {/* Model per channel picker */}
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

            {/* Sampling controls */}
            <section className="agent-section">
              <span className="agent-label">Sampling</span>
              <div className="chan-row">
                <div>
                  <label className="agent-hint" htmlFor="chan-temp">
                    Temperature
                  </label>
                  <input
                    id="chan-temp"
                    className="agent-input"
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    placeholder="default"
                    value={temperature}
                    onChange={(e) =>
                      setTemperature(e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </div>
                <div>
                  <label className="agent-hint" htmlFor="chan-tokens">
                    Max tokens
                  </label>
                  <input
                    id="chan-tokens"
                    className="agent-input"
                    type="number"
                    min="50"
                    max={isVoice ? 800 : 4000}
                    placeholder="default"
                    value={maxTokens}
                    onChange={(e) =>
                      setMaxTokens(e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </div>
              </div>
              {isVoice && (
                <p className="agent-hint">
                  Kept short on purpose — past roughly 500 tokens a caller is listening to a lecture.
                </p>
              )}
            </section>
          </div>

          <AgentDocuments />

          {error && (
            <p className="agent-error" role="alert">
              {error}
            </p>
          )}

          <div className="agent-actions">
            <button
              type="button"
              className="agent-save ds-pressable ds-tap"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : saved ? "Saved" : "Save agent"}
            </button>
          </div>

          {/* Assistant Lifecycle & Danger Zone */}
          <section className="agent-section rounded-2xl border p-4 flex flex-col gap-3 mt-4" style={{ borderColor: "var(--owner-border)", background: "var(--owner-surface)" }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="agent-label block">Assistant Status</span>
                <p className="agent-hint">
                  {config.status === "deployed"
                    ? "Live — callers and directory visitors can talk to your assistant."
                    : "Offline (Draft) — your links and directory listing will not connect until enabled."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => deploy(config.status !== "deployed")}
                disabled={deploying || (!channels?.voice && !channels?.chat)}
                className="agent-status-btn ds-pressable ds-tap whitespace-nowrap text-xs font-semibold px-3 py-1.5 rounded-lg border cursor-pointer"
                style={{
                  background: config.status === "deployed" ? "#FDF2F2" : "#EAF7EE",
                  color: config.status === "deployed" ? "#C53030" : "#1F7344",
                  borderColor: config.status === "deployed" ? "#F5C2C2" : "#B8E5C8",
                }}
              >
                {deploying
                  ? "Working…"
                  : config.status === "deployed"
                  ? "Disable / Take Offline"
                  : "Enable / Deploy Live"}
              </button>
            </div>

            <div className="pt-3 border-t flex items-center justify-between gap-3" style={{ borderColor: "var(--owner-border)" }}>
              <div>
                <span className="text-xs font-semibold text-red-600 block">Delete Assistant</span>
                <p className="agent-hint">Reset all custom prompts, voice choices, and settings back to a fresh draft.</p>
              </div>
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={deleteAgent}
                    disabled={deleting}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white bg-red-600 hover:bg-red-700 cursor-pointer"
                  >
                    {deleting ? "Deleting…" : "Confirm Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs font-medium px-2.5 py-1.5 rounded-lg border cursor-pointer"
                    style={{ borderColor: "var(--owner-border)", color: "var(--owner-muted)" }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer"
                >
                  Delete Assistant
                </button>
              )}
            </div>
          </section>

          <AgentTest
            deployed={config.status === "deployed"}
            voiceAvailable={channels?.voice ?? false}
            chatAvailable={channels?.chat ?? false}
            voiceBlockedReason={channels?.voice_blocked_reason}
            chatBlockedReason={channels?.chat_blocked_reason}
          />
        </div>
      </main>
    </OwnerShell>
  );
}
