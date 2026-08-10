"use client";

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/v1/workspace", { credentials: "include" });
        if (response.ok && !cancelled) {
          setBusinessName((await response.json()).business_name);
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
      const response = await fetch("/api/v1/workspace/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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

  return (
    <OwnerShell businessName={businessName}>
      <main className="dash-page">
        <header className="dash-header">
          <h1 className="dash-title">Account</h1>
          <p className="dash-sub">
            How you get back into this console.
          </p>
        </header>

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
