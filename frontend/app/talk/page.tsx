"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { extractApiErrorMessage, formatClientError } from "../lib/apiErrors";

type PublicAgent = { agent_name: string; business_name: string; has_voice: boolean; has_chat: boolean; online: boolean };

async function readAgent(value: string, signal?: AbortSignal): Promise<PublicAgent> {
  const response = await fetch(`/api/v1/directory/agents/${encodeURIComponent(value)}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error(await extractApiErrorMessage(response, "Could not find this assistant."));
  return response.json();
}

export default function TalkPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [agent, setAgent] = useState<PublicAgent | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [messageSent, setMessageSent] = useState(false);
  const messageId = useRef<string | null>(null);
  const requestId = useRef(0);

  async function findAgent(value: string, signal?: AbortSignal) {
    const currentRequest = ++requestId.current;
    try {
      const data = await readAgent(value, signal);
      if (signal?.aborted || requestId.current !== currentRequest) return;
      setAgent(data); setAddress(value);
    } catch (err) {
      if (!signal?.aborted && requestId.current === currentRequest) setError(formatClientError(err, "Could not find this assistant. Try again."));
    } finally { if (!signal?.aborted && requestId.current === currentRequest) setBusy(false); }
  }

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("agent");
    const controller = new AbortController();
    const currentRequest = ++requestId.current;
    if (value) {
      void readAgent(value, controller.signal).then((data) => {
        if (!controller.signal.aborted && requestId.current === currentRequest) { setAgent(data); setAddress(value); }
      }).catch((err: unknown) => {
        if (!controller.signal.aborted && requestId.current === currentRequest) setError(formatClientError(err, "Could not find this assistant."));
      });
    }
    return () => controller.abort();
  }, []);

  async function connect(mode: "voice" | "chat") {
    if (!address || busy) return;
    setBusy(true); setError("");
    try {
      const key = "app_client_id";
      let clientId = localStorage.getItem(key);
      if (!clientId) { clientId = crypto.randomUUID(); localStorage.setItem(key, clientId); }
      const response = await fetch("/api/v1/directory/connect", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
        body: JSON.stringify({ handle: address, name: name.trim() || "Guest", mode }),
      });
      if (!response.ok) {
        const detail = await extractApiErrorMessage(response, "Could not connect. Please try again.");
        if (response.status === 404 || response.status === 409) setAgent(await readAgent(address));
        throw new Error(detail);
      }
      const data: { redirect_url: string } = await response.json();
      router.push(data.redirect_url);
    } catch (err) { setError(formatClientError(err, "Could not connect. Please try again.")); setBusy(false); }
  }

  async function leaveMessage(event: FormEvent) {
    event.preventDefault();
    if (!address || busy || messageSent) return;
    setBusy(true); setError("");
    messageId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/directory/agents/${encodeURIComponent(address)}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: messageId.current, name: name.trim() || "Guest", message: message.trim(), reply_to: replyTo.trim() }),
      });
      if (!response.ok) throw new Error(await extractApiErrorMessage(response, "Could not save your message. Please try again."));
      setMessageSent(true);
    } catch (err) { setError(formatClientError(err, "Could not save your message. Please try again.")); }
    finally { setBusy(false); }
  }

  function lookup(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setAgent(null); setAddress("");
    setMessageSent(false); setMessage(""); setReplyTo(""); messageId.current = null;
    void findAgent(code.replace(/\s/g, ""));
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-5 py-12" style={{ background: "var(--claude-bg)", color: "var(--claude-text)" }}>
      <div className="w-full max-w-md space-y-7">
        <Link href="/" className="text-sm font-semibold">Scribe</Link>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Who would you like to talk to?</h1>
          <p className="mt-3 text-sm" style={{ color: "var(--claude-muted)" }}>Enter an assistant’s 8-digit code. No account or phone number needed.</p>
        </div>
        <form onSubmit={lookup} className="space-y-3">
          <label htmlFor="agent-code" className="block text-sm font-medium">Assistant code</label>
          <input id="agent-code" value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, ""))}
            inputMode="numeric" autoComplete="off" pattern="[0-9 ]{8,11}" maxLength={11} required disabled={busy}
            placeholder="1234 5678" className="w-full border rounded-xl px-4 py-3 text-2xl tracking-widest" style={{ background: "var(--claude-surface)", borderColor: "var(--claude-border)" }} />
          <button type="submit" disabled={busy || code.replace(/\s/g, "").length !== 8} className="owner-primary-action w-full py-3 rounded-xl disabled:opacity-50">{busy ? "Connecting…" : "Find assistant"}</button>
        </form>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {agent && <section className="space-y-4 border-t pt-6" style={{ borderColor: "var(--claude-border)" }} aria-live="polite">
          <div><h2 className="text-xl font-semibold">{agent.agent_name}</h2><p className="text-sm">{agent.business_name}</p></div>
          <label className="block text-sm">Your name <span style={{ color: "var(--claude-muted)" }}>(optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" disabled={busy} className="mt-2 w-full rounded-xl border px-3 py-2" style={{ background: "var(--claude-surface)", borderColor: "var(--claude-border)" }} />
          </label>
          {agent.online ? <div className="flex gap-3">
            {agent.has_voice && <button disabled={busy} onClick={() => void connect("voice")} className="owner-primary-action flex-1 rounded-xl py-3 disabled:opacity-50">Continue to voice call</button>}
            {agent.has_chat && <button disabled={busy} onClick={() => void connect("chat")} className="border flex-1 rounded-xl py-3 disabled:opacity-50" style={{ borderColor: "var(--claude-border)" }}>Text chat</button>}
          </div> : <div className="space-y-4">
            <div><h3 className="font-semibold">Agent offline</h3><p className="text-sm mt-1" style={{ color: "var(--claude-muted)" }}>This assistant is currently unavailable. Leave your issue and the business owner can follow up.</p></div>
            {messageSent ? <p role="status" className="text-sm">Your message has been saved in the owner’s Inbox. They have your issue and reply contact.</p> : <form onSubmit={leaveMessage} className="space-y-4">
              <label className="block text-sm">What did you need help with?
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} minLength={3} maxLength={2000} required disabled={busy} rows={4}
                  className="mt-2 w-full border rounded-xl px-3 py-2" style={{ background: "var(--claude-surface)", borderColor: "var(--claude-border)" }} />
              </label>
              <label className="block text-sm">Email or phone number for a reply
                <input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} minLength={3} maxLength={200} required disabled={busy}
                  className="mt-2 w-full border rounded-xl px-3 py-2" style={{ background: "var(--claude-surface)", borderColor: "var(--claude-border)" }} />
              </label>
              <p className="text-xs" style={{ color: "var(--claude-muted)" }}>Your message and contact details will be shared with this business.</p>
              <button type="submit" disabled={busy || message.trim().length < 3 || replyTo.trim().length < 3} className="owner-primary-action w-full rounded-xl py-3 disabled:opacity-50">{busy ? "Sending…" : "Leave a message"}</button>
            </form>}
          </div>}
        </section>}
        <p className="text-xs leading-relaxed" style={{ color: "var(--claude-muted)" }}>Calls use internet audio. Your device needs an internet connection and microphone permission. Bookmark this page or add it to your home screen for easy access.</p>
        <Link href="/directory" className="inline-block text-sm underline">Browse assistants</Link>
      </div>
    </main>
  );
}
