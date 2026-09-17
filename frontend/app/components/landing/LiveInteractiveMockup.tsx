"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle,
  FileText,
  Phone,
  Sparkle,
} from "@phosphor-icons/react";
import { motion, AnimatePresence } from "motion/react";

interface Scenario {
  status: string;
  statusColor: string;
  docName: string;
  citation: string;
  userText: string;
  assistantText: string;
  retrievalMs: string;
  totalMs: string;
}

const SCENARIOS: Scenario[] = [
  {
    status: "Listening — grounded answer",
    statusColor: "bg-emerald-500",
    docName: "Clinic schedule · Sec 2.1",
    citation: "1.2",
    userText: "Do you have emergency appointments Thu?",
    assistantText:
      "Yes — Dr. Roberts has an emergency slot Thu 2:30 PM. I can hold it and send the intake link.",
    retrievalMs: "312ms",
    totalMs: "892ms",
  },
  {
    status: "Direct knowledge lookup",
    statusColor: "bg-indigo-500",
    docName: "Insurance & Fee Guide · Sec 4.0",
    citation: "2.4",
    userText: "Does dental cleaning include bitewing x-rays under insurance?",
    assistantText:
      "Standard preventive cleanings include bitewing x-rays once annually. Most PPO plans direct-bill this at 100%.",
    retrievalMs: "245ms",
    totalMs: "710ms",
  },
  {
    status: "On-call triage · instant routing",
    statusColor: "bg-violet-500",
    docName: "Urgent Care Policy · Sec 1.3",
    citation: "1.1",
    userText: "What if I experience severe tooth pain tonight after 6 PM?",
    assistantText:
      "Our on-call dentist answers urgent triage lines until 10 PM. I can connect your line or reserve 8 AM priority.",
    retrievalMs: "198ms",
    totalMs: "645ms",
  },
];

