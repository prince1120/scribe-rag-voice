"use client";

// What an invite link opens.
//
// The person arriving here has no account and never will. The link is their
// identity, so the whole job of this page is: exchange the token for a session
// cookie, then get out of the way. Anything that looks like a signup — a form,
// a "welcome aboard" screen, a tour — defeats the point of sending a link.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { CallScreen } from "./CallScreen";

type State = "opening" | "pin" | "ready" | "error";

export default function ContactLinkPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();

  const [state, setState] = useState<State>("opening");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<string>("both");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const open = useCallback(
    async (withPin?: string) => {
      const token = params?.token;
      if (!token) {
        setState("error");
        setMessage("This link is incomplete.");
        return;
      }

      setSubmitting(true);
      try {
        const response = await fetch("/api/v1/contacts/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The cookie is the whole point of this call, so credentials must
          // travel or the session is minted and immediately thrown away.
          credentials: "include",
          body: JSON.stringify({ token, pin: withPin || undefined }),
        });

        if (response.status === 401) {
          // Only reachable when a PIN is required, so this is a prompt rather
          // than a failure — the link itself is fine.
          setState("pin");
          setMessage(withPin ? "That PIN doesn't match. Try again." : "");
          return;
        }

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          setState("error");
          setMessage(body?.detail || "This link could not be opened.");
          return;
        }

        const data = await response.json();
        setName(data.name || "");
        setMode(data.mode || "both");
        setState("ready");

        // Straight into the app. Replace, not push, so Back doesn't land them
        // on a link that has already been redeemed.
        // A voice-only link stays on this page and renders the call screen.
        if ((data.mode || "both") !== "voice") router.replace("/");
      } catch {
        setState("error");
        setMessage("Could not reach the server. Check your connection and try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [params, router]
  );

  useEffect(() => {
    void open();
    // Deliberately once, on mount: re-running would redeem the link again and
    // record a duplicate session every time this component re-rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Voice links render the call screen in place rather than bouncing through
  // the full app, which would show a document sidebar they cannot use.
  if (state === "ready" && mode === "voice") return <CallScreen name={name} />;

  return (
    <main className="link-page">
      <div className="link-card ds-animate-scale">
        {state === "opening" && (
          <>
            <div className="link-spinner" aria-hidden="true" />
            <p className="link-title">Opening your link…</p>
          </>
        )}

        {state === "pin" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pin.trim()) void open(pin.trim());
            }}
            className="link-form"
          >
            <p className="link-title">Enter your PIN</p>
            <p className="link-sub">
              You were given a short code alongside this link.
            </p>
            <input
              className="link-input"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
              autoFocus
              aria-label="PIN"
            />
            {message && <p className="link-error">{message}</p>}
            <button
              type="submit"
              className="link-button ds-pressable ds-tap"
              disabled={!pin.trim() || submitting}
            >
              {submitting ? "Checking…" : "Continue"}
            </button>
          </form>
        )}

        {state === "ready" && mode !== "voice" && (
          <p className="link-title">
            {name ? `Welcome, ${name}` : "Welcome"} — taking you in…
          </p>
        )}

        {state === "error" && (
          <>
            <p className="link-title">Can't open this link</p>
            {/* The server's wording is deliberately specific — revoked, expired,
                already in use on another device — so it is shown as-is rather
                than flattened into a generic failure. */}
            <p className="link-sub">{message}</p>
            <p className="link-hint">
              Ask whoever shared it with you to send a new one.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
