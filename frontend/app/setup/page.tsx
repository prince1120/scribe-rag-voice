"use client";

// The one question asked on first arrival: Personal or Business?
//
// Asked once, and only once — it decides which product the person gets, so it
// is deliberately a fork rather than a settings toggle buried three screens
// deep. Someone who never answers keeps the personal app, which is what every
// existing user already has.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ScribeMark } from "../Logo";
import { defaultTemplate, templateForCategory } from "../agent/templates";

interface Category {
  id: string;
  label: string;
}

type Mode = "personal" | "business";

export default function SetupPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/v1/workspace/categories", {
          credentials: "include",
        });
        if (response.ok) setCategories((await response.json()).categories || []);
      } catch {
        // The list is only needed once Business is picked; a failure here is
        // recoverable by reloading, and blocking the whole screen on it would
        // be worse than a temporarily empty select.
      }
    })();
  }, []);

  const submit = useCallback(
    async (chosen: Mode) => {
      setSaving(true);
      setError("");
      try {
        const response = await fetch("/api/v1/workspace/mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            mode: chosen,
            business_name: chosen === "business" ? businessName.trim() : undefined,
            business_category: chosen === "business" ? category : undefined,
          }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          // The server writes these messages for the person reading them, so
          // they are shown as-is rather than replaced with something generic.
          throw new Error(body?.detail || "Could not save that.");
        }

        // For business, seed the agent with a category template so the editor
        // is not blank — the owner edits a working example, not from zero.
        if (chosen === "business") {
          const tmpl = templateForCategory(category) ?? defaultTemplate(businessName.trim());
          try {
            await fetch("/api/v1/workspace/agent", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                name: businessName.trim() || "Assistant",
                greeting: tmpl.greeting,
                voice_script: tmpl.voice_script,
                chat_script: tmpl.chat_script,
                voice_id: tmpl.voice_id || "anushka",
                language: tmpl.language || "unknown",
                rag_enabled: true,
                style_rules_enabled: true,
              }),
            });
          } catch {
            /* template seed is best-effort — agent page will show empty and the owner can still type */
          }
          // Seed one sample FAQ so RAG has something to ground on immediately.
          // Enabled by default (agent_enabled true) and capped at 3 docs total anyway.
          if (tmpl.sampleDoc) {
            try {
              await fetch("/api/v1/documents/paste", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ title: tmpl.sampleDoc.filename, content: tmpl.sampleDoc.content }),
              });
            } catch {
              /* doc seed is optional — owner can upload manually on agent page */
            }
          }
        }

        // Business goes to the agent editor, because a business with no agent
        // has nothing to share yet. Personal goes straight to the app.
        router.replace(chosen === "business" ? "/agent" : "/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save that.");
      } finally {
        setSaving(false);
      }
    },
    [businessName, category, router]
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--claude-bg)" }}>
      <header className="signin-header">
        <Link href="/" className="signin-header-brand">
          <span className="signin-header-mark" aria-hidden="true">
            <ScribeMark className="w-5 h-5" />
          </span>
          <span className="signin-header-text">Scribe</span>
        </Link>
        <nav className="signin-header-nav" aria-label="Secondary">
          <Link href="/directory" className="signin-header-link">
            Directory ↗
          </Link>
          <Link href="/signin" className="signin-header-link">
            Sign in
          </Link>
        </nav>
      </header>
      <main className="setup-page" style={{ flex: 1, minHeight: "auto" }}>
        <div className="setup-inner">
        <header className="setup-header">
          <h1 className="setup-title">How will you use Scribe?</h1>
          <p className="setup-sub">
            This decides what you see. You can change it later.
          </p>
        </header>

        <div className="setup-choices">
          <button
            type="button"
            className={`setup-card ds-lift ${mode === "personal" ? "is-active" : ""}`}
            onClick={() => setMode("personal")}
            aria-pressed={mode === "personal"}
          >
            <span className="setup-card-title">For myself</span>
            <span className="setup-card-body">
              Upload your own documents and ask questions about them, by typing
              or by voice.
            </span>
          </button>

          <button
            type="button"
            className={`setup-card ds-lift ${mode === "business" ? "is-active" : ""}`}
            onClick={() => setMode("business")}
            aria-pressed={mode === "business"}
          >
            <span className="setup-card-title">For my business</span>
            <span className="setup-card-body">
              Build an assistant your customers can call. Share a link, and read
              every conversation they have.
            </span>
          </button>
        </div>

        {mode === "business" && (
          <div className="setup-form ds-animate-rise">
            <label className="setup-label" htmlFor="business-name">
              What is your business called?
            </label>
            <input
              id="business-name"
              className="setup-input"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Sharma Dental Clinic"
              maxLength={200}
              autoFocus
            />

            <label className="setup-label" htmlFor="business-category">
              What kind of business is it?
            </label>
            <select
              id="business-category"
              className="setup-input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Choose one…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="setup-error" role="alert">{error}</p>}

          {mode && (
            <button
              type="button"
              className="setup-continue ds-pressable ds-tap"
              onClick={() => submit(mode)}
              disabled={
                saving ||
                (mode === "business" && (!businessName.trim() || !category))
              }
            >
              {saving ? "Saving…" : mode === "business" ? "Continue to my agent" : "Start using Scribe"}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
