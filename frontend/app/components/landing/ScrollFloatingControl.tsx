"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "@phosphor-icons/react";
import { motion, AnimatePresence, useScroll, useSpring } from "motion/react";

export function ScrollFloatingControl() {
  const [visible, setVisible] = useState(false);
  const [percent, setPercent] = useState(0);
  const { scrollY, scrollYProgress } = useScroll();

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 280,
    damping: 30,
    restDelta: 0.001,
  });

  useEffect(() => {
    const unsubY = scrollY.on("change", (latest) => {
      setVisible(latest > 350);
    });
    const unsubProgress = smoothProgress.on("change", (latest) => {
      setPercent(Math.min(100, Math.max(0, Math.round(latest * 100))));
    });
    return () => {
      unsubY();
      unsubProgress();
    };
  }, [scrollY, smoothProgress]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 16 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-6 right-6 z-40"
        >
          <button
            type="button"
            onClick={scrollToTop}
            aria-label="Scroll back to top"
            className="group relative flex items-center gap-2 px-3.5 py-2 rounded-full border shadow-[0_10px_28px_rgba(44,43,40,0.12),0_2px_8px_rgba(44,43,40,0.06)] backdrop-blur-md transition-all duration-300 hover:scale-105 active:scale-95"
            style={{
              background: "rgba(250, 249, 245, 0.92)",
              borderColor: "var(--claude-border-strong)",
              color: "var(--claude-text)",
            }}
          >
            {/* Circular SVG Mini Progress Ring */}
            <div className="relative w-5 h-5 flex items-center justify-center">
              <svg className="w-5 h-5 -rotate-90 transform" viewBox="0 0 36 36">
                <path
                  className="stroke-current opacity-15"
                  strokeWidth="3.5"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  style={{ color: "var(--claude-accent)" }}
                />
                <path
                  className="stroke-current transition-all duration-150"
                  strokeWidth="3.5"
                  strokeDasharray={`${percent}, 100`}
                  strokeLinecap="round"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  style={{ color: "var(--claude-accent)" }}
                />
              </svg>
              <ArrowUp
                size={10}
                weight="bold"
                className="absolute text-[var(--claude-accent)] transition-transform duration-300 group-hover:-translate-y-0.5"
              />
            </div>

            <span className="text-[11px] font-mono font-semibold tabular-nums text-[var(--claude-muted)] group-hover:text-[var(--claude-text)] transition-colors">
              {percent}%
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
