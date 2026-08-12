"use client";

// Sign in or Create an account for a business workspace.
//
// Owners land here to manage their assistant, inspect customer transcripts,
// and configure channels without re-pasting raw API keys on every device.
// Personal mode visitors use API keys on the main demo screen (/).

import Link from "next/link";
import { useEffect, useState } from "react";

import { clearWorkspaceCache } from "../lib/workspaceCache";

type AuthMode = "signin" | "signup";

export default function SignInPage() {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");


  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) return;
    if (mode === "signup" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const endpoint = mode === "signup" ? "/api/v1/workspace/signup" : "/api/v1/workspace/login";
      const payload =
        mode === "signup"
          ? {
              email: email.trim(),
              password,
              business_name: businessName.trim() || undefined,
            }
          : { email: email.trim(), password };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || (mode === "signup" ? "Could not create account." : "Could not sign in."));
      }

      const data = await response.json();
      // Whoever was signed in on this browser before is not who just signed in.
      // Their cached business name, email, and agent config are in localStorage
      // and would render for the first second of the new session.
      clearWorkspaceCache();
      // Business owners land in the console (/dashboard or /agent for fresh setup)
      window.location.href = data.is_business ? (mode === "signup" ? "/agent" : "/dashboard") : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
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
          <span className="signin-brand-text">Scribe business console</span>
        </div>

        {/* Mode switcher tabs */}
        <div className="chan-tabs" role="tablist" style={{ marginTop: "4px" }}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signin"}
            className={`chan-tab ${mode === "signin" ? "is-active" : ""}`}
            onClick={() => {
              setMode("signin");
              setError("");
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={`chan-tab ${mode === "signup" ? "is-active" : ""}`}
            onClick={() => {
              setMode("signup");
              setError("");
            }}
          >
            Create account
          </button>
        </div>

        <div>
          <h1 className="signin-title">
            {mode === "signin" ? "Owner sign in" : "Build your assistant"}
          </h1>
          <p className="signin-sub">
            {mode === "signin"
              ? "Access your business dashboard, voice transcripts, and agent controls."
              : "Create an AI customer agent with custom voice, documents, and phone links."}
          </p>
        </div>

        {mode === "signup" && (
          <>
            <label className="signin-label" htmlFor="business-name">
              Business Name <span className="agent-optional">optional</span>
            </label>
            <input
              id="business-name"
              className="signin-input"
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Apex Health Clinic"
              maxLength={200}
            />
          </>
        )}

        <label className="signin-label" htmlFor="email">
          Email
        </label>
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

        <label className="signin-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="signin-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={mode === "signup" ? 8 : undefined}
          placeholder={mode === "signup" ? "At least 8 characters" : undefined}
          required
        />

        {error && <p className="signin-error" role="alert">{error}</p>}

        <button
          type="submit"
          className="signin-button ds-pressable ds-tap"
          disabled={busy || !email.trim() || !password}
        >
          {busy
            ? mode === "signup"
              ? "Creating account…"
              : "Signing in…"
            : mode === "signup"
            ? "Create business workspace"
            : "Sign in"}
        </button>

        <div className="pt-2 border-t mt-2" style={{ borderColor: "var(--owner-border)" }}>
          <p className="signin-foot text-center">
            Want to test chat with your own API keys?{" "}
            <Link href="/" className="font-semibold underline" style={{ color: "var(--owner-text)" }}>
              Open personal demo →
            </Link>
          </p>
        </div>
      </form>
    </main>
  );
}
