"use client";

// Wraps the app so nothing renders until the caller has an identity the
// server recognises. Kept as its own component rather than folded into
// page.tsx: authentication is a separate concern from the chat UI, and this
// way the gate can be tested and changed without touching either.

import { useEffect, useState } from "react";

type GateState = "checking" | "locked" | "open";

export default function SessionGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Cancelled on unmount so a slow response can't set state afterwards.
    let active = true;
    const settle = (next: GateState) => {
      if (active) setState(next);
    };

    async function check() {
      try {
      // Is the gate even switched on? A local dev instance has no passcode,
      // and prompting for one nobody set would make the app unusable.
        const config = await fetch("/api/v1/session/config", { cache: "no-store" });
        if (config.ok) {
          const { gate_enabled } = await config.json();
          if (!gate_enabled) {
            settle("open");
            return;
          }
        }

        // A demo visitor authenticates with their own pasted keys instead of
        // the passcode, so an existing key means they reach the app directly.
        if (localStorage.getItem("demo_groq_key")) {
          settle("open");
          return;
        }

        const session = await fetch("/api/v1/session", { cache: "no-store" });
        settle(session.ok ? "open" : "locked");
      } catch {
        // A network failure is not proof of authorisation — fail closed.
        settle("locked");
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
        setState("open");
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
        <div className="gate-card gate-quiet">Checking access…</div>
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
