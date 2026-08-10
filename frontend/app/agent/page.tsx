"use client";

// The business owner's whole product surface: one agent, configured here.
//
// There is no agent list and no "create new" — one owner, one assistant. A
// list would need a picker, a default, and a per-link choice, none of which
// earns its complexity for a single business phone line.

import { useCallback, useEffect, useState } from "react";

import { AgentDocuments } from "./AgentDocuments";
import { AgentTest } from "./AgentTest";

interface AgentConfig {
  name?: string;
  status?: string;
  script: string;
  voice_id: string;
  rag_enabled: boolean;
  greeting: string | null;
  configured: boolean;
}

interface Voice {
  id: string;
  label: string;
  tagline: string;
}

export default function AgentPage() {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [voices, setVoices] = useState<Record<string, Voice[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [docCount, setDocCount] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [agentRes, voicesRes] = await Promise.all([
          fetch("/api/v1/workspace/agent", { credentials: "include" }),
          fetch("/api/v1/voice/voices", { credentials: "include" }),
        ]);

        if (agentRes.status === 403) {
          setError("Only the workspace owner can change the agent.");
          return;
        }
        if (agentRes.ok) setConfig(await agentRes.json());
        if (voicesRes.ok) setVoices((await voicesRes.json()).voices || {});
      } catch {
        setError("Could not load your agent.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = useCallback((patch: Partial<AgentConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaved(false);
  }, []);

  async function save() {
    if (!config) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/v1/workspace/agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: config.name,
          script: config.script,
          voice_id: config.voice_id,
          rag_enabled: config.rag_enabled,
          greeting: config.greeting || undefined,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not save.");
      }
      setConfig(await response.json());
      setSaved(true);
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
      const response = await fetch(
        `/api/v1/workspace/agent/${live ? "deploy" : "undeploy"}`,
        { method: "POST", credentials: "include" }
      );
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

  /** Hearing a voice before committing to it beats reading a one-line
   *  tagline — this is the assistant every caller will hear. */
  async function preview(voiceId: string) {
    setPreviewing(voiceId);
    try {
      const response = await fetch("/api/v1/voice/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ speaker: voiceId }),
      });
      if (!response.ok) return;
      const data = await response.json();
      const audio = new Audio(`data:${data.mime_type};base64,${data.audio_base64}`);
      await audio.play();
    } catch {
      // A failed preview should not block configuring the agent.
    } finally {
      setPreviewing("");
    }
  }

  if (loading) {
    return (
      <main className="agent-page">
        <div className="agent-inner">
          <span className="ds-skeleton agent-skeleton" />
          <span className="ds-skeleton agent-skeleton" />
        </div>
      </main>
    );
  }

  if (!config) {
    return (
      <main className="agent-page">
        <div className="agent-inner">
          <p className="agent-error" role="alert">{error || "No agent found."}</p>
        </div>
      </main>
    );
  }

  const allVoices = [...(voices.female || []), ...(voices.male || [])];

  return (
    <main className="agent-page ds-scroll">
      <div className="agent-inner">
        <header className="agent-header">
          <div>
            <h1 className="agent-title">Your assistant</h1>
            <p className="agent-sub">
              This is what your customers hear when they call your link.
            </p>
          </div>
          <a href="/links" className="agent-link">Share links →</a>
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
            disabled={deploying || !config.script.trim()}
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

        <section className="agent-section">
          <label className="agent-label" htmlFor="script">
            What should it say?
          </label>
          <p className="agent-hint">
            Describe who it is and how it should talk. This matters more than
            any other setting.
          </p>
          <textarea
            id="script"
            className="agent-textarea ds-scroll"
            value={config.script}
            onChange={(e) => update({ script: e.target.value })}
            rows={8}
            maxLength={8000}
          />
        </section>

        <section className="agent-section">
          <label className="agent-label" htmlFor="greeting">
            First thing it says <span className="agent-optional">optional</span>
          </label>
          <input
            id="greeting"
            className="agent-input"
            value={config.greeting || ""}
            onChange={(e) => update({ greeting: e.target.value })}
            placeholder="Hello! Thanks for calling Sharma Clinic. How can I help?"
            maxLength={500}
          />
        </section>

        <section className="agent-section">
          <span className="agent-label">Voice</span>
          <div className="agent-voices">
            {allVoices.map((voice) => (
              <button
                key={voice.id}
                type="button"
                className={`agent-voice ds-pressable ds-tap ${config.voice_id === voice.id ? "is-active" : ""}`}
                onClick={() => update({ voice_id: voice.id })}
              >
                <span className="agent-voice-name">{voice.label}</span>
                <span className="agent-voice-tag">{voice.tagline}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className="agent-voice-play"
                  onClick={(e) => { e.stopPropagation(); void preview(voice.id); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.stopPropagation(); void preview(voice.id); }
                  }}
                >
                  {previewing === voice.id ? "…" : "▶"}
                </span>
              </button>
            ))}
          </div>
        </section>

        <AgentDocuments onCountChange={setDocCount} />

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
                On, it answers from what you upload. Off, it follows the script
                alone. Chat always uses your documents; this controls voice.
              </span>
              <span className="agent-hint">
                {docCount === null
                  ? ""
                  : docCount === 0
                    ? "No documents yet — add some before turning this on."
                    : `${docCount} document${docCount === 1 ? "" : "s"} attached.`}

              </span>
            </span>
          </label>
        </section>

        {error && <p className="agent-error" role="alert">{error}</p>}

        <div className="agent-actions">
          <button
            type="button"
            className="agent-save ds-pressable ds-tap"
            onClick={save}
            disabled={saving || !config.script.trim()}
          >
            {saving ? "Saving…" : saved ? "Saved" : "Save agent"}
          </button>
        </div>

        <AgentTest deployed={config.status === "deployed"} />
      </div>
    </main>
  );
}
