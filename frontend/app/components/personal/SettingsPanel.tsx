"use client";

import { useState } from "react";
import { Check, Cpu, KeyRound, LogOut, Plus, RefreshCw, RotateCcw, SlidersHorizontal, Trash2, X } from "lucide-react";
import { ScribeMark } from "../../Logo";
import type { KeyPair } from "../../lib/personalSession";
import type { CustomModel } from "../../lib/customModel";
import { ToastType } from "../../Toast";

function maskKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  session: {
    groqKey: string;
    sarvamKey: string;
    keyHistory: KeyPair[];
    isDemoSession: boolean;
  };
  sessionActions: {
    switchGroqKey: (key: string) => void;
    switchPair: (pair: KeyPair) => void;
    forgetPair: (groqKey: string) => void;
    end: () => void;
    updateSarvam: (key: string) => void;
    onSessionReset: () => void; // clears chat + documents when keys change
  };
  generation: {
    topK: number;
    temperature: number;
    maxTokens: number;
  };
  generationActions: {
    setTopK: (v: number) => void;
    setTemperature: (v: number) => void;
    setMaxTokens: (v: number) => void;
    reset: () => void;
  };
  models: {
    selectedModel: string;
    customModels: CustomModel[];
  };
  modelActions: {
    selectModel: (id: string) => void;
    addCustom: (draft: Omit<CustomModel, "id">) => void;
    removeCustom: (id: string) => void;
  };
  notify: (msg: string, type?: ToastType) => void;
}

const DEMO_TOP_K = 3;

const BUILTIN_MODELS: { id: string; name: string; desc: string; tag: string }[] = [
  { id: "openai/gpt-oss-20b", name: "GPT OSS 20B", desc: "Fastest 1k tok/s — default for voice", tag: "Instant" },
  { id: "openai/gpt-oss-120b", name: "GPT OSS 120B", desc: "Most capable reasoning", tag: "Premium" },
  { id: "qwen/qwen3.6-27b", name: "Qwen 3.6 27B", desc: "Balanced multilingual & coding", tag: "Balanced" },
];

