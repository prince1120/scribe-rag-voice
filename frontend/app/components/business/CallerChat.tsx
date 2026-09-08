"use client";
import { useEffect, useRef, useState } from "react";
import { Send, MessageSquare } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { CallerActions } from "./CallerActions";

export function CallerChat({ name }: { name: string }) {
  const [turns, setTurns] = useState<{ role: string; text: string; sources?: string[] }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const conversation = useRef<string | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [turns, busy]);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    const query = input.trim();
    if (!query || busy) return;
    setBusy(true); setError("");
    const controller = new AbortController(); abort.current = controller;
    try {
      const response = await fetch("/api/v1/business/chat", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
        body: JSON.stringify({ query, conversation_id: conversation.current }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not answer. Please try again.");
      conversation.current = data.conversation_id;
      const sources: string[] = Array.isArray(data.sources)
        ? data.sources.map((s: any) => typeof s === "string" ? s : s?.title || s?.filename || "").filter(Boolean)
        : [];
      setTurns(prev => [...prev, { role: "user", text: query }, { role: "assistant", text: data.answer, sources }]);
      setInput("");
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not send. Your message is still here."); }
    finally { setBusy(false); }
  }
  return <main className="caller-chat"><div className="caller-chat-heading"><MessageSquare size={22} /><div><h1>How can we help{name ? `, ${name}` : ""}?</h1><p>Ask about services, hours or business information.</p></div></div>
    <div className="caller-chat-stream" role="log" aria-label="Conversation">
      {turns.length === 0 && <p className="business-muted">Send your first question below. For a confirmed appointment, use voice or leave a request for the team.</p>}
      {turns.map((t, i) => (
        <article key={i} className={`caller-chat-turn ${t.role}`}>
          <strong>{t.role === "user" ? "You" : "Assistant"}</strong>
          <ReactMarkdown>{t.text}</ReactMarkdown>
          {t.sources && t.sources.length > 0 && (
            <div className="text-[11px] text-[var(--claude-muted)] mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">Sources:</span>
              {t.sources.map((src, idx) => (
                <span key={idx} className="bg-[var(--claude-surface-2)] px-2 py-0.5 rounded border border-[var(--claude-border)]">{src}</span>
              ))}
            </div>
          )}
        </article>
      ))}
      {busy && <p role="status" className="business-muted">The assistant is preparing an answer…</p>}<div ref={end} />
    </div>
    <form onSubmit={send} className="business-form"><label htmlFor="caller-question">Your question</label><textarea id="caller-question" maxLength={4000} rows={2} value={input} disabled={busy} onChange={e => setInput(e.target.value)} placeholder="What would you like to know?" required />{error && <p role="alert" className="business-error">{error}</p>}<button className="business-button" disabled={busy || !input.trim()}><Send size={16} />{busy ? "Sending…" : "Send message"}</button></form>
    <CallerActions />
  </main>;
}
