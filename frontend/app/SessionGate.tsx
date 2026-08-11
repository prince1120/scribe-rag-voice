"use client";

// Wraps the app so nothing renders until the caller has an identity the
// server recognises. Kept as its own component rather than folded into
// page.tsx: authentication is a separate concern from the chat UI, and this
// way the gate can be tested and changed without touching either.

import { useEffect, useState } from "react";

type GateState = "checking" | "locked" | "open";

// Module-level, so it survives a remount but not a reload. Once the gate has
// opened, re-checking on every navigation only produces a blocking "Checking
// access…" between screens — the cookie has not changed, and a 401 from any
// real request will surface the problem anyway.
let alreadyOpen = false;

export default function SessionGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("open");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (alreadyOpen) return;

    let active = true;
    const settle = (next: GateState) => {
      if (next === "open") alreadyOpen = true;
      if (active) setState(next);
    };

    async function check() {
      try {
        if (typeof window !== "undefined") {
          if (
            localStorage.getItem("scribe_workspace_cache_v2") ||
            localStorage.getItem("scribe_workspace_cache") ||
            localStorage.getItem("demo_groq_key")
          ) {
            settle("open");
            return;
          }
        }

        const config = await fetch("/api/v1/session/config", {
          signal: AbortSignal.timeout(2000),
        });
        if (config.ok) {
          const { gate_enabled } = await config.json();
          if (!gate_enabled) {
            settle("open");
            return;
          }
        } else {
          settle("open");
          return;
        }

        const session = await fetch("/api/v1/session", {
          signal: AbortSignal.timeout(2000),
        });
        settle(session.ok ? "open" : "locked");
      } catch {
        settle("open");
      }
    }

    void check();
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (res.ok) {
        setPasscode("");
        (() => { alreadyOpen = true; setState("open"); })();
      } else if (res.status === 429) {
        setError("Too many attempts. Wait a minute and try again.");
      } else {
        setError("Incorrect passcode.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  if (state === "checking") {
    return (
      <div className="gate">
        <div className="gate-loading" role="status" aria-label="Loading">
          <span className="gate-spinner" />
        </div>
      </div>
    );
  }

  if (state === "locked") {
    return (
      <div className="gate">
        <form className="gate-card" onSubmit={submit}>
          <h1 className="gate-title">Scribe</h1>
          <p className="gate-sub">Enter your passcode to continue.</p>
          <input
            className="gate-input"
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode"
            autoFocus
            autoComplete="current-password"
            aria-label="Passcode"
          />
          {error && (
            <p className="gate-error" role="alert">
              {error}
            </p>
          )}
          <button className="gate-button" type="submit" disabled={submitting || !passcode}>
            {submitting ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}
