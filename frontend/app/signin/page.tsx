"use client";

// Sign in to an existing business workspace.
//
// Only owners land here. A personal user is identified by the keys they
// already hold, and a caller by the link they were sent — asking either for a
// password would be asking for a credential twice.
//
// The workspace is created by bringing your own API keys; this is a second way
// back into one that already exists, which is why the copy says "sign in"
// rather than "sign up" and why there is no registration form.

import { useState } from "react";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) return;

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/workspace/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The session cookie is the entire point of this request.
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        // The server returns one message for an unknown email and a wrong
        // password on purpose, so this must not try to be more specific.
        throw new Error(body?.detail || "Could not sign in.");
      }

      const data = await response.json();
      window.location.href = data.is_business ? "/dashboard" : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setBusy(false);
    }
  }

  return (
    <main className="signin-page">
      <form className="signin-card ds-animate-scale" onSubmit={submit}>
        <div className="signin-brand">
          <span className="signin-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
              <path d="M7 4h7l4 4v12H7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M14 4v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="signin-brand-text">Scribe console</span>
        </div>

        <div>
          <h1 className="signin-title">Sign in</h1>
          <p className="signin-sub">
            Check what your assistant has been saying.
          </p>
        </div>

        <label className="signin-label" htmlFor="email">Email</label>
        <input
          id="email"
          className="signin-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus
          required
        />

        <label className="signin-label" htmlFor="password">Password</label>
        <input
          id="password"
          className="signin-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {error && <p className="signin-error" role="alert">{error}</p>}

        <button
          type="submit"
          className="signin-button ds-pressable ds-tap"
          disabled={busy || !email.trim() || !password}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="signin-foot">
          No password yet? Open Scribe with your API keys, then set one from
          your console.
        </p>
      </form>
    </main>
  );
}
