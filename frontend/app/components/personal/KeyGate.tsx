"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { ScribeMark } from "../../Logo";
import type { KeyPair } from "../../lib/personalSession";

const DEMO_MAX_DOCUMENTS = 4;
const DEMO_TOP_K = 3;

function maskKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

interface KeyGateProps {
  keyHistory: KeyPair[];
  onStart: (groqKey: string, sarvamKey?: string) => void;
  onSelectPair: (pair: KeyPair) => void;
  onForgetPair: (groqKey: string) => void;
}

export function KeyGate({ keyHistory, onStart, onSelectPair, onForgetPair }: KeyGateProps) {
  const [groqInput, setGroqInput] = useState("");
  const [sarvamInput, setSarvamInput] = useState("");

  const canStart = Boolean(groqInput.trim());

  const handleStart = () => {
    if (canStart) onStart(groqInput, sarvamInput.trim() || undefined);
  };

  const pickPair = (pair: KeyPair) => {
    setGroqInput(pair.groqKey);
    setSarvamInput(pair.sarvamKey);
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4 sm:p-6"
      style={{ background: "var(--claude-bg)" }}
    >
      <div
        className="w-full max-w-md rounded-xl border p-6 flex flex-col gap-4 shadow-sm"
        style={{ borderColor: "var(--claude-border)", background: "var(--claude-sidebar)" }}
      >
        <div className="flex items-center justify-between gap-3 pb-2 border-b" style={{ borderColor: "var(--claude-border)" }}>
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(145deg, var(--claude-accent), var(--claude-accent-hover))" }}
            >
              <ScribeMark className="w-[18px] h-[18px] text-white" />
            </div>
            <div className="flex flex-col justify-center leading-tight">
              <h1 className="font-serif-display text-[19px] leading-tight tracking-tight" style={{ color: "var(--claude-text)" }}>
                Scribe
              </h1>
              <p className="text-[11px] leading-tight mt-0.5" style={{ color: "var(--claude-muted)" }}>
                Personal chat & business voice assistants
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              href="/signin"
              className="text-[12px] font-semibold px-2.5 py-1.5 rounded-md border transition-colors hover:bg-white text-center"
              style={{ borderColor: "var(--claude-border)", color: "var(--claude-accent)", background: "var(--claude-surface)" }}
            >
              Owner Sign In →
            </Link>
            <Link
              href="/directory"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:border-[var(--claude-border-strong)]"
              style={{ borderColor: "var(--claude-border)", color: "var(--claude-text-2)", background: "var(--claude-surface)" }}
            >
              Explore Directory ↗
            </Link>
          </div>
        </div>

        <div className="rounded-lg p-3 text-[12px] flex items-center justify-between gap-3"
             style={{ background: "var(--claude-surface-2)", border: "1px solid var(--claude-border)" }}>
          <div>
            <span className="font-semibold block" style={{ color: "var(--claude-text)" }}>Want to talk to a business assistant?</span>
            <span className="text-[11px]" style={{ color: "var(--claude-muted)" }}>
              Explore live AI phone assistants deployed by businesses and call them directly.
            </span>
          </div>
          <Link href="/directory" className="shrink-0 text-[11px] font-medium underline" style={{ color: "var(--claude-accent)" }}>
            Open Directory →
          </Link>
        </div>

        <div className="pt-1">
          <span className="text-[11px] uppercase tracking-wider font-bold block mb-1" style={{ color: "var(--claude-muted)" }}>
            Personal Demo Mode
          </span>
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
            Paste your Groq key to start chatting now — up to {DEMO_MAX_DOCUMENTS} documents, {DEMO_TOP_K} chunks per answer. Keys stay in
            your browser. Add Sarvam later for voice calls.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider block" style={{ color: "var(--claude-muted)" }}>
              Groq API Key (Required)
            </label>
            <input
              type="password"
              value={groqInput}
              onChange={(e) => setGroqInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && groqInput.trim()) handleStart();
              }}
              placeholder="gsk_..."
              autoFocus
              className="w-full rounded-md border px-3 py-2 text-[13px] outline-none"
              style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider block" style={{ color: "var(--claude-muted)" }}>
              Sarvam API Key <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— optional, voice only</span>
            </label>
            <input
              type="password"
              value={sarvamInput}
              onChange={(e) => setSarvamInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && groqInput.trim()) handleStart();
              }}
              placeholder="Leave empty to start chat-only — add voice later in Settings"
              className="w-full rounded-md border px-3 py-2 text-[13px] outline-none"
              style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
            />
            <p className="text-[11px] leading-snug px-0.5" style={{ color: "var(--claude-muted)" }}>
              Chat works without this. Voice calls need it — you can add it later in Settings.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={!canStart}
          onClick={handleStart}
          className="w-full rounded-md py-2.5 text-[13px] font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          style={{ background: "var(--claude-accent)" }}
        >
          {sarvamInput.trim() ? "Start chat + voice session" : "Start chat session"}
        </button>
        {!sarvamInput.trim() && groqInput.trim() && (
          <p className="text-[11px] text-center -mt-2" style={{ color: "var(--claude-muted)" }}>
            Voice calls will show “Add Sarvam key in Settings” until added.
          </p>
        )}

        <div className="flex items-center justify-center gap-4">
          <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer"
             className="text-[12px] underline text-center inline-flex items-center justify-center gap-1" style={{ color: "var(--claude-muted)" }}>
            Get free Groq key <ExternalLink className="w-3 h-3" />
          </a>
          <a href="https://dashboard.sarvam.ai" target="_blank" rel="noopener noreferrer"
             className="text-[12px] underline text-center inline-flex items-center justify-center gap-1" style={{ color: "var(--claude-muted)" }}>
            Get free Sarvam key <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {keyHistory.length > 0 && (
          <div className="pt-1 border-t" style={{ borderColor: "var(--claude-border)" }}>
            <p className="text-[11px] uppercase tracking-[0.08em] font-semibold mt-3 mb-2" style={{ color: "var(--claude-muted)" }}>
              Recently used
            </p>
            <div className="flex flex-col gap-1">
              {keyHistory.map((pair) => (
                <div
                  key={pair.groqKey}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
                  style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)" }}
                >
                  <button
                    type="button"
                    onClick={() => pickPair(pair)}
                    onDoubleClick={() => onSelectPair(pair)}
                    className="flex-1 text-left text-[12px] font-mono truncate"
                    style={{ color: "var(--claude-text-2)" }}
                    title="Click to fill, double-click to use immediately"
                  >
                    {maskKey(pair.groqKey)} {pair.sarvamKey ? `(Sarvam: ${maskKey(pair.sarvamKey)})` : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => onForgetPair(pair.groqKey)}
                    aria-label="Forget this key pair"
                    title="Forget this key pair"
                    className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded transition-colors"
                    style={{ color: "var(--claude-muted)" }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[11px] mt-2" style={{ color: "var(--claude-muted)" }}>
              Click to fill the fields above. Double-click to use immediately.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
