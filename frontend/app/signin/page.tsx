"use client";

// Sign in or Create an account for a business workspace.
//
// Owners land here to manage their assistant, inspect customer transcripts,
// and configure channels without re-pasting raw API keys on every device.
// Personal mode visitors use API keys on the main demo screen (/).

import Link from "next/link";
import { useState } from "react";

import { ScribeMark } from "../Logo";
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
    <div className="signin-page">
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
          <Link href="/" className="signin-header-link">
            Home
          </Link>
        </nav>
      </header>

      <main className="signin-main">
        <section className="signin-story" aria-labelledby="signin-story-title">
          <span className="studio-eyebrow">A little more room to run your business</span>
          <h2 id="signin-story-title">Good conversations.<br /><em>Better connections.</em></h2>
          <p>Your assistant, customer conversations, and bookings. A thoughtful home for everything that happens next.</p>
          <div className="signin-illustration" aria-hidden="true">
            <div className="studio-wave">{[14, 28, 42, 24, 54, 36, 64, 42, 26, 48, 32, 16].map((height, i) => <span key={i} style={{ height, animationDelay: `${i * -0.13}s` }} />)}</div>
            <span className="signin-illustration-label">Made for a more natural conversation</span>
          </div>
          <div className="signin-story-foot"><span>01 / Your knowledge</span><span>02 / Your voice</span><span>03 / Your business</span></div>
        </section>
        <form className="signin-card ds-animate-scale" onSubmit={submit}>
          <div className="signin-brand">
            <span className="signin-mark" aria-hidden="true">
              <ScribeMark className="w-4 h-4" />
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
            {mode === "signin" ? "Welcome back." : "Build your assistant"}
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

          <div className="pt-3 border-t mt-1" style={{ borderColor: "var(--claude-border)" }}>
            <p className="signin-foot text-center">
              Want to test chat with your own API keys?{" "}
              <Link href="/" className="font-semibold underline">
                Open personal demo →
              </Link>
            </p>
          </div>
        </form>
      </main>
    </div>
  );
}
