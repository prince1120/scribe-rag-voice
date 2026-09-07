"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle,
  Database,
  FileText,
  Key,
  Microphone,
  Phone,
  ShieldCheck,
  Sparkle,
  SpeakerHigh,
  X,
  Lightning,
  Buildings,
  Robot,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { Geist } from "next/font/google";
import { ScribeMark } from "../../Logo";
import type { KeyPair } from "../../lib/personalSession";

const geist = Geist({ subsets: ["latin"], display: "swap" });

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
  const reduce = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/v1/directory/agents");
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) setAgents(data.agents || []);
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

  // Stagger parent for high-agency orchestration — parent + children same tree
  const heroParent = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08, delayChildren: 0.14 } },
  };
  const revealItem = {
    hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 16, filter: "blur(6px)" },
    show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const } },
  };

  return (
    <div className={`${geist.className} min-h-[100dvh] flex flex-col antialiased selection:bg-[var(--claude-accent-soft)] overflow-x-hidden`} style={{ background: "var(--claude-bg)" }}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 z-[60] px-4 py-2 rounded-full text-xs font-semibold bg-[var(--claude-accent)] text-white">
        Skip to content
      </a>
      {/* Grain — fixed, pointer-events-none, never on scroll container */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[1] opacity-[0.035] mix-blend-multiply"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.4'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Fluid Island Nav — detached pill, not edge-glued */}
      <motion.header
        initial={reduce ? false : { opacity: 0, y: -12, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] as const }}
        className="fixed top-6 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-24px)] max-w-[1120px] pointer-events-none"
      >
        <nav
          className="pointer-events-auto flex items-center justify-between gap-3 rounded-full px-5 sm:px-6 py-2.5 border shadow-[0_8px_32px_rgba(44,43,40,0.08),0_1px_2px_rgba(44,43,40,0.06)]"
          style={{
            background: "rgba(250,249,245,0.88)",
            borderColor: "rgba(221,217,204,0.9)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: "0 8px 32px rgba(44,43,40,0.08), inset 0 1px 0 rgba(255,255,255,0.6)",
          }}
          aria-label="Primary"
        >
          <Link href="/" className="flex items-center gap-3 group">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center border shadow-xs transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105 group-active:scale-[0.98] will-change-transform"
              style={{ background: "var(--claude-surface)", borderColor: "var(--claude-border-strong)", color: "var(--claude-accent)" }}
            >
              <ScribeMark className="w-4 h-4" />
            </div>
            <span className="font-editorial font-bold text-[17px] tracking-tight" style={{ color: "var(--claude-text)" }}>
              Scribe
            </span>
            <span className="hidden sm:inline-flex text-[10px] font-semibold uppercase tracking-[0.14em] px-2.5 py-1 rounded-full border" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", color: "var(--claude-muted)" }}>
              DIRECTORY
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPersonalModal(true)}
              className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-1.5 rounded-full border will-change-transform transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[var(--claude-border-strong)] active:scale-[0.98]"
              style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", color: "var(--claude-text-2)" }}
            >
              <Key size={14} weight="regular" className="text-[var(--claude-accent)]" />
              Developer BYOK
            </button>
            <Link
              href="/directory"
              className="hidden sm:inline-flex items-center gap-1 text-xs font-medium px-3.5 py-1.5 rounded-full border will-change-transform transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[var(--claude-border-strong)] active:scale-[0.98]"
              style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", color: "var(--claude-text-2)" }}
            >
              Explore Directory <ArrowUpRight size={14} weight="regular" className="opacity-60" />
            </Link>
            <Link
              href="/signin"
              className="group inline-flex items-center gap-2 pl-4 pr-1.5 py-1.5 rounded-full text-white text-xs font-semibold shadow-xs will-change-transform transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:opacity-95 active:scale-[0.98]"
              style={{ background: "var(--claude-accent)" }}
            >
              Sign In
              <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:scale-105">
                <ArrowRight size={14} weight="bold" />
              </span>
            </Link>
          </div>
        </nav>
      </motion.header>

      <main id="main" className="flex-1 flex flex-col items-center w-full">
        {/* Hero — lifted, fits viewport without scroll, compact */}
        <section className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-24 sm:pt-28 lg:pt-20 pb-10 sm:pb-12 lg:pb-16">
          <motion.div
            variants={heroParent}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-6 items-center w-full"
          >
            {/* Left — centered on phone, left-aligned on desktop for symmetry */}
            <motion.div variants={revealItem} className="lg:col-span-7 flex flex-col items-center lg:items-start text-center lg:text-left min-w-0 lg:pl-[2vw]">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-medium tracking-wide border mx-auto lg:mx-0" style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-surface)", color: "var(--claude-accent)" }}>
                <Sparkle size={14} weight="regular" />
                Turn documents into a live phone assistant in 60s
              </span>

              <h1
                className="font-editorial font-bold tracking-tight text-balance mt-4 max-w-[18ch] mx-auto lg:mx-0"
                style={{ color: "var(--claude-text)", fontSize: "clamp(36px, 5.2vw, 56px)", lineHeight: 1.02, letterSpacing: "-0.025em", textWrap: "balance" }}
              >
                Your business, on call.{" "}
                <span className="italic font-normal" style={{ color: "var(--claude-accent)", paddingBottom: "0.08em" }}>
                  Even when you are away.
                </span>
              </h1>

              <p className="text-[14px] sm:text-[15px] leading-relaxed max-w-[52ch] mt-4 mx-auto lg:mx-0 text-center lg:text-left" style={{ color: "var(--claude-muted)", lineHeight: 1.6 }}>
                Upload price sheets, FAQs, or service guides. Scribe answers real customer calls with verified document truth — voice and chat from one knowledge base.
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center lg:justify-start gap-3 w-full sm:w-auto mt-6">
                <Link
                  href="/setup"
                  className="group inline-flex items-center justify-between gap-4 pl-7 pr-2 py-2.5 rounded-full text-sm font-semibold text-white shadow-[0_8px_24px_rgba(72,84,168,0.22)] will-change-transform transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[0_10px_28px_rgba(72,84,168,0.28)] active:scale-[0.98]"
                  style={{ background: "var(--claude-accent)" }}
                >
                  Create your assistant in 60s
                  <span className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:scale-105">
                    <ArrowRight size={16} weight="bold" />
                  </span>
                </Link>
                <Link
                  href="/directory"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full text-sm font-semibold border bg-white/70 backdrop-blur will-change-transform transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[var(--claude-border-strong)] active:scale-[0.98]"
                  style={{ borderColor: "var(--claude-border-strong)", color: "var(--claude-text)" }}
                >
                  <Phone size={16} weight="regular" className="text-[var(--claude-accent)]" />
                  Try Live Directory
                </Link>
              </div>

              <button type="button" onClick={() => setShowPersonalModal(true)} className="text-xs font-medium underline underline-offset-4 decoration-[var(--claude-border-strong)] hover:opacity-70 transition-opacity mt-4 mx-auto lg:mx-0 text-center" style={{ color: "var(--claude-muted)" }}>
                Or try personal chat with your own Groq key →
              </button>

              <div className="hidden sm:flex flex-wrap items-center gap-5 sm:gap-7 text-xs font-medium mt-6 pt-4 border-t w-full" style={{ borderColor: "var(--claude-border)", color: "var(--claude-muted)" }}>
                <span className="inline-flex items-center gap-2">
                  <CheckCircle size={16} weight="regular" className="text-emerald-600" />
                  Zero setup code
                </span>
                <span className="inline-flex items-center gap-2">
                  <Lightning size={16} weight="regular" className="text-[var(--claude-accent)]" />
                  Sub-second turn
                </span>
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck size={16} weight="regular" className="text-emerald-600" />
                  Grounded citations
                </span>
              </div>
            </motion.div>

            {/* Right — asset with offset asymmetry, varied aspect */}
            <motion.div variants={revealItem} className="lg:col-span-5 relative w-full max-w-[520px] mx-auto lg:mx-0 min-w-0 lg:mt-2">
              <div className="double-bezel-outer p-1.5 sm:p-2 shadow-[0_20px_60px_rgba(44,43,40,0.10),0_2px_10px_rgba(44,43,40,0.06)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]">
                <div className="double-bezel-inner overflow-hidden flex flex-col relative" style={{ background: "var(--claude-surface)" }}>
                  <div aria-hidden className="pointer-events-none absolute -top-20 -right-16 w-[380px] h-[380px] rounded-full blur-[52px] opacity-[0.07]" style={{ background: "var(--claude-accent)" }} />
                  <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface-2)" }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-6 h-6 rounded-full bg-[var(--claude-accent-soft)] border border-[var(--claude-border)] flex items-center justify-center text-[var(--claude-accent)] shrink-0">
                        <Phone size={12} weight="regular" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold leading-none truncate" style={{ color: "var(--claude-text)" }}>
                          Maya · Apex Dental Clinic
                        </div>
                        <div className="text-[9px] leading-none mt-0.5 truncate" style={{ color: "var(--claude-muted)" }}>
                          Healthcare · Anushka · Warm
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[9px] font-mono font-semibold px-2 py-1 rounded-full border shrink-0 tabular-nums" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)", color: "var(--claude-accent)" }}>
                      <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                      00:42
                    </span>
                  </div>

                  <div className="flex flex-col items-center gap-3 px-4 py-4">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-semibold" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }}>
                      <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                      Listening — grounded answer
                    </div>
                    <div className="relative flex items-center justify-center w-[100px] h-[100px] sm:w-[132px] sm:h-[132px]">
                      <div className="absolute inset-0 rounded-full border opacity-[0.06]" style={{ borderColor: "var(--claude-accent)" }} />
                      <div className="voice-wave-halo opacity-25" />
                      <div className="voice-wave-halo delayed opacity-15" />
                      <div
                        className="rounded-full relative overflow-hidden"
                        style={{
                          width: 88,
                          height: 88,
                          background: "radial-gradient(circle at 35% 30%, #FFFFFF 0%, var(--claude-accent) 58%, var(--claude-accent-hover) 100%)",
                          boxShadow: "0 14px 36px -10px rgba(72,84,168,0.38), inset 0 -8px 18px rgba(0,0,0,0.20), inset 0 8px 14px rgba(255,255,255,0.84)",
                        }}
                      >
                        <div aria-hidden className="absolute rounded-full" style={{ width: "56%", height: "56%", top: "9%", left: "11%", background: "radial-gradient(circle, rgba(255,255,255,0.94) 0%, transparent 68%)", filter: "blur(4px)" }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-60">
                      <span className="w-[3px] rounded-full bg-[var(--claude-border-strong)]" style={{ height: 10 }} />
                      <span className="w-[3px] rounded-full bg-[var(--claude-border-strong)]" style={{ height: 14 }} />
                      <span className="w-[3px] rounded-full bg-[var(--claude-border-strong)]" style={{ height: 16 }} />
                      <span className="w-[3px] rounded-full bg-[var(--claude-border-strong)]" style={{ height: 11 }} />
                      <span className="w-[3px] rounded-full bg-[var(--claude-border-strong)]" style={{ height: 13 }} />
                    </div>
                    <p className="text-[9px] font-mono tracking-widest uppercase tabular-nums" style={{ color: "var(--claude-muted)" }}>
                      24 kHz neural turn · verified
                    </p>
                  </div>

                  <div className="mx-3 mb-3 rounded-[14px] border overflow-hidden" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)" }}>
                    <div className="px-3 py-2 flex items-center justify-between border-b" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface-2)" }}>
                      <span className="text-[10px] font-semibold inline-flex items-center gap-1.5" style={{ color: "var(--claude-text)" }}>
                        <FileText size={12} weight="regular" className="text-emerald-600" />
                        Clinic schedule · Sec 2.1
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border bg-white tabular-nums" style={{ borderColor: "var(--claude-border)", color: "var(--claude-muted)" }}>
                        1.2
                      </span>
                    </div>
                    <div className="p-3.5 flex flex-col gap-3">
                      <div className="self-end max-w-[82%] rounded-2xl rounded-br-[6px] px-3.5 py-2.5 text-[13px] leading-snug shadow-sm" style={{ background: "var(--claude-bubble)", color: "#F5F3EB" }}>
                        Do you have emergency appointments Thu?
                      </div>
                      <div className="self-start max-w-[88%] rounded-2xl rounded-bl-[6px] border px-3.5 py-3 text-[13px] leading-relaxed" style={{ background: "var(--claude-surface)", borderColor: "var(--claude-border)", color: "var(--claude-text)" }}>
                        Yes — Dr. Roberts has an emergency slot Thu 2:30 PM. I can hold it and send the intake link.
                        <span className="inline-flex items-center justify-center ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border align-baseline tabular-nums" style={{ background: "var(--claude-accent-soft)", borderColor: "var(--claude-border-strong)", color: "var(--claude-accent)" }}>
                          1.2
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-mono tabular-nums">
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold">
                          <CheckCircle size={12} weight="regular" />
                          Verified
                        </span>
                        <span style={{ color: "var(--claude-muted)" }}>312ms retrieval · 892ms total</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </motion.div>
          </motion.div>
        </section>

        <motion.section
          initial={reduce ? false : { opacity: 0, y: 16, filter: "blur(6px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] as const }}
          className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 border-t"
          style={{ borderColor: "var(--claude-border)" }}
        >
          <div className="max-w-3xl mx-auto text-center">
            <p className="font-editorial text-[26px] sm:text-[32px] md:text-[38px] leading-[1.25] tracking-tight" style={{ color: "var(--claude-text)", textWrap: "balance" }}>
              Existing systems operate in <span className="underline decoration-[var(--claude-border-strong)] underline-offset-[6px] decoration-[1.5px]">multiple fields</span>, yet customer inquiries still land on unanswered lines.
            </p>
            <p className="font-editorial font-semibold text-[26px] sm:text-[32px] md:text-[38px] tracking-tight mt-4" style={{ color: "var(--claude-accent)" }}>
              Your business needs an intelligent voice.
            </p>
          </div>
        </motion.section>



        {/* Bento — compact */}
        <section className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12, filter: "blur(6px)" }}
            whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] as const }}
            className="text-center max-w-xl mx-auto mb-12"
          >
            <h2 className="font-editorial font-bold text-3xl sm:text-4xl tracking-tight" style={{ color: "var(--claude-text)", letterSpacing: "-0.025em" }}>
              How Scribe Works
            </h2>
            <p className="text-sm mt-3 max-w-[52ch] mx-auto leading-relaxed" style={{ color: "var(--claude-muted)" }}>
              From uploaded documents to live conversational dispatch — one pipeline, two surfaces.
            </p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.15 }}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09 } } }}
            className="grid grid-cols-1 md:grid-cols-12 gap-5 auto-rows-fr"
          >
            <motion.div variants={revealItem} className="md:col-span-7 rounded-[28px] border p-7 sm:p-8 flex flex-col justify-between shadow-[0_4px_24px_rgba(60,52,38,0.06)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[var(--claude-border-strong)] hover:shadow-[0_8px_32px_rgba(60,52,38,0.08)]" style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-surface-2)" }}>
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-sm" style={{ background: "var(--claude-accent)" }}>
                    01
                  </div>
                  <Database size={16} weight="light" style={{ color: "var(--claude-muted)" }} />
                </div>
                <h3 className="font-editorial font-bold text-lg tracking-tight" style={{ color: "var(--claude-text)" }}>
                  Instant Knowledge Grounding
                </h3>
                <p className="text-[13px] leading-relaxed mt-2 max-w-[48ch]" style={{ color: "var(--claude-muted)" }}>
                  Drop price sheets or FAQs. Documents are chunked, indexed, and verified before any answer.
                </p>
                <div className="mt-5 rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)" }}>
                  <div className="flex-1 flex flex-col gap-1.5">
                    <div className="h-1.5 rounded-full" style={{ background: "var(--claude-border)", width: "68%" }} />
                    <div className="h-1.5 rounded-full" style={{ background: "var(--claude-accent)", width: "92%" }} />
                    <div className="h-1.5 rounded-full" style={{ background: "var(--claude-border)", width: "54%" }} />
                  </div>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center border text-[10px] font-bold" style={{ background: "var(--claude-accent-soft)", borderColor: "var(--claude-border)", color: "var(--claude-accent)" }}>
                    3
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-xl px-3.5 py-3 text-xs font-mono flex items-center justify-between border" style={{ background: "var(--claude-bg)", borderColor: "var(--claude-border)" }}>
                <span className="inline-flex items-center gap-2">
                  <FileText size={14} weight="regular" className="text-[var(--claude-accent)]" />
                  <span className="font-semibold" style={{ color: "var(--claude-text)" }}>
                    clinic_services.pdf
                  </span>
                </span>
                <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 tabular-nums">24 chunks indexed</span>
              </div>
            </motion.div>

            <motion.div variants={revealItem} className="md:col-span-5 rounded-[28px] border p-7 sm:p-8 flex flex-col justify-between shadow-[0_4px_24px_rgba(60,52,38,0.04)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[var(--claude-border-strong)] hover:shadow-[0_8px_32px_rgba(60,52,38,0.06)]" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}>
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-sm" style={{ background: "var(--claude-accent)" }}>
                    02
                  </div>
                  <Microphone size={16} weight="light" style={{ color: "var(--claude-muted)" }} />
                </div>
                <h3 className="font-editorial font-bold text-lg tracking-tight" style={{ color: "var(--claude-text)" }}>
                  Sub-Second Neural Voice
                </h3>
                <p className="text-[13px] leading-relaxed mt-2" style={{ color: "var(--claude-muted)" }}>
                  Natural cadence in English, Hindi, and regional accents. Built for fluid phone calls.
                </p>
                <div className="mt-5 rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)" }}>
                  <div className="flex items-end gap-1 h-7">
                    <span className="w-1 rounded-full" style={{ height: 10, background: "var(--claude-border-strong)" }} />
                    <span className="w-1 rounded-full" style={{ height: 18, background: "var(--claude-accent)" }} />
                    <span className="w-1 rounded-full" style={{ height: 14, background: "var(--claude-border-strong)" }} />
                    <span className="w-1 rounded-full" style={{ height: 20, background: "var(--claude-accent)" }} />
                    <span className="w-1 rounded-full" style={{ height: 12, background: "var(--claude-border-strong)" }} />
                    <span className="w-1 rounded-full" style={{ height: 16, background: "var(--claude-accent)" }} />
                  </div>
                  <span className="ml-auto text-[10px] font-mono tabular-nums px-2 py-1 rounded-full border bg-white" style={{ borderColor: "var(--claude-border)", color: "var(--claude-muted)" }}>
                    Hindi · English
                  </span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t flex items-center justify-between text-xs font-mono tabular-nums" style={{ borderColor: "var(--claude-border)", color: "var(--claude-text-2)" }}>
                <span className="inline-flex items-center gap-1.5">
                  <SpeakerHigh size={14} weight="regular" className="text-[var(--claude-accent)]" />
                  Voice: Anushka
                </span>
                <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">&lt;600ms latency</span>
              </div>
            </motion.div>

            <motion.div variants={revealItem} className="md:col-span-12 rounded-[28px] border p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6 shadow-[0_4px_24px_rgba(60,52,38,0.04)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[var(--claude-border-strong)]" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}>
              <div className="max-w-xl min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-sm shrink-0" style={{ background: "var(--claude-accent)" }}>
                    03
                  </div>
                  <h3 className="font-editorial font-bold text-lg tracking-tight leading-tight" style={{ color: "var(--claude-text)" }}>
                    Shareable Call Link and Auditable Transcripts
                  </h3>
                </div>
                <p className="text-[13px] leading-relaxed sm:pl-11" style={{ color: "var(--claude-muted)" }}>
                  Every call produces a full audio recording and verified transcript with citations — full oversight, zero extra work.
                </p>
              </div>
              <div className="rounded-2xl px-5 py-3 border font-mono text-xs flex items-center justify-center sm:justify-start gap-3 shrink-0 tabular-nums w-full sm:w-auto" style={{ background: "var(--claude-bg)", borderColor: "var(--claude-border)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span style={{ color: "var(--claude-accent)" }} className="font-semibold">
                  scribe.app/t/business-token
                </span>
              </div>
            </motion.div>
          </motion.div>
        </section>

        <section className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
            <div>
              <h2 className="font-editorial font-bold text-2xl sm:text-3xl tracking-tight" style={{ color: "var(--claude-text)", letterSpacing: "-0.025em" }}>
                Live Business Assistants
              </h2>
              <p className="text-xs sm:text-sm mt-2 max-w-[52ch]" style={{ color: "var(--claude-muted)" }}>
                Verified assistants available to test — zero sign-up required.
              </p>
            </div>
            <Link href="/directory" className="hidden sm:inline-flex items-center gap-2 text-xs font-semibold pl-4 pr-1.5 py-1.5 rounded-full border bg-white will-change-transform transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[var(--claude-border-strong)] active:scale-[0.98]" style={{ borderColor: "var(--claude-border)", color: "var(--claude-accent)" }}>
              Full Directory
              <span className="w-6 h-6 rounded-full bg-[var(--claude-accent)] text-white flex items-center justify-center">
                <ArrowRight size={12} weight="bold" />
              </span>
            </Link>
          </div>

          {loadingAgents ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-[28px] border p-6 flex flex-col gap-3" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}>
                  <div className="h-4 w-1/3 rounded bg-[var(--claude-border)] animate-pulse" />
                  <div className="h-5 w-3/4 rounded bg-[var(--claude-border)] animate-pulse" />
                  <div className="h-16 rounded bg-[var(--claude-border)] animate-pulse" />
                </div>
              ))}
            </div>
          ) : agents.length === 0 ? (
            <div className="rounded-[28px] border p-10 text-center" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}>
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: "var(--claude-bg)", color: "var(--claude-muted)" }}>
                <Buildings size={20} weight="light" />
              </div>
              <p className="text-sm font-semibold" style={{ color: "var(--claude-text)" }}>
                Be the first business here
              </p>
              <p className="text-xs mt-1 max-w-sm mx-auto leading-relaxed" style={{ color: "var(--claude-muted)" }}>
                Deploy your assistant and it will appear here for customers to test.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {agents.slice(0, 3).map((agent) => (
                <div key={agent.handle} className="double-bezel-outer p-1.5 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[0_8px_32px_rgba(44,43,40,0.08)]">
                  <div className="double-bezel-inner p-5 flex flex-col justify-between h-full min-h-[220px]">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border truncate max-w-[62%]" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-muted)" }}>
                          {agent.business_category || "Business"}
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Live
                        </span>
                      </div>
                      <h3 className="font-semibold text-[17px] tracking-tight truncate" style={{ color: "var(--claude-text)" }}>
                        {agent.business_name}
                      </h3>
                      <p className="text-xs font-medium mt-1 flex items-center gap-1.5 truncate" style={{ color: "var(--claude-muted)" }}>
                        <Robot size={14} weight="regular" className="text-[var(--claude-accent)]" />
                        <span className="truncate">{agent.agent_name}</span>
                      </p>
                      <div className="rounded-xl p-3 text-xs leading-relaxed mt-4 border line-clamp-3" style={{ background: "var(--claude-bg)", color: "var(--claude-text-2)", borderColor: "var(--claude-border)" }}>
                        “{agent.greeting}”
                      </div>
                    </div>
                    <Link href={`/directory?handle=${agent.handle}`} className="text-xs font-semibold text-center mt-4 py-2.5 rounded-full border will-change-transform transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[var(--claude-accent)] hover:text-white hover:border-[var(--claude-accent)] active:scale-[0.98]" style={{ background: "var(--claude-surface)", color: "var(--claude-text)", borderColor: "var(--claude-border)" }}>
                      Talk to Assistant →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="sm:hidden mt-6 text-center">
            <Link href="/directory" className="inline-flex items-center gap-2 text-xs font-semibold px-5 py-2.5 rounded-full border bg-white" style={{ borderColor: "var(--claude-border)", color: "var(--claude-accent)" }}>
              Full Directory <ArrowRight size={14} weight="bold" />
            </Link>
          </div>
        </section>
      </main>

      {showPersonalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(20, 20, 18, 0.45)", backdropFilter: "blur(6px)" }} onClick={() => setShowPersonalModal(false)}>
          <div className="w-full max-w-md double-bezel-outer p-1.5" onClick={(e) => e.stopPropagation()}>
            <div className="double-bezel-inner p-6 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-editorial text-xl font-bold" style={{ color: "var(--claude-text)" }}>
                    Developer Personal Chat
                  </h3>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--claude-muted)" }}>
                    Bring your own Groq key to test personal documents. Keys stay in your browser.
                  </p>
                </div>
                <button type="button" onClick={() => setShowPersonalModal(false)} className="w-8 h-8 rounded-full border flex items-center justify-center active:scale-[0.98] transition-transform" style={{ borderColor: "var(--claude-border)", color: "var(--claude-muted)" }}>
                  <X size={16} weight="regular" />
                </button>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--claude-muted)" }}>
                  Groq API Key
                </span>
                <input type="password" value={groqInput} onChange={(e) => setGroqInput(e.target.value)} placeholder="gsk_..." className="w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:border-[var(--claude-accent)]" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--claude-muted)" }}>
                  Sarvam API Key <span className="normal-case font-normal">(optional)</span>
                </span>
                <input type="password" value={sarvamInput} onChange={(e) => setSarvamInput(e.target.value)} placeholder="Leave empty for chat-only" className="w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:border-[var(--claude-accent)]" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }} />
              </label>
              <button type="button" disabled={!canStart} onClick={handleStart} className="w-full rounded-full py-3 text-sm font-semibold text-white disabled:opacity-50 active:scale-[0.98] transition-transform will-change-transform" style={{ background: "var(--claude-accent)" }}>
                {sarvamInput.trim() ? "Start chat + voice" : "Start chat"}
              </button>
              <div className="flex items-center justify-between text-xs" style={{ color: "var(--claude-muted)" }}>
                <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 inline-flex items-center gap-1">
                  Get free Groq key <ArrowUpRight size={12} weight="regular" />
                </a>
                <span>Up to 4 docs</span>
              </div>
              {keyHistory.length > 0 && (
                <div className="pt-3 border-t" style={{ borderColor: "var(--claude-border)" }}>
                  <p className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--claude-muted)" }}>
                    Recently used
                  </p>
                  <div className="flex flex-col gap-1.5 max-h-28 overflow-y-auto pr-1">
                    {keyHistory.map((pair) => (
                      <div key={pair.groqKey} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)" }}>
                        <button type="button" onClick={() => { setGroqInput(pair.groqKey); setSarvamInput(pair.sarvamKey); }} className="flex-1 text-left text-xs font-mono truncate tabular-nums" style={{ color: "var(--claude-text-2)" }}>
                          {maskKey(pair.groqKey)}
                        </button>
                        <button type="button" onClick={() => onForgetPair(pair.groqKey)} className="text-stone-400 hover:text-stone-700">
                          <X size={14} weight="regular" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="border-t mt-auto" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface-2)" }}>
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs" style={{ color: "var(--claude-muted)" }}>
          <p>Scribe. Grounded knowledge, real phone voice, every conversation verified.</p>
          <div className="flex items-center gap-4">
            <Link href="/directory" className="hover:text-[var(--claude-text)] transition-colors">
              Directory
            </Link>
            <Link href="/privacy" className="hover:text-[var(--claude-text)] transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[var(--claude-text)] transition-colors">
              Terms
            </Link>
            <span className="hidden sm:inline">© {new Date().getFullYear()} Scribe</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