export function LiveInteractiveMockup() {
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [seconds, setSeconds] = useState(42);

  // Live second timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((prev) => (prev >= 599 ? 42 : prev + 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Automatic dialogue progression
  useEffect(() => {
    const interval = setInterval(() => {
      setScenarioIdx((prev) => (prev + 1) % SCENARIOS.length);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  const current = SCENARIOS[scenarioIdx];
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="double-bezel-outer p-1 sm:p-1.5 shadow-[0_16px_48px_rgba(44,43,40,0.08),0_2px_8px_rgba(44,43,40,0.05)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]">
      <div
        className="double-bezel-inner overflow-hidden flex flex-col relative"
        style={{ background: "var(--claude-surface)" }}
      >
        {/* Ambient background light blur */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-16 w-[320px] h-[320px] rounded-full blur-[48px]"
          animate={{
            opacity: [0.06, 0.12, 0.06],
            scale: [1, 1.08, 1],
          }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
          style={{ background: "var(--claude-accent)" }}
        />

        {/* Call Top Header */}
        <div
          className="flex items-center justify-between gap-2 px-3 py-2 border-b"
          style={{
            borderColor: "var(--claude-border)",
            background: "var(--claude-surface-2)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-5 h-5 rounded-full bg-[var(--claude-accent-soft)] border border-[var(--claude-border)] flex items-center justify-center text-[var(--claude-accent)] shrink-0">
              <Phone size={11} weight="regular" />
            </span>
            <div className="min-w-0">
              <div
                className="text-[9.5px] font-semibold leading-none truncate"
                style={{ color: "var(--claude-text)" }}
              >
                Maya · Apex Dental Clinic
              </div>
              <div
                className="text-[8.5px] leading-none mt-0.5 truncate"
                style={{ color: "var(--claude-muted)" }}
              >
                Healthcare · Anushka · Warm
              </div>
            </div>
          </div>

          <span
            className="inline-flex items-center gap-1.5 text-[8.5px] font-mono font-semibold px-2 py-0.5 rounded-full border shrink-0 tabular-nums shadow-2xs"
            style={{
              borderColor: "var(--claude-border)",
              background: "var(--claude-surface)",
              color: "var(--claude-accent)",
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 absolute" />
            <span className="ml-0.5">
              {mm}:{ss}
            </span>
          </span>
        </div>

        {/* Center Orb & Visualizer Section */}
        <div className="flex flex-col items-center gap-2 px-3 py-2.5 sm:py-3">
          {/* Animated Status Pill */}
          <AnimatePresence mode="wait">
            <motion.div
              key={current.status}
              initial={{ opacity: 0, y: -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.96 }}
              transition={{ duration: 0.25 }}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[9px] font-semibold shadow-2xs"
              style={{
                borderColor: "var(--claude-border)",
                background: "var(--claude-bg)",
                color: "var(--claude-text)",
              }}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${current.statusColor} animate-pulse`} />
              <span>{current.status}</span>
            </motion.div>
          </AnimatePresence>

          {/* 3D Floating & Breathing Voice Orb */}
          <div className="relative flex items-center justify-center w-[84px] h-[84px] sm:w-[102px] sm:h-[102px]">
            {/* Ambient Pulsing Aura */}
            <motion.div
              className="absolute inset-0 rounded-full blur-lg pointer-events-none"
              animate={{
                scale: [1, 1.2, 1],
                opacity: [0.18, 0.4, 0.18],
              }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
              style={{ background: "radial-gradient(circle, #4854A8 0%, transparent 70%)" }}
            />

            {/* Ripple Wave Halos */}
            <motion.div
              className="absolute inset-0 rounded-full border border-indigo-400/30 pointer-events-none"
              animate={{
                scale: [0.75, 1.35],
                opacity: [0.8, 0],
              }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.div
              className="absolute inset-0 rounded-full border border-indigo-400/20 pointer-events-none"
              animate={{
                scale: [0.75, 1.45],
                opacity: [0.6, 0],
              }}
              transition={{ duration: 2.4, delay: 1.2, repeat: Infinity, ease: "easeOut" }}
            />

            {/* 3D Sphere */}
            <motion.div
              animate={{
                y: [-2.5, 2.5, -2.5],
                scale: [1, 1.03, 0.98, 1],
              }}
              transition={{
                duration: 3.6,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="rounded-full relative overflow-hidden cursor-pointer"
              style={{
                width: 70,
                height: 70,
                background:
                  "radial-gradient(circle at 35% 30%, #FFFFFF 0%, var(--claude-accent) 58%, var(--claude-accent-hover) 100%)",
                boxShadow:
                  "0 12px 28px -8px rgba(72,84,168,0.48), inset 0 -6px 14px rgba(0,0,0,0.25), inset 0 6px 12px rgba(255,255,255,0.85)",
              }}
            >
              {/* Specular Highlight Sheen */}
              <motion.div
                aria-hidden
                className="absolute rounded-full"
                animate={{
                  x: [-1, 2, -1],
                  y: [-1, 1, -1],
                  opacity: [0.88, 1, 0.88],
                }}
                transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
                style={{
                  width: "56%",
                  height: "56%",
                  top: "9%",
                  left: "11%",
                  background:
                    "radial-gradient(circle, rgba(255,255,255,0.95) 0%, transparent 68%)",
                  filter: "blur(3px)",
                }}
              />
            </motion.div>
          </div>

          {/* Animated Equalizer Waveform Bars */}
          <div className="flex items-center gap-1.25 h-4.5">
            {[
              { base: 6, min: 4, max: 16, dur: 0.9, delay: 0.0 },
              { base: 10, min: 6, max: 20, dur: 1.15, delay: 0.15 },
              { base: 13, min: 8, max: 24, dur: 0.85, delay: 0.3 },
              { base: 9, min: 5, max: 18, dur: 1.05, delay: 0.1 },
              { base: 10, min: 5, max: 17, dur: 0.95, delay: 0.25 },
            ].map((bar, i) => (
              <motion.span
                key={i}
                className="w-[3px] rounded-full"
                animate={{
                  height: [bar.base, bar.max, bar.min, bar.max * 0.8, bar.base],
                  backgroundColor: [
                    "var(--claude-border-strong)",
                    "var(--claude-accent)",
                    "var(--claude-accent)",
                    "var(--claude-border-strong)",
                  ],
                }}
                transition={{
                  duration: bar.dur,
                  delay: bar.delay,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                style={{ height: bar.base }}
              />
            ))}
          </div>

          <p
            className="text-[8.5px] font-mono tracking-wider uppercase tabular-nums flex items-center gap-1"
            style={{ color: "var(--claude-muted)" }}
          >
            <Sparkle size={9} weight="fill" className="text-[var(--claude-accent)] animate-spin" />
            Illustrative conversation preview
          </p>
        </div>

        {/* Live Conversation Transcript Box */}
        <div
          className="mx-2.5 mb-1.5 rounded-[12px] border overflow-hidden transition-all"
          style={{
            borderColor: "var(--claude-border)",
            background: "var(--claude-bg)",
          }}
        >
          {/* Citation Header */}
          <div
            className="px-2.5 py-1.5 flex items-center justify-between border-b"
            style={{
              borderColor: "var(--claude-border)",
              background: "var(--claude-surface-2)",
            }}
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={current.docName}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={{ duration: 0.25 }}
                className="text-[9.5px] font-semibold inline-flex items-center gap-1.5"
                style={{ color: "var(--claude-text)" }}
              >
                <FileText size={11} weight="regular" className="text-emerald-600" />
                {current.docName}
              </motion.span>
            </AnimatePresence>

            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded-full border bg-white tabular-nums shadow-2xs"
              style={{
                borderColor: "var(--claude-border)",
                color: "var(--claude-muted)",
              }}
            >
              {current.citation}
            </span>
          </div>

          {/* Conversation Bubbles */}
          <div className="p-2.5 sm:p-3 flex flex-col gap-2 min-h-[135px] justify-between">
            <AnimatePresence mode="wait">
              <div key={current.userText} className="flex flex-col gap-2">
                {/* User Message Bubble */}
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="self-end max-w-[84%] rounded-xl rounded-br-[4px] px-3 py-2 text-[12px] leading-snug shadow-xs"
                  style={{
                    background: "var(--claude-bubble)",
                    color: "#F5F3EB",
                  }}
                >
                  {current.userText}
                </motion.div>

                {/* Assistant Grounded Message Bubble */}
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{
                    duration: 0.4,
                    delay: 0.15,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="self-start max-w-[92%] rounded-xl rounded-bl-[4px] border px-3 py-2 text-[12px] leading-relaxed shadow-xs"
                  style={{
                    background: "var(--claude-surface)",
                    borderColor: "var(--claude-border)",
                    color: "var(--claude-text)",
                  }}
                >
                  {current.assistantText}
                  <span
                    className="inline-flex items-center justify-center ml-1 text-[9px] font-semibold px-1 py-0.5 rounded border align-baseline tabular-nums"
                    style={{
                      background: "var(--claude-accent-soft)",
                      borderColor: "var(--claude-border-strong)",
                      color: "var(--claude-accent)",
                    }}
                  >
                    {current.citation}
                  </span>
                </motion.div>
              </div>
            </AnimatePresence>

            {/* Grounding Verification Badge */}
            <div className="flex items-center gap-1.5 text-[9px] font-mono tabular-nums pt-1 border-t border-black/5">
              <motion.span
                key={`badge-${current.retrievalMs}`}
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold"
              >
                <CheckCircle size={10} weight="fill" className="text-emerald-600" />
                Example
              </motion.span>
              <span style={{ color: "var(--claude-muted)" }}>
                Sample conversation, not a live call
              </span>
            </div>
          </div>
        </div>

        {/* Carousel Scenario Switcher Dots */}
        <div className="flex items-center justify-center gap-1.25 pb-2">
          {SCENARIOS.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setScenarioIdx(i)}
              aria-label={`Preview scenario ${i + 1}`}
              className={`h-1.25 rounded-full transition-all duration-300 ${
                scenarioIdx === i
                  ? "w-4 bg-[var(--claude-accent)]"
                  : "w-1.25 bg-[var(--claude-border-strong)] opacity-60 hover:opacity-100"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