export function SettingsPanel({
  open,
  onClose,
  session,
  sessionActions,
  generation,
  generationActions,
  models,
  modelActions,
  notify,
}: SettingsPanelProps) {
  const [keySwitcherOpen, setKeySwitcherOpen] = useState(false);
  const [sarvamSwitcherOpen, setSarvamSwitcherOpen] = useState(false);
  const [newKeyInput, setNewKeyInput] = useState("");
  const [newSarvamKeyInput, setNewSarvamKeyInput] = useState("");
  const [addingCustomModel, setAddingCustomModel] = useState(false);
  const [customModelForm, setCustomModelForm] = useState({ label: "", baseUrl: "", apiKey: "", model: "" });

  if (!open) return null;

  const handleClose = () => {
    setKeySwitcherOpen(false);
    setSarvamSwitcherOpen(false);
    onClose();
  };

  const handleSwitchGroq = () => {
    if (!newKeyInput.trim()) return;
    sessionActions.switchGroqKey(newKeyInput);
    sessionActions.onSessionReset();
    setNewKeyInput("");
    setKeySwitcherOpen(false);
  };

  const handleSwitchPair = (pair: KeyPair) => {
    sessionActions.switchPair(pair);
    sessionActions.onSessionReset();
    setKeySwitcherOpen(false);
  };

  const handleEndSession = () => {
    handleClose();
    sessionActions.end();
    sessionActions.onSessionReset();
  };

  const handleUpdateSarvam = () => {
    const trimmed = newSarvamKeyInput.trim();
    sessionActions.updateSarvam(trimmed);
    setNewSarvamKeyInput("");
    setSarvamSwitcherOpen(false);
  };

  const handleAddCustom = () => {
    const label = customModelForm.label.trim();
    const baseUrl = customModelForm.baseUrl.trim();
    const apiKey = customModelForm.apiKey.trim();
    const model = customModelForm.model.trim();
    if (!label || !baseUrl || !apiKey || !model) {
      notify("Fill in all four fields to add a model.", "error");
      return;
    }
    modelActions.addCustom({ label, baseUrl, apiKey, model });
    setCustomModelForm({ label: "", baseUrl: "", apiKey: "", model: "" });
    setAddingCustomModel(false);
    notify(`Added "${label}" — now selected.`, "info");
  };

  return (
    <>
      <div onClick={handleClose} className="fixed inset-0 z-40" style={{ background: "rgba(20, 20, 18, 0.35)" }} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-md rounded-xl shadow-2xl flex flex-col"
          style={{ background: "var(--claude-bg)", border: "1px solid var(--claude-border)", maxHeight: "85vh" }}
        >
          <div className="h-16 px-5 flex items-center justify-between border-b flex-shrink-0" style={{ borderColor: "var(--claude-border)" }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(145deg, var(--claude-accent), var(--claude-accent-hover))" }}>
                <ScribeMark className="w-4 h-4 text-white" />
              </div>
              <div className="flex flex-col justify-center leading-tight">
                <span className="text-[15px] font-semibold font-serif-display" style={{ color: "var(--claude-text)" }}>Settings</span>
                <span className="text-[11px] leading-tight" style={{ color: "var(--claude-muted)" }}>Session & generation preferences</span>
              </div>
            </div>
            <button type="button" onClick={handleClose} aria-label="Close" className="w-8 h-8 rounded-md inline-flex items-center justify-center transition-colors flex-shrink-0" style={{ color: "var(--claude-muted)" }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--claude-surface-2)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="overflow-y-auto px-5 py-5 flex flex-col gap-6">
            {/* Groq key */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5">
                <KeyRound className="w-3.5 h-3.5" style={{ color: "var(--claude-accent)" }} />
                <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--claude-muted)" }}>Groq API key</span>
              </div>
              <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", boxShadow: "0 1px 2px rgba(20,20,18,0.04)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    {session.groqKey && (
                      <span className="relative flex-shrink-0 w-2 h-2 rounded-full" style={{ background: "#2e7d5b" }} title="Active">
                        <span className="absolute inset-0 rounded-full animate-ping" style={{ background: "#2e7d5b", opacity: 0.6 }} />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="text-[13px] font-mono truncate" style={{ color: "var(--claude-text)" }} title={session.groqKey ? "Your key — masked for privacy" : undefined}>
                        {session.groqKey ? maskKey(session.groqKey) : "No key active"}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: "var(--claude-muted)" }}>
                        {session.groqKey ? "Active — used for this session" : "Paste a key to start"}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setKeySwitcherOpen((v) => !v)}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors"
                    style={{ borderColor: "var(--claude-border)", color: "var(--claude-text-2)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--claude-accent)"; e.currentTarget.style.borderColor = "var(--claude-accent)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--claude-text-2)"; e.currentTarget.style.borderColor = "var(--claude-border)"; }}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Change
                  </button>
                </div>

                {keySwitcherOpen && (
                  <div className="mt-3 pt-3 border-t flex flex-col gap-2.5" style={{ borderColor: "var(--claude-border)" }}>
                    {session.keyHistory.filter((p) => p.groqKey !== session.groqKey).length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium" style={{ color: "var(--claude-muted)" }}>Switch to a recent key pair</span>
                        {session.keyHistory.filter((p) => p.groqKey !== session.groqKey).map((pair) => (
                          <div key={pair.groqKey} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)" }}>
                            <button type="button" onClick={() => handleSwitchPair(pair)} className="flex-1 text-left text-[12px] font-mono truncate" style={{ color: "var(--claude-text-2)" }}>
                              {maskKey(pair.groqKey)} {pair.sarvamKey ? `(with Sarvam: ${maskKey(pair.sarvamKey)})` : ""}
                            </button>
                            <button type="button" onClick={() => sessionActions.forgetPair(pair.groqKey)} aria-label="Forget this key pair" className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded transition-colors" style={{ color: "var(--claude-muted)" }}>
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium" style={{ color: "var(--claude-muted)" }}>Or paste a new key</span>
                      <div className="flex gap-1.5">
                        <input type="password" value={newKeyInput} onChange={(e) => setNewKeyInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newKeyInput.trim()) handleSwitchGroq(); }} placeholder="gsk_..." className="flex-1 min-w-0 rounded-md border px-2.5 py-1.5 text-[12px] outline-none" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }} />
                        <button type="button" disabled={!newKeyInput.trim()} onClick={handleSwitchGroq} className="flex-shrink-0 h-8 px-3 rounded-md text-[12px] font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors" style={{ background: "var(--claude-accent)" }}>
                          Use
                        </button>
                      </div>
                    </div>
                    <button type="button" onClick={handleEndSession} className="self-start inline-flex items-center gap-1.5 mt-1 text-[12px] font-medium transition-colors" style={{ color: "#c0392b" }}>
                      <LogOut className="w-3.5 h-3.5" />
                      Remove key & end session
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Sarvam key — optional; chat works without it */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5">
                <KeyRound className="w-3.5 h-3.5" style={{ color: "var(--claude-accent)" }} />
                <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--claude-muted)" }}>
                  Sarvam API key <span style={{ fontWeight: 400, textTransform: "none" }}>— optional, voice only</span>
                </span>
              </div>
              <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", boxShadow: "0 1px 2px rgba(20,20,18,0.04)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    {session.sarvamKey && (
                      <span className="relative flex-shrink-0 w-2 h-2 rounded-full" style={{ background: "#2e7d5b" }} title="Active">
                        <span className="absolute inset-0 rounded-full animate-ping" style={{ background: "#2e7d5b", opacity: 0.6 }} />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="text-[13px] font-mono truncate" style={{ color: "var(--claude-text)" }} title={session.sarvamKey ? "Your key — masked for privacy" : undefined}>
                        {session.sarvamKey ? maskKey(session.sarvamKey) : "No key active"}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: "var(--claude-muted)" }}>
                        {session.sarvamKey ? "Voice enabled — STT/TTS active" : "Voice disabled — add key to enable calls"}
                      </div>
                    </div>
                  </div>
                  <button type="button" onClick={() => setSarvamSwitcherOpen((v) => !v)} className="flex-shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors" style={{ borderColor: "var(--claude-border)", color: "var(--claude-text-2)" }} onMouseEnter={(e) => { e.currentTarget.style.color = "var(--claude-accent)"; e.currentTarget.style.borderColor = "var(--claude-accent)"; }} onMouseLeave={(e) => { e.currentTarget.style.color = "var(--claude-text-2)"; e.currentTarget.style.borderColor = "var(--claude-border)"; }}>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Change
                  </button>
                </div>
                {sarvamSwitcherOpen && (
                  <div className="mt-3 pt-3 border-t flex flex-col gap-2.5" style={{ borderColor: "var(--claude-border)" }}>
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium" style={{ color: "var(--claude-muted)" }}>Paste Sarvam key</span>
                      <div className="flex gap-1.5">
                        <input type="password" value={newSarvamKeyInput} onChange={(e) => setNewSarvamKeyInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleUpdateSarvam(); }} placeholder="Sarvam API key..." className="flex-1 min-w-0 rounded-md border px-2.5 py-1.5 text-[12px] outline-none" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }} />
                        <button type="button" onClick={handleUpdateSarvam} className="flex-shrink-0 h-8 px-3 rounded-md text-[12px] font-medium text-white transition-colors" style={{ background: "var(--claude-accent)" }}>
                          Save
                        </button>
                      </div>
                    </div>
                    {session.sarvamKey && (
                      <button type="button" onClick={handleEndSession} className="self-start inline-flex items-center gap-1.5 mt-1 text-[12px] font-medium transition-colors" style={{ color: "#c0392b" }}>
                        <LogOut className="w-3.5 h-3.5" />
                        Remove key & end session
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Model selection */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5">
                <Cpu className="w-3.5 h-3.5" style={{ color: "var(--claude-accent)" }} />
                <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--claude-muted)" }}>Active LLM Model</span>
              </div>
              <div className="rounded-xl border p-2.5 flex flex-col gap-1.5" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", boxShadow: "0 1px 2px rgba(20,20,18,0.04)" }}>
                {BUILTIN_MODELS.map((m) => {
                  const active = models.selectedModel === m.id;
                  return (
                    <button key={m.id} type="button" onClick={() => { modelActions.selectModel(m.id); notify(`Switched model to ${m.name}`, "info"); }} className="w-full text-left rounded-lg border px-3 py-2 transition-all flex items-start justify-between gap-3 text-[12px] cursor-pointer hover:border-[var(--claude-border-strong)]" style={{ borderColor: active ? "var(--claude-accent)" : "var(--claude-border)", background: active ? "var(--claude-accent-soft)" : "var(--claude-surface)" }}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold" style={{ color: "var(--claude-text)" }}>{m.name}</span>
                          <span className="text-[8px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: active ? "var(--claude-accent)" : "var(--claude-surface-2)", color: active ? "#fff" : "var(--claude-muted)" }}>{m.tag}</span>
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: "var(--claude-muted)" }}>{m.desc}</div>
                      </div>
                      {active && <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--claude-accent)" }} />}
                    </button>
                  );
                })}
                {models.customModels.map((m) => {
                  const active = models.selectedModel === `custom:${m.id}`;
                  return (
                    <button key={m.id} type="button" onClick={() => { modelActions.selectModel(`custom:${m.id}`); notify(`Switched model to ${m.label}`, "info"); }} className="w-full text-left rounded-lg border px-3 py-2 transition-all flex items-start justify-between gap-3 text-[12px] cursor-pointer hover:border-[var(--claude-border-strong)]" style={{ borderColor: active ? "var(--claude-accent)" : "var(--claude-border)", background: active ? "var(--claude-accent-soft)" : "var(--claude-surface)" }}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold" style={{ color: "var(--claude-text)" }}>{m.label}</span>
                          <span className="text-[8px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: active ? "var(--claude-accent)" : "var(--claude-surface-2)", color: active ? "#fff" : "var(--claude-muted)" }}>Custom</span>
                        </div>
                        <div className="text-[10px] mt-0.5 truncate" style={{ color: "var(--claude-muted)" }}>{m.model} · {m.baseUrl}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); modelActions.removeCustom(m.id); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); modelActions.removeCustom(m.id); } }} title="Remove this model" aria-label="Remove this model" className="w-6 h-6 inline-flex items-center justify-center rounded-md transition-colors" style={{ color: "#c0392b" }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </span>
                        {active && <Check className="w-3.5 h-3.5" style={{ color: "var(--claude-accent)" }} />}
                      </div>
                    </button>
                  );
                })}
                {addingCustomModel ? (
                  <div className="rounded-lg border px-3 py-2.5 flex flex-col gap-2 text-[12px]" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface-2)" }}>
                    <input type="text" placeholder="Name (e.g. Mistral)" value={customModelForm.label} onChange={(e) => setCustomModelForm((f) => ({ ...f, label: e.target.value }))} className="w-full rounded-md border px-2.5 py-1.5 text-[12px] outline-none" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }} />
                    <input type="text" placeholder="Base URL (e.g. https://api.mistral.ai/v1)" value={customModelForm.baseUrl} onChange={(e) => setCustomModelForm((f) => ({ ...f, baseUrl: e.target.value }))} className="w-full rounded-md border px-2.5 py-1.5 text-[12px] outline-none" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }} />
                    <input type="password" placeholder="API key" value={customModelForm.apiKey} onChange={(e) => setCustomModelForm((f) => ({ ...f, apiKey: e.target.value }))} className="w-full rounded-md border px-2.5 py-1.5 text-[12px] outline-none" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }} />
                    <input type="text" placeholder="Model id (e.g. ministral-3b-2512)" value={customModelForm.model} onChange={(e) => setCustomModelForm((f) => ({ ...f, model: e.target.value }))} className="w-full rounded-md border px-2.5 py-1.5 text-[12px] outline-none" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }} />
                    <div className="flex justify-end gap-2 mt-0.5">
                      <button type="button" onClick={() => { setAddingCustomModel(false); setCustomModelForm({ label: "", baseUrl: "", apiKey: "", model: "" }); }} className="h-7 px-3 rounded-md text-[12px] font-medium" style={{ color: "var(--claude-text-2)" }}>Cancel</button>
                      <button type="button" onClick={handleAddCustom} className="h-7 px-3 rounded-md text-[12px] font-medium text-white" style={{ background: "var(--claude-accent)" }}>Add</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setAddingCustomModel(true)} className="w-full text-left rounded-lg border border-dashed px-3 py-2 text-[12px] font-medium transition-colors flex items-center gap-1.5" style={{ borderColor: "var(--claude-border-strong)", color: "var(--claude-muted)" }}>
                    <Plus className="w-3.5 h-3.5" />
                    Add a model (any OpenAI-compatible API)
                  </button>
                )}
              </div>
            </div>

            {/* Generation settings */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5">
                <SlidersHorizontal className="w-3.5 h-3.5" style={{ color: "var(--claude-accent)" }} />
                <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--claude-muted)" }}>RAG & generation</span>
              </div>
              <div className="rounded-xl border px-4 py-4 flex flex-col gap-5" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", boxShadow: "0 1px 2px rgba(20,20,18,0.04)" }}>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[13px] font-medium" style={{ color: "var(--claude-text-2)" }}>Chunks retrieved (top_k)</label>
                    <div className="flex items-center gap-1.5">
                      <button type="button" disabled={session.isDemoSession || generation.topK <= 1} onClick={() => generationActions.setTopK(Math.max(1, generation.topK - 1))} className="w-6 h-6 rounded-md border flex items-center justify-center text-[12px] font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-bg)", color: "var(--claude-text)" }}>-</button>
                      <span className="text-[12px] font-mono font-semibold w-6 text-center" style={{ color: "var(--claude-text)" }}>{session.isDemoSession ? DEMO_TOP_K : generation.topK}</span>
                      <button type="button" disabled={session.isDemoSession || generation.topK >= 20} onClick={() => generationActions.setTopK(Math.min(20, generation.topK + 1))} className="w-6 h-6 rounded-md border flex items-center justify-center text-[12px] font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-bg)", color: "var(--claude-text)" }}>+</button>
                    </div>
                  </div>
                  <input type="range" min={1} max={20} step={1} value={session.isDemoSession ? DEMO_TOP_K : generation.topK} onChange={(e) => generationActions.setTopK(Number(e.target.value))} disabled={session.isDemoSession} className="w-full custom-range-slider" style={session.isDemoSession ? { opacity: 0.5, cursor: "not-allowed" } : undefined} />
                  <p className="text-[11px]" style={{ color: "var(--claude-muted)" }}>{session.isDemoSession ? `Fixed at ${DEMO_TOP_K} for demo sessions.` : "More chunks = better context coverage."}</p>
                </div>
                <div className="flex flex-col gap-1.5 pt-4 border-t" style={{ borderColor: "var(--claude-border)" }}>
                  <div className="flex items-center justify-between">
                    <label className="text-[13px] font-medium" style={{ color: "var(--claude-text-2)" }}>Temperature</label>
                    <div className="flex items-center gap-1.5">
                      <button type="button" disabled={generation.temperature <= 0.0} onClick={() => generationActions.setTemperature(Math.max(0.0, Number((generation.temperature - 0.1).toFixed(1))))} className="w-6 h-6 rounded-md border flex items-center justify-center text-[12px] font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-bg)", color: "var(--claude-text)" }}>-</button>
                      <span className="text-[12px] font-mono font-semibold w-8 text-center" style={{ color: "var(--claude-text)" }}>{generation.temperature.toFixed(1)}</span>
                      <button type="button" disabled={generation.temperature >= 2.0} onClick={() => generationActions.setTemperature(Math.min(2.0, Number((generation.temperature + 0.1).toFixed(1))))} className="w-6 h-6 rounded-md border flex items-center justify-center text-[12px] font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-bg)", color: "var(--claude-text)" }}>+</button>
                    </div>
                  </div>
                  <input type="range" min={0} max={2} step={0.1} value={generation.temperature} onChange={(e) => generationActions.setTemperature(Number(e.target.value))} className="w-full custom-range-slider" />
                  <p className="text-[11px]" style={{ color: "var(--claude-muted)" }}>Lower = precise & focused; higher = creative & diverse.</p>
                </div>
                <div className="flex flex-col gap-1.5 pt-4 border-t" style={{ borderColor: "var(--claude-border)" }}>
                  <div className="flex items-center justify-between">
                    <label className="text-[13px] font-medium" style={{ color: "var(--claude-text-2)" }}>Max answer tokens</label>
                    <div className="flex items-center gap-1.5">
                      <button type="button" disabled={generation.maxTokens <= 50} onClick={() => generationActions.setMaxTokens(Math.max(50, generation.maxTokens - 50))} className="w-6 h-6 rounded-md border flex items-center justify-center text-[12px] font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-bg)", color: "var(--claude-text)" }}>-</button>
                      <span className="text-[12px] font-mono font-semibold w-10 text-center" style={{ color: "var(--claude-text)" }}>{generation.maxTokens}</span>
                      <button type="button" disabled={generation.maxTokens >= 4000} onClick={() => generationActions.setMaxTokens(Math.min(4000, generation.maxTokens + 50))} className="w-6 h-6 rounded-md border flex items-center justify-center text-[12px] font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-bg)", color: "var(--claude-text)" }}>+</button>
                    </div>
                  </div>
                  <input type="range" min={50} max={4000} step={50} value={generation.maxTokens} onChange={(e) => generationActions.setMaxTokens(Number(e.target.value))} className="w-full custom-range-slider" />
                  <p className="text-[11px]" style={{ color: "var(--claude-muted)" }}>Controls the maximum length of generated replies.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="px-5 py-3.5 border-t flex-shrink-0 flex justify-between items-center" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}>
            <button type="button" onClick={() => { generationActions.reset(); notify("Restored default generation settings", "info"); }} className="inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors" style={{ color: "var(--claude-muted)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--claude-text-2)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--claude-muted)")}>
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to defaults
            </button>
            <button type="button" onClick={handleClose} className="h-9 px-5 rounded-lg text-[13px] font-medium transition-colors" style={{ background: "var(--claude-accent)", color: "white", boxShadow: "0 2px 8px -2px var(--claude-accent)" }} onMouseEnter={(e) => (e.currentTarget.style.background = "var(--claude-accent-hover)")} onMouseLeave={(e) => (e.currentTarget.style.background = "var(--claude-accent)")}>
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
