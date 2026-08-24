"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bot,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileText,
  Key,
  PhoneCall,
  ShieldCheck,
  Sliders,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { ScribeMark } from "../../Logo";
import type { KeyPair } from "../../lib/personalSession";

interface AgentCard {
  handle: string;
  business_name: string;
  business_category: string;
  agent_name: string;
  greeting: string;
  language: string;
  voice_id: string;
  has_voice: boolean;
  has_chat: boolean;
  deployed_at: string | null;
}

function maskKey(key: string): string {
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

interface LandingProps {
  keyHistory: KeyPair[];
  onStart: (groqKey: string, sarvamKey?: string) => void;
  onSelectPair: (pair: KeyPair) => void;
  onForgetPair: (groqKey: string) => void;
}

export function Landing({ keyHistory, onStart, onSelectPair, onForgetPair }: LandingProps) {
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [groqInput, setGroqInput] = useState("");
  const [sarvamInput, setSarvamInput] = useState("");
  const [showPersonalModal, setShowPersonalModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/v1/directory/agents");
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) setAgents((data.agents || []).slice(0, 3));
      } catch {
        /* directory fallback */
      } finally {
        if (!cancelled) setLoadingAgents(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const canStart = Boolean(groqInput.trim());
  const handleStart = () => {
    if (canStart) onStart(groqInput, sarvamInput.trim() || undefined);
  };

  return (
    <div className="min-h-screen flex flex-col antialiased selection:bg-[var(--claude-accent-soft)]" style={{ background: "var(--claude-bg)" }}>
      {/* ── Top Navigation Bar ─────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-md transition-all"
        style={{ borderColor: "var(--claude-border)", background: "rgba(240, 238, 230, 0.88)" }}
      >
        <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 group">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center border shadow-xs transition-transform group-hover:scale-105"
              style={{
                background: "var(--claude-surface)",
                borderColor: "var(--claude-border-strong)",
                color: "var(--claude-accent)",
              }}
            >
              <ScribeMark className="w-5 h-5" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-serif-display font-bold text-lg tracking-tight" style={{ color: "var(--claude-text)" }}>
                Scribe
              </span>
              <span className="hidden md:inline text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", color: "var(--claude-muted)" }}>
                Voice & RAG Assistant
              </span>
            </div>
          </Link>

          <nav className="flex items-center gap-2.5 sm:gap-3" aria-label="Primary">
            <button
              type="button"
              onClick={() => setShowPersonalModal(true)}
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition-colors hover:border-[var(--claude-border-strong)] ds-pressable"
              style={{
                borderColor: "var(--claude-border)",
                background: "var(--claude-surface)",
                color: "var(--claude-text-2)",
              }}
            >
              <Key className="w-3.5 h-3.5 text-[var(--claude-accent)]" />
              <span>Developer BYOK</span>
            </button>

            <Link
              href="/directory"
              className="inline-flex items-center gap-1 text-xs font-semibold px-3.5 py-2 rounded-lg border transition-colors hover:border-[var(--claude-border-strong)] ds-pressable"
              style={{
                borderColor: "var(--claude-border)",
                background: "var(--claude-surface)",
                color: "var(--claude-text-2)",
              }}
            >
              <span>Explore Directory</span>
              <span className="text-[11px] opacity-70">↗</span>
            </Link>

            <Link
              href="/signin"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg text-white shadow-xs hover:opacity-90 ds-pressable whitespace-nowrap"
              style={{ background: "var(--claude-accent)" }}
            >
              <span>Business Sign In</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center">
        {/* ── Hero Section ─────────────────────────────────────────────────── */}
        <section className="w-full px-4 sm:px-6 lg:px-8 pt-12 sm:pt-16 pb-10 max-w-4xl mx-auto flex flex-col items-center text-center">
          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium mb-6 border shadow-xs ds-animate-rise"
            style={{
              borderColor: "var(--claude-border-strong)",
              background: "var(--claude-surface)",
              color: "var(--claude-accent)",
            }}
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>Turn documents into a live AI phone assistant in 60s</span>
          </div>

          {/* Headline */}
          <h1
            className="font-serif-display font-bold tracking-tight text-balance mb-5"
            style={{
              color: "var(--claude-text)",
              fontSize: "clamp(34px, 5.5vw, 52px)",
              lineHeight: 1.1,
            }}
          >
            Your business, on call —{" "}
            <span className="italic font-normal" style={{ color: "var(--claude-accent)" }}>
              even when you’re not.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-base sm:text-lg max-w-2xl mx-auto mb-8 font-normal" style={{ color: "var(--claude-muted)", lineHeight: 1.6 }}>
            Upload your price sheets, FAQs, or service guides. Scribe gives your business a live assistant that answers customer calls with verified, document-grounded truth.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center gap-3.5 w-full sm:w-auto mb-6">
            <Link
              href="/setup"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-xl text-sm font-semibold text-white shadow-sm hover:shadow-md transition-all ds-pressable min-h-[46px]"
              style={{ background: "var(--claude-accent)" }}
            >
              <span>Create your assistant in 60s</span>
              <ArrowRight className="w-4 h-4" />
            </Link>

            <Link
              href="/directory"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-semibold border transition-colors hover:border-[var(--claude-border-strong)] ds-pressable min-h-[46px]"
              style={{
                borderColor: "var(--claude-border)",
                background: "var(--claude-surface)",
                color: "var(--claude-text)",
              }}
            >
              <PhoneCall className="w-4 h-4 text-[var(--claude-accent)]" />
              <span>Try Live Directory</span>
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setShowPersonalModal(true)}
            className="text-xs font-medium underline underline-offset-4 hover:opacity-80 transition-opacity"
            style={{ color: "var(--claude-muted)" }}
          >
            Or try personal chat with your own Groq key →
          </button>

          {/* Trust Highlights */}
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-8 text-xs font-medium mt-8 pt-6 border-t w-full max-w-xl mx-auto" style={{ borderColor: "var(--claude-border)", color: "var(--claude-muted)" }}>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Zero setup code
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-[var(--claude-accent)]" />
              Sub-second voice turn
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Grounded citations
            </span>
          </div>

          {/* ── Visual Product Showcase (Clean Conversation Preview) ────── */}
          <div className="w-full max-w-2xl mt-10 text-left ds-animate-rise">
            <div
              className="rounded-2xl border shadow-sm overflow-hidden"
              style={{
                borderColor: "var(--claude-border-strong)",
                background: "var(--claude-surface)",
              }}
            >
              <div
                className="px-4 py-3 border-b flex items-center justify-between"
                style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface-2)" }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-semibold" style={{ color: "var(--claude-text)" }}>
                    Live Call Simulation · Apex Clinic
                  </span>
                </div>
                <span className="text-[11px] font-mono text-stone-500">Neural Voice · 24kHz</span>
              </div>

              <div className="p-5 sm:p-6 flex flex-col gap-4">
                {/* Caller message */}
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-[var(--claude-sidebar)] border border-[var(--claude-border)] flex items-center justify-center text-[11px] font-bold text-stone-600 shrink-0">
                    C
                  </div>
                  <div className="rounded-xl p-3.5 text-xs font-medium border" style={{ background: "var(--claude-bg)", borderColor: "var(--claude-border)", color: "var(--claude-text)" }}>
                    “Hi! Do you have any emergency dental appointments open this Thursday afternoon?”
                  </div>
                </div>

                {/* Assistant message */}
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0 shadow-xs" style={{ background: "var(--claude-accent)" }}>
                    <Bot className="w-4 h-4" />
                  </div>
                  <div className="rounded-xl p-4 text-xs leading-relaxed text-white shadow-xs flex flex-col gap-2" style={{ background: "var(--claude-bubble)" }}>
                    <p className="text-stone-100 font-normal">
                      “Yes! We have an emergency opening with Dr. Roberts this Thursday at 2:30 PM. Would you like me to hold that slot for you?”
                    </p>
                    <div className="flex items-center gap-1.5 pt-1.5 border-t border-stone-700/60 text-[10px] text-stone-400 font-mono">
                      <FileText className="w-3 h-3 text-indigo-300" />
                      <span>Source: clinic_schedule.pdf (Section 2.1)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── How It Works (Clean 3-Step Grid) ────────────────────────────── */}
        <section className="w-full px-4 sm:px-6 lg:px-8 py-12 max-w-5xl mx-auto">
          <div className="text-center max-w-md mx-auto mb-10">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider mb-2" style={{ background: "var(--claude-surface-2)", color: "var(--claude-muted)" }}>
              Simple Setup
            </div>
            <h2 className="font-serif-display font-bold text-2xl tracking-tight" style={{ color: "var(--claude-text)" }}>
              How Scribe Works
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Step 1 */}
            <div
              className="rounded-2xl border p-6 flex flex-col justify-between shadow-xs transition-transform hover:-translate-y-0.5"
              style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-xs"
                    style={{ background: "var(--claude-accent)" }}
                  >
                    1
                  </div>
                  <FileText className="w-4 h-4" style={{ color: "var(--claude-muted)" }} />
                </div>
                <h3 className="text-sm font-semibold mb-1.5" style={{ color: "var(--claude-text)" }}>
                  Add your knowledge
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: "var(--claude-muted)" }}>
                  Upload an FAQ, price sheet, or menu. Scribe indexes your documents into a fast vector index.
                </p>
              </div>
              <div className="mt-5 pt-3 border-t text-[11px] font-mono text-stone-500 flex items-center gap-1.5" style={{ borderColor: "var(--claude-border)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>pricing_sheet.pdf</span>
              </div>
            </div>

            {/* Step 2 */}
            <div
              className="rounded-2xl border p-6 flex flex-col justify-between shadow-xs transition-transform hover:-translate-y-0.5"
              style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-xs"
                    style={{ background: "var(--claude-accent)" }}
                  >
                    2
                  </div>
                  <Sliders className="w-4 h-4" style={{ color: "var(--claude-muted)" }} />
                </div>
                <h3 className="text-sm font-semibold mb-1.5" style={{ color: "var(--claude-text)" }}>
                  Customize prompt & voice
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: "var(--claude-muted)" }}>
                  Select neural voices (English, Hindi, and regional accents) and set your assistant’s greeting and guardrails.
                </p>
              </div>
              <div className="mt-5 pt-3 border-t text-[11px] text-stone-500 flex items-center justify-between" style={{ borderColor: "var(--claude-border)" }}>
                <span>Voice: Anushka</span>
                <span className="font-semibold text-emerald-700">Neural</span>
              </div>
            </div>

            {/* Step 3 */}
            <div
              className="rounded-2xl border p-6 flex flex-col justify-between shadow-xs transition-transform hover:-translate-y-0.5"
              style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-xs"
                    style={{ background: "var(--claude-accent)" }}
                  >
                    3
                  </div>
                  <PhoneCall className="w-4 h-4" style={{ color: "var(--claude-muted)" }} />
                </div>
                <h3 className="text-sm font-semibold mb-1.5" style={{ color: "var(--claude-text)" }}>
                  Share a link, get transcripts
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: "var(--claude-muted)" }}>
                  Send customers a direct call link. Every turn is saved to your dashboard for full visibility.
                </p>
              </div>
              <div className="mt-5 pt-3 border-t text-[11px] text-[var(--claude-accent)] font-semibold truncate" style={{ borderColor: "var(--claude-border)" }}>
                scribe.app/link/business
              </div>
            </div>
          </div>
        </section>

        {/* ── Live Examples Section ───────────────────────────────────────── */}
        <section className="w-full px-4 sm:px-6 lg:px-8 py-10 pb-16 max-w-5xl mx-auto">
          <div className="flex items-center justify-between gap-3 mb-6">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--claude-text)" }}>
                Live Business Assistants
              </h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--claude-muted)" }}>
                Real assistants you can talk to right now — no sign up needed.
              </p>
            </div>
            <Link
              href="/directory"
              className="text-xs font-semibold inline-flex items-center gap-1 underline underline-offset-4"
              style={{ color: "var(--claude-accent)" }}
            >
              Browse full directory →
            </Link>
          </div>

          {loadingAgents ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-2xl border p-5 flex flex-col gap-3 animate-pulse"
                  style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}
                >
                  <div className="h-4 bg-[var(--claude-border)] rounded w-1/3" />
                  <div className="h-5 bg-[var(--claude-border)] rounded w-3/4" />
                  <div className="h-12 bg-[var(--claude-border)] rounded w-full" />
                </div>
              ))}
            </div>
          ) : agents.length === 0 ? (
            <div
              className="rounded-2xl border p-8 text-center"
              style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3"
                style={{ background: "var(--claude-bg)", color: "var(--claude-muted)" }}
              >
                <Building2 className="w-5 h-5" />
              </div>
              <p className="text-sm font-semibold" style={{ color: "var(--claude-text)" }}>
                Be the first business here
              </p>
              <p className="text-xs mt-1 max-w-sm mx-auto" style={{ color: "var(--claude-muted)", lineHeight: 1.5 }}>
                Create your assistant and it will appear here for anyone to call and test.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {agents.map((agent) => (
                <div
                  key={agent.handle}
                  className="rounded-2xl border p-5 flex flex-col justify-between shadow-xs transition-shadow hover:shadow-md"
                  style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border truncate max-w-[60%]"
                        style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-muted)" }}
                      >
                        {agent.business_category || "Business"}
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Live
                      </span>
                    </div>

                    <h3 className="font-serif-display text-base font-bold tracking-tight truncate" style={{ color: "var(--claude-text)" }}>
                      {agent.business_name}
                    </h3>
                    <p className="text-xs font-medium mt-0.5 flex items-center gap-1.5 truncate" style={{ color: "var(--claude-muted)" }}>
                      <Bot className="w-3.5 h-3.5 text-[var(--claude-accent)]" />
                      <span className="truncate">{agent.agent_name}</span>
                    </p>

                    <div
                      className="rounded-xl p-3 text-xs italic leading-relaxed mt-3 border"
                      style={{ background: "var(--claude-bg)", color: "var(--claude-text-2)", borderColor: "var(--claude-border)" }}
                    >
                      <span className="line-clamp-3">“{agent.greeting}”</span>
                    </div>
                  </div>

                  <Link
                    href={`/link/${agent.handle}`}
                    className="text-xs font-semibold text-center mt-4 py-2.5 rounded-xl border hover:bg-[var(--claude-accent)] hover:text-white transition-all block ds-pressable"
                    style={{ background: "var(--claude-bg)", color: "var(--claude-text)", borderColor: "var(--claude-border)" }}
                  >
                    Talk to Assistant →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ── Developer BYOK Personal Modal (Clean Pop-up) ──────────────────── */}
      {showPersonalModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 ds-animate-fade"
          style={{ background: "rgba(20, 20, 18, 0.45)", backdropFilter: "blur(4px)" }}
          onClick={() => setShowPersonalModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border p-6 flex flex-col gap-4 shadow-xl ds-animate-scale"
            style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-serif-display text-lg font-bold" style={{ color: "var(--claude-text)" }}>
                  Developer Personal Chat
                </h3>
                <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "var(--claude-muted)" }}>
                  Bring your own Groq key to test personal docs. Keys stay strictly in your browser.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPersonalModal(false)}
                className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg border hover:bg-[var(--claude-bg)] transition-colors"
                style={{ borderColor: "var(--claude-border)", color: "var(--claude-muted)" }}
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--claude-muted)" }}>
                  Groq API Key <span className="normal-case font-normal">(required)</span>
                </span>
                <input
                  type="password"
                  value={groqInput}
                  onChange={(e) => setGroqInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && groqInput.trim()) handleStart();
                  }}
                  placeholder="gsk_..."
                  autoComplete="off"
                  className="w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:border-[var(--claude-accent)] transition"
                  style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--claude-muted)" }}>
                  Sarvam API Key <span className="normal-case font-normal">(optional — voice only)</span>
                </span>
                <input
                  type="password"
                  value={sarvamInput}
                  onChange={(e) => setSarvamInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && groqInput.trim()) handleStart();
                  }}
                  placeholder="Leave empty for chat-only"
                  autoComplete="off"
                  className="w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:border-[var(--claude-accent)] transition"
                  style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
                />
              </label>
            </div>

            <button
              type="button"
              disabled={!canStart}
              onClick={handleStart}
              className="w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed ds-pressable"
              style={{ background: "var(--claude-accent)" }}
            >
              {sarvamInput.trim() ? "Start chat + voice" : "Start chat"}
            </button>

            <div className="flex items-center justify-between text-xs pt-1" style={{ color: "var(--claude-muted)" }}>
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 inline-flex items-center gap-1"
              >
                Get free Groq key <ExternalLink className="w-3 h-3" />
              </a>
              <span className="text-[11px]">Up to 4 docs per session</span>
            </div>

            {keyHistory.length > 0 && (
              <div className="pt-3 border-t" style={{ borderColor: "var(--claude-border)" }}>
                <p className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--claude-muted)" }}>
                  Recently used
                </p>
                <div className="flex flex-col gap-1.5 max-h-28 overflow-y-auto pr-1 ds-scroll">
                  {keyHistory.map((pair) => (
                    <div
                      key={pair.groqKey}
                      className="flex items-center justify-between gap-2 rounded-xl border px-3 py-1.5"
                      style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)" }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setGroqInput(pair.groqKey);
                          setSarvamInput(pair.sarvamKey);
                        }}
                        onDoubleClick={() => onSelectPair(pair)}
                        title="Click to fill · Double-click to start"
                        className="flex-1 text-left text-xs font-mono truncate"
                        style={{ color: "var(--claude-text-2)" }}
                      >
                        {maskKey(pair.groqKey)} {pair.sarvamKey ? `· Sarvam ${maskKey(pair.sarvamKey)}` : ""}
                      </button>
                      <button
                        type="button"
                        onClick={() => onForgetPair(pair.groqKey)}
                        className="text-stone-400 hover:text-stone-700"
                        aria-label="Forget key"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t py-6 px-4 text-center mt-auto" style={{ borderColor: "var(--claude-border)", color: "var(--claude-muted)" }}>
        <p className="text-xs">Scribe — grounded answers, real voice, every conversation saved.</p>
      </footer>
    </div>
  );
}
