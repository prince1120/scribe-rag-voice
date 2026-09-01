"use client";

import { ownerFetch } from "../lib/ownerFetch";

// Try the agent without leaving the owner panel.
//
// Testing used to mean a link into the personal document app, which is a
// different product with a different sidebar and a different mental model. An
// owner checking their assistant should never see a document library they do
// not manage from there — so the test happens here, against the same config
// the editor is showing.

import { useCallback, useRef, useState } from "react";

import { AgentVoiceTest } from "./AgentVoiceTest";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export function AgentTest({
  deployed,
  voiceAvailable = false,
  chatAvailable = false,
  voiceBlockedReason,
  chatBlockedReason,
}: {
  deployed: boolean;
  /** A channel is testable once it has a prompt — and, for chat, documents,
   *  since chat always answers from them. Testing a channel with neither
   *  proves nothing: it would answer from an empty prompt or refuse every
   *  question. */
  voiceAvailable?: boolean;
  chatAvailable?: boolean;
  voiceBlockedReason?: string | null;
  chatBlockedReason?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const [channel, setChannel] = useState<"chat" | "voice">("voice");

  // Land on whichever channel actually works, so opening the panel never
  // shows a disabled tab as the selected one.
  const activeChannel =
    channel === "voice" && !voiceAvailable && chatAvailable ? "chat"
    : channel === "chat" && !chatAvailable && voiceAvailable ? "voice"
    : channel;

  const nothingReady = !voiceAvailable && !chatAvailable;

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || sending) return;

    setSending(true);
    setError("");
    setInput("");
    setTurns((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "" }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await ownerFetch("/api/v1/query/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ query: question }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "The assistant could not answer.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // The last element may be a partial line; hold it for the next read or
        // whichever token straddled the boundary is silently lost.
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const frame = JSON.parse(payload);
            if (typeof frame.text === "string") {
              setTurns((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  role: "assistant",
                  content: next[next.length - 1].content + frame.text,
                };
                return next;
              });
            } else if (frame.error) {
              setError(String(frame.error));
            }
          } catch {
            // One malformed frame must not abort a stream still delivering.
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "The assistant could not answer.");
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [input, sending]);

  if (!open) {
    return (
      <section className="agent-section">
        <button
          type="button"
          className="agent-test ds-pressable ds-tap"
          onClick={() => setOpen(true)}
          disabled={nothingReady}
        >
          Test your assistant
        </button>
        <p className="agent-hint">
          {nothingReady
            ? "Write a prompt for voice or chat, then save, to test it here."
            : "Try it here before sharing a link. Testing uses the saved configuration, so save your changes first."}
        </p>
      </section>
    );
  }

  return (
    <section className="agent-section">
      <div className="agent-test-head">
        <div className="agent-test-tabs" role="group" aria-label="Test channel">
          <button
            type="button"
            className={`agent-test-tab ${activeChannel === "voice" ? "is-active" : ""}`}
            onClick={() => setChannel("voice")}
            aria-pressed={activeChannel === "voice"}
            disabled={!voiceAvailable}
            title={voiceBlockedReason || undefined}
          >
            Voice
          </button>
          <button
            type="button"
            className={`agent-test-tab ${activeChannel === "chat" ? "is-active" : ""}`}
            onClick={() => setChannel("chat")}
            aria-pressed={activeChannel === "chat"}
            disabled={!chatAvailable}
            title={chatBlockedReason || undefined}
          >
            Chat
          </button>
        </div>
        <button
          type="button"
          className="agent-test-close"
          onClick={() => { abortRef.current?.abort(); setOpen(false); }}
        >
          Close
        </button>
      </div>

      {activeChannel === "chat" && !chatAvailable && chatBlockedReason && (
        <p className="agent-hint">{chatBlockedReason}</p>
      )}
      {activeChannel === "voice" && !voiceAvailable && voiceBlockedReason && (
        <p className="agent-hint">{voiceBlockedReason}</p>
      )}

      {activeChannel === "voice" ? (
        <AgentVoiceTest deployed={deployed} />
      ) : (
      <>
      {!deployed && (
        <p className="agent-hint">
          This agent is still a draft. Testing works, but shared links will not
          connect until you deploy.
        </p>
      )}

      <div className="agent-test-log ds-scroll">
        {turns.length === 0 ? (
          <p className="agent-hint">
            Ask something a customer would ask.
          </p>
        ) : (
          turns.map((turn, i) => (
            <div key={i} className={`agent-test-turn is-${turn.role}`}>
              {turn.content || (turn.role === "assistant" && sending ? "Checking knowledge base — answering immediately…" : "")}
            </div>
          ))
        )}
      </div>

      {error && <p className="agent-error" role="alert">{error}</p>}

      <div className="agent-test-input">
        <input
          className="agent-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
          placeholder="Ask your assistant something…"
          disabled={sending}
        />
        <button
          type="button"
          className="agent-save ds-pressable ds-tap"
          onClick={() => void send()}
          disabled={!input.trim() || sending}
        >
          {sending ? "…" : "Ask"}
        </button>
      </div>
      </>
      )}
    </section>
  );
}
