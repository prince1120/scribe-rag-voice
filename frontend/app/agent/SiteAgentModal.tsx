"use client";
import { useState, useRef, useEffect } from "react";
import { Globe, Sparkles, Loader2, X, Upload, Check, Mic, MessageSquare, ArrowLeft, CheckCircle2, Edit3, Volume2 } from "lucide-react";
import { ownerFetch } from "../lib/ownerFetch";

interface GeneratedPreview {
  voice_script: string;
  chat_script: string;
  greeting: string;
  business: string;
  pages_found: number;
}

export function SiteAgentModal({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [step, setStep] = useState<"input" | "preview">("input");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [goal, setGoal] = useState("");
  const [tone, setTone] = useState("warm & friendly");
  const [language, setLanguage] = useState("unknown");
  const [channel, setChannel] = useState<"both" | "voice" | "chat">("both");
  
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [creationFiles, setCreationFiles] = useState<File[]>([]);
  const [uploadingCreation, setUploadingCreation] = useState(false);
  const [progress, setProgress] = useState(0);
  
  // Preview / Editor State
  const [previewVoiceScript, setPreviewVoiceScript] = useState("");
  const [previewChatScript, setPreviewChatScript] = useState("");
  const [previewGreeting, setPreviewGreeting] = useState("");
  const [activePreviewTab, setActivePreviewTab] = useState<"voice" | "chat">("voice");

  const creationInputRef = useRef<HTMLInputElement>(null);
  
  const progressMsgs = [
    "Fetching site URL & documents…",
    "Crawling sub-pages via sitemap…",
    "Extracting services, pricing, hours & FAQs…",
    "Synthesizing voice-optimized spoken prompt…",
    "Formatting structured chat prompt & preview…",
  ];

  useEffect(() => {
    if (!generating) return;
    setProgress(0);
    const id = setInterval(() => setProgress((p) => (p >= progressMsgs.length - 1 ? p : p + 1)), 850);
    return () => clearInterval(id);
  }, [generating]);

  const handleCreationFiles = (files: FileList | null) => {
    if (!files) return;
    setCreationFiles(Array.from(files).slice(0, 3));
  };

  const uploadCreationFiles = async () => {
    if (creationFiles.length === 0) return;
    setUploadingCreation(true);
    try {
      for (const f of creationFiles) {
        const form = new FormData();
        form.append("file", f);
        const res = await ownerFetch("/api/v1/documents/upload?purpose=agent", { method: "POST", body: form });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          throw new Error(b?.detail || `Failed ${f.name}`);
        }
      }
    } finally {
      setUploadingCreation(false);
    }
  };

  // Step 1 -> Generate Preview
  const handleGeneratePreview = async () => {
    setGenerating(true);
    setError("");
    try {
      if (creationFiles.length > 0) {
        await uploadCreationFiles();
      }
      const payload = {
        url: url.trim() || undefined,
        name: name.trim() || undefined,
        business: business.trim() || undefined,
        goal: goal.trim() || undefined,
        tone,
        language,
        channel,
      };

      const res = await ownerFetch("/api/v1/workspace/agents/generate-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.detail || "Could not generate prompt preview");
      }

      const data: GeneratedPreview = await res.json();
      setPreviewVoiceScript(data.voice_script || "");
      setPreviewChatScript(data.chat_script || "");
      setPreviewGreeting(data.greeting || `Hello! This is ${name.trim() || "your assistant"} from ${data.business || "our business"}. How can I help you today?`);
      if (channel === "chat") {
        setActivePreviewTab("chat");
      } else {
        setActivePreviewTab("voice");
      }
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate preview");
    } finally {
      setGenerating(false);
    }
  };

  // Step 2 -> Save Agent
  const handleSaveAgent = async () => {
    setSaving(true);
    setError("");
    try {
      const payload: any = {
        url: url.trim() || undefined,
        name: name.trim() || undefined,
        business: business.trim() || undefined,
        goal: goal.trim() || undefined,
        tone,
        language,
        channel,
        voice_script: channel === "chat" ? "" : previewVoiceScript,
        chat_script: channel === "voice" ? "" : previewChatScript,
        greeting: previewGreeting,
      };

      const res = await ownerFetch("/api/v1/workspace/agents/from-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.detail || "Could not save agent");
      }

      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save agent");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92dvh] overflow-y-auto p-5 sm:p-6 flex flex-col gap-4 shadow-2xl"
        style={{ border: "1px solid var(--claude-border)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b" style={{ borderColor: "var(--claude-border)" }}>
          <div className="flex items-center gap-2.5">
            {step === "preview" && (
              <button
                type="button"
                onClick={() => setStep("input")}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
                title="Back to settings"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "var(--claude-accent)", color: "#fff" }}>
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="text-[16px] font-bold leading-tight" style={{ color: "var(--claude-text)" }}>
                {step === "input" ? "Create Voice & Chat Assistant" : "Review & Edit Generated Prompts"}
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {step === "input"
                  ? "Crawl site or upload docs to generate voice-optimized conversational prompts"
                  : "Inspect, refine, or customize the generated spoken voice script & chat guidelines"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* STEP 1: INPUTS */}
        {step === "input" && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3">
              {/* Site URL card */}
              <div
                className="rounded-xl border p-3 flex flex-col gap-2 transition-all"
                style={{
                  borderColor: url.trim() ? "var(--claude-accent)" : "var(--claude-border)",
                  background: url.trim() ? "var(--claude-accent-soft)" : "var(--claude-bg)",
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{
                      background: url.trim() ? "var(--claude-accent)" : "var(--claude-surface-2)",
                      color: url.trim() ? "#fff" : "var(--claude-muted)",
                    }}
                  >
                    <Globe size={14} />
                  </div>
                  <span className="text-[11px] font-bold tracking-wide uppercase" style={{ color: url.trim() ? "var(--claude-accent)" : "var(--claude-muted)" }}>
                    Option 1 — Site URL
                  </span>
                  {url.trim() && (
                    <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: "var(--claude-accent)" }}>
                      selected
                    </span>
                  )}
                </div>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://yourbusiness.com"
                  className="w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none focus:ring-2 bg-white"
                  style={{ borderColor: url.trim() ? "var(--claude-accent)" : "var(--claude-border)" }}
                />
                <span className="text-[10px] text-gray-500">
                  Crawls pages → extracts services, pricing, hours & FAQs into voice & chat prompts.
                </span>
              </div>

              {/* OR divider */}
              <div className="flex items-center gap-3 py-0.5">
                <div className="flex-1 h-px" style={{ background: "var(--claude-border)" }} />
                <span className="text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full border bg-white text-gray-400">
                  OR / AND
                </span>
                <div className="flex-1 h-px" style={{ background: "var(--claude-border)" }} />
              </div>

              {/* Upload docs card */}
              <div
                className="rounded-xl border p-3 flex flex-col gap-2 transition-all"
                style={{
                  borderColor: creationFiles.length > 0 ? "var(--claude-accent)" : "var(--claude-border)",
                  background: creationFiles.length > 0 ? "var(--claude-accent-soft)" : "var(--claude-bg)",
                }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{
                      background: creationFiles.length > 0 ? "var(--claude-accent)" : "var(--claude-surface-2)",
                      color: creationFiles.length > 0 ? "#fff" : "var(--claude-muted)",
                    }}
                  >
                    <Upload size={14} />
                  </div>
                  <span className="text-[11px] font-bold tracking-wide uppercase" style={{ color: creationFiles.length > 0 ? "var(--claude-accent)" : "var(--claude-muted)" }}>
                    Option 2 — Upload Documents (PDF / Word)
                  </span>
                  {creationFiles.length > 0 && (
                    <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: "var(--claude-accent)" }}>
                      {creationFiles.length} selected
                    </span>
                  )}
                </div>
                <input
                  ref={creationInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.pptx,.txt,.csv,.xlsx,.md"
                  className="hidden"
                  onChange={(e) => handleCreationFiles(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => creationInputRef.current?.click()}
                  className="w-full h-9 rounded-lg border text-[12px] font-medium flex items-center justify-center gap-1.5 bg-white hover:bg-gray-50 transition-colors"
                  style={{ borderColor: "var(--claude-border-strong)" }}
                >
                  <Upload size={14} /> {creationFiles.length > 0 ? `${creationFiles.length} file(s) chosen — click to change` : "Choose PDF/Doc files (max 3)"}
                </button>
                {creationFiles.length > 0 && (
                  <div className="text-[11px] truncate px-1 text-gray-700 font-medium">
                    {creationFiles.map((f) => f.name).join(", ")}
                  </div>
                )}
              </div>
            </div>

            {/* Channel Chooser */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold tracking-wide uppercase text-gray-500">Agent Type</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "both", label: "Voice + Chat", icon: <span className="flex items-center gap-1"><Mic size={12} /><MessageSquare size={12} /></span> },
                  { id: "voice", label: "Voice Calls Only", icon: <Mic size={12} /> },
                  { id: "chat", label: "Text Chat Only", icon: <MessageSquare size={12} /> },
                ].map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setChannel(c.id as any)}
                    className="h-9 rounded-lg border text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-all"
                    style={{
                      borderColor: channel === c.id ? "var(--claude-accent)" : "var(--claude-border)",
                      background: channel === c.id ? "var(--claude-accent)" : "white",
                      color: channel === c.id ? "white" : "var(--claude-text-2)",
                    }}
                  >
                    {c.icon} {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Questionnaire */}
            <div className="grid gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-gray-700">What is the primary role of this assistant? *</span>
                <input
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. Answer customer FAQs, explain pricing, book appointments"
                  className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1 bg-white"
                  style={{ borderColor: "var(--claude-border)" }}
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-gray-700">Assistant Name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Saarthi, Alex, Maya"
                    className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1 bg-white"
                    style={{ borderColor: "var(--claude-border)" }}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-gray-700">Business Name</span>
                  <input
                    value={business}
                    onChange={(e) => setBusiness(e.target.value)}
                    placeholder="e.g. Saarvix, Apex Dental"
                    className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1 bg-white"
                    style={{ borderColor: "var(--claude-border)" }}
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-gray-700">Tone & Demeanor</span>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none bg-white"
                    style={{ borderColor: "var(--claude-border)" }}
                  >
                    <option>warm & friendly</option>
                    <option>professional & concise</option>
                    <option>empathetic & patient</option>
                    <option>energetic & cheerful</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-gray-700">Language Preference</span>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none bg-white"
                    style={{ borderColor: "var(--claude-border)" }}
                  >
                    <option value="unknown">Auto-detect (Hinglish / Hindi / English)</option>
                    <option value="hi-IN">Hindi (Respectful 'aap')</option>
                    <option value="en-IN">Indian English</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Progress indicator */}
            {generating && (
              <div className="rounded-xl border p-3 flex flex-col gap-2 bg-indigo-50/50" style={{ borderColor: "var(--claude-border)" }}>
                <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: "var(--claude-accent)" }}>
                  <Loader2 size={14} className="animate-spin" /> {progressMsgs[progress]}
                </div>
                <div className="flex flex-col gap-1">
                  {progressMsgs.map((m, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 text-[11px]"
                      style={{
                        color: i === progress ? "var(--claude-text)" : i < progress ? "var(--color-success)" : "var(--claude-muted)",
                        fontWeight: i === progress ? 600 : 400,
                      }}
                    >
                      <span
                        className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] border"
                        style={{
                          background: i < progress ? "var(--color-success)" : i === progress ? "var(--claude-accent)" : "#f3f4f6",
                          color: i <= progress ? "#fff" : "#9ca3af",
                          borderColor: i < progress ? "var(--color-success)" : i === progress ? "var(--claude-accent)" : "#e5e7eb",
                        }}
                      >
                        {i < progress ? <Check size={10} /> : i + 1}
                      </span>
                      {m}
                    </div>
                  ))}
                </div>
                <div className="w-full h-1.5 rounded-full overflow-hidden bg-gray-200">
                  <div
                    className="h-full transition-all duration-500"
                    style={{ width: `${((progress + 1) / progressMsgs.length) * 100}%`, background: "var(--claude-accent)" }}
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg px-3 py-2 text-[12px] leading-4 border bg-red-50 text-red-800 border-red-200">
                <span className="font-semibold">Error:</span> {error}
              </div>
            )}

            <button
              onClick={handleGeneratePreview}
              disabled={generating || uploadingCreation || !goal.trim()}
              className="w-full h-[44px] rounded-xl text-[13px] font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all active:scale-[0.99] shadow-md hover:shadow-lg"
              style={{
                background: generating ? "var(--claude-muted)" : "linear-gradient(135deg, #4854A8 0%, #6366F1 100%)",
              }}
            >
              {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {generating ? progressMsgs[progress] : "Generate & Preview Prompts →"}
            </button>
          </div>
        )}

        {/* STEP 2: INTERACTIVE PREVIEW & EDIT */}
        {step === "preview" && (
          <div className="flex flex-col gap-4">
            {/* Tab switch for voice vs chat */}
            <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: "var(--claude-border)" }}>
              <div className="flex items-center gap-2">
                {channel !== "chat" && (
                  <button
                    type="button"
                    onClick={() => setActivePreviewTab("voice")}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-bold flex items-center gap-1.5 transition-all ${
                      activePreviewTab === "voice"
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <Mic size={14} /> Voice Call Prompt
                  </button>
                )}
                {channel !== "voice" && (
                  <button
                    type="button"
                    onClick={() => setActivePreviewTab("chat")}
                    className={`px-3 py-1.5 rounded-lg text-[12px] font-bold flex items-center gap-1.5 transition-all ${
                      activePreviewTab === "chat"
                        ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    <MessageSquare size={14} /> Text Chat Prompt
                  </button>
                )}
              </div>
              <span className="text-[11px] text-gray-500 font-medium flex items-center gap-1">
                <Edit3 size={12} /> Editable
              </span>
            </div>

            {/* Voice Script Editor */}
            {activePreviewTab === "voice" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-gray-700 flex items-center gap-1">
                    <Volume2 size={13} className="text-red-500" /> Spoken Dialogue Instructions
                  </span>
                  <span className="text-gray-500">{previewVoiceScript.length} / 4000 characters</span>
                </div>
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] leading-4 text-amber-900 flex items-start gap-2">
                  <Sparkles size={14} className="mt-0.5 text-amber-600 flex-shrink-0" />
                  <span>
                    <strong>Voice Optimized:</strong> Uses spoken contractions, 1–2 short sentences per turn, phonetic numbers/pricing, zero markdown, and graceful turn-taking.
                  </span>
                </div>
                <textarea
                  value={previewVoiceScript}
                  onChange={(e) => setPreviewVoiceScript(e.target.value)}
                  rows={9}
                  className="w-full rounded-xl border p-3 text-[12px] font-mono leading-relaxed outline-none focus:ring-2 focus:ring-indigo-300 bg-gray-50 text-gray-800"
                  style={{ borderColor: "var(--claude-border)" }}
                />
              </div>
            )}

            {/* Chat Script Editor */}
            {activePreviewTab === "chat" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-gray-700 flex items-center gap-1">
                    <MessageSquare size={13} className="text-indigo-500" /> Text Chat Guidelines
                  </span>
                  <span className="text-gray-500">{previewChatScript.length} / 6000 characters</span>
                </div>
                <div className="p-2.5 rounded-lg bg-indigo-50 border border-indigo-200 text-[11px] leading-4 text-indigo-900 flex items-start gap-2">
                  <Sparkles size={14} className="mt-0.5 text-indigo-600 flex-shrink-0" />
                  <span>
                    <strong>Chat Optimized:</strong> Direct answer first, clean Markdown formatting, and knowledge base document citations.
                  </span>
                </div>
                <textarea
                  value={previewChatScript}
                  onChange={(e) => setPreviewChatScript(e.target.value)}
                  rows={9}
                  className="w-full rounded-xl border p-3 text-[12px] font-mono leading-relaxed outline-none focus:ring-2 focus:ring-indigo-300 bg-gray-50 text-gray-800"
                  style={{ borderColor: "var(--claude-border)" }}
                />
              </div>
            )}

            {/* Opening Greeting */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-semibold text-gray-700">Opening Greeting / Welcome Message</label>
              <input
                value={previewGreeting}
                onChange={(e) => setPreviewGreeting(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-[12px] outline-none focus:ring-1 bg-white"
                style={{ borderColor: "var(--claude-border)" }}
                placeholder="e.g. Hello! Thanks for calling. How can I help you today?"
              />
            </div>

            {error && (
              <div className="rounded-lg px-3 py-2 text-[12px] leading-4 border bg-red-50 text-red-800 border-red-200">
                <span className="font-semibold">Error:</span> {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep("input")}
                className="px-4 py-2.5 rounded-xl border text-[13px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                style={{ borderColor: "var(--claude-border)" }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleSaveAgent}
                disabled={saving}
                className="flex-1 h-[42px] rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all active:scale-[0.99]"
                style={{
                  background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                }}
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {saving ? "Saving Assistant…" : "Confirm & Save Assistant ✓"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
