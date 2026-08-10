"use client";

import { ownerFetch } from "../lib/ownerFetch";

// Account settings for a business owner.
//
// One job today: set the password that /signin expects. The workspace already
// exists — it was created by the API keys the owner brought — so this is not a
// registration form. It is a second way back into something they already own,
// which is why nothing here creates anything and why the copy avoids the word
// "sign up".

import { useEffect, useState } from "react";

import { OwnerShell } from "../components/owner/OwnerShell";

export default function SettingsPage() {
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  // Provider credentials. Values come back masked, so an empty field means
  // "leave whatever is stored alone" rather than "clear it".
  const [providers, setProviders] = useState<{
    groq_key?: string | null;
    sarvam_key?: string | null;
    custom_llm_key?: string | null;
    custom_llm_base_url?: string | null;
    llm_model?: string | null;
  }>({});
  const [groqKey, setGroqKey] = useState("");
  const [sarvamKey, setSarvamKey] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [model, setModel] = useState("");
  const [savingKeys, setSavingKeys] = useState(false);
  const [keysSaved, setKeysSaved] = useState(false);
  const [keyError, setKeyError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [wsRes, provRes] = await Promise.all([
          ownerFetch("/api/v1/workspace"),
          ownerFetch("/api/v1/workspace/providers"),
        ]);
        if (cancelled) return;
        if (wsRes.ok) setBusinessName((await wsRes.json()).business_name);
        if (provRes.ok) {
          const data = await provRes.json();
          setProviders(data);
          setCustomUrl(data.custom_llm_base_url || "");
          setModel(data.llm_model || "");
        }
      } catch {
        // The rail falls back to a generic label; nothing here depends on it.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();

    // Checked here as well as on the server so the mismatch is caught before a
    // round trip, and so the message can name which field is wrong.
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await ownerFetch("/api/v1/workspace/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not save that.");
      }

      setDone(true);
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  async function saveKeys(event: React.FormEvent) {
    event.preventDefault();
    setSavingKeys(true);
    setKeyError("");
    try {
      const response = await ownerFetch("/api/v1/workspace/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Only send what was typed. Sending empty strings would clear keys the
        // owner never touched.
        body: JSON.stringify({
          groq_key: groqKey.trim() || undefined,
          sarvam_key: sarvamKey.trim() || undefined,
          custom_llm_key: customKey.trim() || undefined,
          custom_llm_base_url: customUrl.trim() || undefined,
          llm_model: model.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not save.");
      }
      setProviders(await response.json());
      // Cleared so a live key is not left sitting in the DOM after saving.
      setGroqKey(""); setSarvamKey(""); setCustomKey("");
      setKeysSaved(true);
      setTimeout(() => setKeysSaved(false), 2500);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSavingKeys(false);
    }
  }

  return (
    <OwnerShell businessName={businessName}>
      <main className="dash-page">
        <header className="dash-header">
          <h1 className="dash-title">Account</h1>
          <p className="dash-sub">
            How you get back into this console.
          </p>
        </header>

        <form className="settings-card" onSubmit={saveKeys}>
          <h2 className="dash-section-title">Keys and model</h2>
          <p className="dash-hint">
            Your assistant answers on your account, so it needs your keys.
            They are encrypted before being stored and never shown again —
            leave a field blank to keep what is already saved.
          </p>

          <label className="signin-label" htmlFor="groq">
            Groq API key {providers.groq_key && <span className="agent-optional">saved: {providers.groq_key}</span>}
          </label>
          <input
            id="groq" className="signin-input" type="password" autoComplete="off"
            value={groqKey} onChange={(e) => setGroqKey(e.target.value)}
            placeholder={providers.groq_key ? "Leave blank to keep" : "gsk_…"}
          />

          <label className="signin-label" htmlFor="sarvam">
            Sarvam API key {providers.sarvam_key && <span className="agent-optional">saved: {providers.sarvam_key}</span>}
          </label>
          <input
            id="sarvam" className="signin-input" type="password" autoComplete="off"
            value={sarvamKey} onChange={(e) => setSarvamKey(e.target.value)}
            placeholder={providers.sarvam_key ? "Leave blank to keep" : "Needed for voice"}
          />

          <label className="signin-label" htmlFor="model">Model</label>
          <input
            id="model" className="signin-input"
            value={model} onChange={(e) => setModel(e.target.value)}
            placeholder="Leave blank for the default"
          />

          <label className="signin-label" htmlFor="custom-url">
            Custom model URL <span className="agent-optional">optional</span>
          </label>
          <p className="dash-hint">
            Any OpenAI-compatible endpoint — Mistral, OpenRouter, your own server.
          </p>
          <input
            id="custom-url" className="signin-input"
            value={customUrl} onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://api.mistral.ai/v1"
          />

          <label className="signin-label" htmlFor="custom-key">
            Custom model key {providers.custom_llm_key && <span className="agent-optional">saved: {providers.custom_llm_key}</span>}
          </label>
          <input
            id="custom-key" className="signin-input" type="password" autoComplete="off"
            value={customKey} onChange={(e) => setCustomKey(e.target.value)}
            placeholder={providers.custom_llm_key ? "Leave blank to keep" : ""}
          />

          {keyError && <p className="signin-error" role="alert">{keyError}</p>}
          {keysSaved && <p className="settings-done" role="status">Keys saved.</p>}

          <button type="submit" className="signin-button ds-pressable ds-tap" disabled={savingKeys}>
            {savingKeys ? "Saving…" : "Save keys"}
          </button>
        </form>

        <form className="settings-card" onSubmit={save}>
          <h2 className="dash-section-title">Set a password</h2>
          <p className="dash-hint">
            Today you get in by pasting your API keys. A password is quicker,
            and safer to type on a phone or a shared computer — your keys stay
            on the server instead of in the browser.
          </p>

          <label className="signin-label" htmlFor="account-email">Email</label>
          <input
            id="account-email"
            className="signin-input"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setDone(false); }}
            autoComplete="email"
            required
          />

          <label className="signin-label" htmlFor="account-password">Password</label>
          <input
            id="account-password"
            className="signin-input"
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setDone(false); }}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="dash-hint">
            At least 8 characters. Length matters more than symbols, so a short
            phrase beats a scrambled word.
          </p>

          <label className="signin-label" htmlFor="account-confirm">Confirm password</label>
          <input
            id="account-confirm"
            className="signin-input"
            type="password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setDone(false); }}
            autoComplete="new-password"
            required
          />

          {error && <p className="signin-error" role="alert">{error}</p>}
          {done && (
            <p className="settings-done" role="status">
              Saved. You can now sign in at <a href="/signin">/signin</a>.
            </p>
          )}

          <button
            type="submit"
            className="signin-button ds-pressable ds-tap"
            disabled={busy || !email.trim() || password.length < 8 || !confirm}
          >
            {busy ? "Saving…" : "Save password"}
          </button>

          <p className="signin-foot">
            There is no reset yet. If you forget it, open Scribe with your API
            keys and set a new one here.
          </p>
        </form>
      </main>
    </OwnerShell>
  );
}
