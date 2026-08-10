"use client";

// Owner screen for invite links.
//
// The token is returned exactly once, by the request that creates it — only
// its hash is stored — so this page has one hard requirement: capture that
// value and make it easy to copy before the owner navigates away. Everything
// else (revoke, rotate, session history) can be fetched again later.

import { useCallback, useEffect, useState } from "react";

import { OwnerShell } from "../components/owner/OwnerShell";

interface Contact {
  contact_id: string;
  name: string;
  note?: string | null;
  mode: string;
  has_pin: boolean;
  device_bound: boolean;
  revoked: boolean;
  last_seen_at?: string | null;
  created_at?: string | null;
}

interface Turn {
  role: string;
  content: string;
  at?: string | null;
}

interface Session {
  session_id: string;
  channel: string;
  started_at?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  message_count: number;
}

function linkFor(token: string): string {
  return `${window.location.origin}/t/${token}`;
}

function formatWhen(value?: string | null): string {
  if (!value) return "never";
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function LinksPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [mode, setMode] = useState("voice");
  const [pin, setPin] = useState("");
  const [creating, setCreating] = useState(false);

  // Held in state rather than shown in a list: this is the only moment the
  // plaintext token exists anywhere outside the creating request.
  const [freshLink, setFreshLink] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [openSessions, setOpenSessions] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  // Transcripts are fetched per session and cached, so reopening one that has
  // already been read costs nothing.
  const [transcripts, setTranscripts] = useState<Record<string, Turn[]>>({});
  const [openTranscript, setOpenTranscript] = useState<string | null>(null);
  // Which row is mid-request. Keyed by contact id so one slow action disables
  // only its own row rather than the whole page.
  const [busy, setBusy] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/contacts", { credentials: "include" });
      if (response.status === 403 || response.status === 401) {
        setError("Sign in as the owner to manage links.");
        return;
      }
      if (!response.ok) throw new Error();
      setContacts(await response.json());
      setError("");
    } catch {
      setError("Could not load links.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    try {
      const response = await fetch("/api/v1/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: name.trim(),
          mode,
          pin: pin.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not create the link.");
      }

      const data = await response.json();
      setFreshLink({ name: data.name, url: linkFor(data.token) });
      setName("");
      setPin("");
      setCopied(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the link.");
    } finally {
      setCreating(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked on insecure origins; the field below is
      // selectable, so there is still a way to get the value out.
    }
  }

  async function showTranscript(contactId: string, sessionId: string) {
    if (openTranscript === sessionId) {
      setOpenTranscript(null);
      return;
    }
    setOpenTranscript(sessionId);
    if (transcripts[sessionId]) return;

    const response = await fetch(
      `/api/v1/contacts/${contactId}/transcript?session_id=${sessionId}`,
      { credentials: "include" }
    );
    if (!response.ok) return;
    const data = await response.json();
    setTranscripts((prev) => ({ ...prev, [sessionId]: data.messages || [] }));
  }

  async function revoke(contactId: string) {
    setBusy((b) => ({ ...b, [contactId]: "revoke" }));
    try {
      await fetch(`/api/v1/contacts/${contactId}/revoke`, {
        method: "POST", credentials: "include",
      });
      await load();
    } finally {
      setBusy((b) => ({ ...b, [contactId]: "" }));
    }
  }

  async function remove(contactId: string, contactName: string) {
    // Deleting discards the conversation history too, which revoking does
    // not — worth one confirmation rather than a silent, unrecoverable click.
    if (!window.confirm(`Delete ${contactName} and their history? This cannot be undone.`)) {
      return;
    }
    setBusy((b) => ({ ...b, [contactId]: "delete" }));
    try {
      await fetch(`/api/v1/contacts/${contactId}`, {
        method: "DELETE", credentials: "include",
      });
      await load();
    } finally {
      setBusy((b) => ({ ...b, [contactId]: "" }));
    }
  }

  async function rotate(contactId: string, contactName: string) {
    setBusy((b) => ({ ...b, [contactId]: "rotate" }));
    try {
      const response = await fetch(`/api/v1/contacts/${contactId}/rotate`, {
        method: "POST", credentials: "include",
      });
      if (!response.ok) return;
      const data = await response.json();
      setFreshLink({ name: contactName, url: linkFor(data.token) });
      setCopied(false);
      await load();
    } finally {
      setBusy((b) => ({ ...b, [contactId]: "" }));
    }
  }

  async function showSessions(contactId: string) {
    if (openSessions === contactId) {
      setOpenSessions(null);
      return;
    }
    setBusy((b) => ({ ...b, [contactId]: "history" }));
    try {
      const response = await fetch(`/api/v1/contacts/${contactId}/sessions`, {
        credentials: "include",
      });
      if (!response.ok) return;
      const data = await response.json();
      setSessions(data.sessions || []);
      setOpenSessions(contactId);
    } finally {
      setBusy((b) => ({ ...b, [contactId]: "" }));
    }
  }

  return (
    <OwnerShell>
      <main className="links-page ds-scroll">
      <div className="links-inner">
        {/* Same brand lockup as the main app header, so this reads as part of
            Scribe rather than a detached admin tool. */}
        <header className="links-header">
          <a href="/" className="links-brand" aria-label="Back to Scribe">
            <span className="links-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                <path d="M7 4h7l4 4v12H7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M14 4v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M10 12h5M10 15.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="links-brand-text">Scribe</span>
          </a>

          <div>
            <h1 className="links-title">Share links</h1>
            <p className="links-sub">
              Each person gets their own link. Every conversation they have is
              recorded under their name.
            </p>
          </div>
        </header>

        {error && <p className="links-error" role="alert">{error}</p>}

        {freshLink && (
          <div className="links-fresh ds-animate-rise">
            <p className="links-fresh-label">
              Link for {freshLink.name} — copy it now, it won't be shown again
            </p>
            <div className="links-fresh-row">
              <input readOnly value={freshLink.url} className="links-fresh-input" />
              <button
                type="button"
                onClick={() => copy(freshLink.url)}
                className="links-btn links-btn-primary ds-pressable ds-tap"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              type="button"
              className="links-dismiss"
              onClick={() => setFreshLink(null)}
            >
              Done
            </button>
          </div>
        )}

        <form onSubmit={create} className="links-form">
          <input
            className="links-input"
            placeholder="Who is this for? e.g. Ramesh"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Name"
          />
          <select
            className="links-input links-select"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            aria-label="What they can do"
          >
            <option value="voice">Voice call only</option>
            <option value="chat">Chat only</option>
            <option value="both">Voice and chat</option>
          </select>
          <input
            className="links-input"
            placeholder="PIN (optional)"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            maxLength={12}
            aria-label="Optional PIN"
          />
          <button
            type="submit"
            className="links-btn links-btn-primary ds-pressable ds-tap"
            disabled={!name.trim() || creating}
          >
            {creating ? "Creating…" : "Create link"}
          </button>
        </form>

        {loading ? (
          <div className="links-skeletons">
            <span className="ds-skeleton" />
            <span className="ds-skeleton" />
          </div>
        ) : contacts.length === 0 ? (
          <p className="links-empty">No links yet. Create one above.</p>
        ) : (
          <ul className="links-list">
            {contacts.map((contact) => (
              <li key={contact.contact_id} className="links-item">
                <div className="links-item-main">
                  <div>
                    <p className="links-item-name">
                      {contact.name}
                      {contact.revoked && <span className="links-tag is-off">revoked</span>}
                      {contact.has_pin && <span className="links-tag">PIN</span>}
                      {contact.device_bound && <span className="links-tag">device locked</span>}
                    </p>
                    <p className="links-item-meta">
                      {contact.mode === "voice" ? "Voice only"
                        : contact.mode === "chat" ? "Chat only" : "Voice and chat"}
                      {" · last used "}{formatWhen(contact.last_seen_at)}
                    </p>
                  </div>
                  <div className="links-item-actions">
                    <button
                      type="button"
                      className="links-btn ds-pressable ds-tap"
                      onClick={() => showSessions(contact.contact_id)}
                      disabled={Boolean(busy[contact.contact_id])}
                    >
                      {busy[contact.contact_id] === "history" ? "Loading…"
                        : openSessions === contact.contact_id ? "Hide" : "History"}
                    </button>
                    <button
                      type="button"
                      className="links-btn ds-pressable ds-tap"
                      onClick={() => rotate(contact.contact_id, contact.name)}
                      disabled={Boolean(busy[contact.contact_id])}
                    >
                      {busy[contact.contact_id] === "rotate" ? "Creating…" : "New link"}
                    </button>
                    {!contact.revoked && (
                      <button
                        type="button"
                        className="links-btn links-btn-danger ds-pressable ds-tap"
                        onClick={() => revoke(contact.contact_id)}
                        disabled={Boolean(busy[contact.contact_id])}
                      >
                        {busy[contact.contact_id] === "revoke" ? "Revoking…" : "Revoke"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="links-btn links-btn-danger ds-pressable ds-tap"
                      onClick={() => remove(contact.contact_id, contact.name)}
                      disabled={Boolean(busy[contact.contact_id])}
                    >
                      {busy[contact.contact_id] === "delete" ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>

                {openSessions === contact.contact_id && (
                  <div className="links-sessions ds-animate-fade">
                    {sessions.length === 0 ? (
                      <p className="links-item-meta">No conversations yet.</p>
                    ) : (
                      sessions.map((session) => (
                        <div key={session.session_id}>
                          <button
                            type="button"
                            className="links-session links-session-btn"
                            onClick={() => showTranscript(contact.contact_id, session.session_id)}
                          >
                            <span>{formatWhen(session.started_at)}</span>
                            <span className="links-session-meta">
                              {session.channel} · {session.ip_address || "unknown ip"}
                              {openTranscript === session.session_id ? " ▾" : " ▸"}
                            </span>
                          </button>

                          {openTranscript === session.session_id && (
                            <div className="links-transcript ds-animate-fade">
                              {(transcripts[session.session_id] || []).length === 0 ? (
                                <p className="links-item-meta">
                                  Nothing was said in this session.
                                </p>
                              ) : (
                                transcripts[session.session_id].map((turn, i) => (
                                  <p key={i} className={`links-turn is-${turn.role}`}>
                                    <span className="links-turn-who">
                                      {turn.role === "user" ? contact.name : "Scribe"}
                                    </span>
                                    {turn.content}
                                  </p>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      </main>
    </OwnerShell>
  );
}
