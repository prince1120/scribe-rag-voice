"use client";

import { useEffect, useState } from "react";

import { ownerFetch } from "../lib/ownerFetch";
import { OwnerShell } from "../components/owner/OwnerShell";

export default function SettingsPage() {
  const [businessName, setBusinessName] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState("");

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
        const [wsRes, provRes, catRes] = await Promise.all([
          ownerFetch("/api/v1/workspace"),
          ownerFetch("/api/v1/workspace/providers"),
          ownerFetch("/api/v1/workspace/categories"),
        ]);
        if (cancelled) return;
        if (wsRes.ok) {
          const wsData = await wsRes.json();
          setBusinessName(wsData.business_name || "");
          setCategory(wsData.business_category || "");
        }
        if (provRes.ok) {
          const data = await provRes.json();
          setProviders(data);
          setCustomUrl(data.custom_llm_base_url || "");
          setModel(data.llm_model || "");
        }
        if (catRes.ok) {
          const catData = await catRes.json();
          setCategories(catData.categories || []);
        }
      } catch {
        // Fall back gracefully
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileError("");
    try {
      const response = await ownerFetch("/api/v1/workspace/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: businessName.trim(),
          business_category: category,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not update business profile.");
      }
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Could not update profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();

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
      setGroqKey("");
      setSarvamKey("");
      setCustomKey("");
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
          <h1 className="dash-title">Account & Business Profile</h1>
          <p className="dash-sub">Manage your business identity, API keys, and console login credentials.</p>
        </header>

        {/* Business Profile */}
        <form className="settings-card" onSubmit={saveProfile}>
          <h2 className="dash-section-title">Business identity</h2>
          <p className="dash-hint">
            How your business appears to callers, on share links, and in the public directory.
          </p>

          <label className="signin-label" htmlFor="profile-name">
            Business Name
          </label>
          <input
            id="profile-name"
            className="signin-input"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g. Sharma Dental Clinic"
            maxLength={200}
            required
          />

          <label className="signin-label" htmlFor="profile-category">
            Business Category
          </label>
          <select
            id="profile-category"
            className="signin-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Choose a category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>

          {profileError && (
            <p className="signin-error" role="alert">
              {profileError}
            </p>
          )}
          {profileSaved && (
            <p className="settings-done" role="status">
              Business profile saved.
            </p>
          )}

          <button
            type="submit"
            className="signin-button ds-pressable ds-tap"
            disabled={savingProfile || !businessName.trim()}
          >
            {savingProfile ? "Saving…" : "Save profile"}
          </button>
        </form>

        {/* Provider Keys */}
        <form className="settings-card" onSubmit={saveKeys}>
          <h2 className="dash-section-title">Keys and model</h2>
          <p className="dash-hint">
            Your assistant answers on your account, so it needs your keys. They are encrypted before being
            stored and never shown again — leave a field blank to keep what is already saved.
          </p>

          <label className="signin-label" htmlFor="groq">
            Groq API key{" "}
            {providers.groq_key && <span className="agent-optional">saved: {providers.groq_key}</span>}
          </label>
          <input
            id="groq"
            className="signin-input"
            type="password"
            autoComplete="off"
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder={providers.groq_key ? "Leave blank to keep" : "gsk_…"}
          />

          <label className="signin-label" htmlFor="sarvam">
            Sarvam API key{" "}
            {providers.sarvam_key && <span className="agent-optional">saved: {providers.sarvam_key}</span>}
          </label>
          <input
            id="sarvam"
            className="signin-input"
            type="password"
            autoComplete="off"
            value={sarvamKey}
            onChange={(e) => setSarvamKey(e.target.value)}
            placeholder={providers.sarvam_key ? "Leave blank to keep" : "Needed for voice"}
          />

          <label className="signin-label" htmlFor="model">
            Model
          </label>
          <input
            id="model"
            className="signin-input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Leave blank for the default"
          />

          <label className="signin-label" htmlFor="custom-url">
            Custom model URL <span className="agent-optional">optional</span>
          </label>
          <p className="dash-hint">Any OpenAI-compatible endpoint — Mistral, OpenRouter, your own server.</p>
          <input
            id="custom-url"
            className="signin-input"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://api.mistral.ai/v1"
          />

          <label className="signin-label" htmlFor="custom-key">
            Custom model key{" "}
            {providers.custom_llm_key && (
              <span className="agent-optional">saved: {providers.custom_llm_key}</span>
            )}
          </label>
          <input
            id="custom-key"
            className="signin-input"
            type="password"
            autoComplete="off"
            value={customKey}
            onChange={(e) => setCustomKey(e.target.value)}
            placeholder={providers.custom_llm_key ? "Leave blank to keep" : ""}
          />

          {keyError && (
            <p className="signin-error" role="alert">
              {keyError}
            </p>
          )}
          {keysSaved && (
            <p className="settings-done" role="status">
              Keys saved.
            </p>
          )}

          <button type="submit" className="signin-button ds-pressable ds-tap" disabled={savingKeys}>
            {savingKeys ? "Saving…" : "Save keys"}
          </button>
        </form>

        {/* Set password */}
        <form className="settings-card" onSubmit={save}>
          <h2 className="dash-section-title">Set a password</h2>
          <p className="dash-hint">
            Today you get in by pasting your API keys. A password is quicker, and safer to type on a phone
            or a shared computer — your keys stay on the server instead of in the browser.
          </p>

          <label className="signin-label" htmlFor="account-email">
            Email
          </label>
          <input
            id="account-email"
            className="signin-input"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setDone(false);
            }}
            autoComplete="email"
            required
          />

          <label className="signin-label" htmlFor="account-password">
            Password
          </label>
          <input
            id="account-password"
            className="signin-input"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setDone(false);
            }}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="dash-hint">
            At least 8 characters. Length matters more than symbols, so a short phrase beats a scrambled word.
          </p>

          <label className="signin-label" htmlFor="account-confirm">
            Confirm password
          </label>
          <input
            id="account-confirm"
            className="signin-input"
            type="password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setDone(false);
            }}
            autoComplete="new-password"
            required
          />

          {error && (
            <p className="signin-error" role="alert">
              {error}
            </p>
          )}
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
            There is no reset yet. If you forget it, open Scribe with your API keys and set a new one here.
          </p>
        </form>
      </main>
    </OwnerShell>
  );
}
