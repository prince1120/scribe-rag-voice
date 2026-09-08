"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, MotionValue } from "motion/react";

interface WordProps {
  children: string;
  progress: MotionValue<number>;
  range: [number, number];
  isHighlight?: boolean;
}

function Word({ children, progress, range, isHighlight }: WordProps) {
  const opacity = useTransform(progress, range, [0.18, 1]);
  const y = useTransform(progress, range, [6, 0]);
  const scale = useTransform(progress, range, [0.97, 1]);

  if (isHighlight) {
    return (
      <span className="relative inline-block mx-[0.2em]">
        <motion.span
          style={{ opacity, y, scale }}
          className="inline-block font-semibold transition-colors duration-300"
        >
          <span
            style={{
              color: "var(--claude-accent)",
              textShadow: "0 0 24px rgba(72,84,168,0.22)",
            }}
          >
            {children}
          </span>
        </motion.span>
      </span>
    );
  }

  return (
    <motion.span
      style={{ opacity, y, scale }}
      className="inline-block mx-[0.16em] will-change-[opacity,transform]"
    >
      {children}
    </motion.span>
  );
}

interface ScrollTextRevealProps {
  paragraph: string;
  highlightPunchline?: string;
  className?: string;
}

export function ScrollTextReveal({
  paragraph,
  highlightPunchline,
  className = "",
}: ScrollTextRevealProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 0.88", "center 0.42"],
  });

  const words = paragraph.split(" ");
  const highlightWords = highlightPunchline ? highlightPunchline.split(" ") : [];
  const totalWords = words.length + highlightWords.length;

  return (
    <div ref={containerRef} className={`relative select-none ${className}`}>
      <p
        className="font-editorial text-[26px] sm:text-[34px] md:text-[42px] leading-[1.28] tracking-tight text-center max-w-4xl mx-auto flex flex-wrap justify-center items-center"
        style={{ color: "var(--claude-text)", textWrap: "balance" }}
      >
        {words.map((word, i) => {
          const start = i / totalWords;
          const end = start + 1 / totalWords;
          return (
            <Word key={`w-${i}`} progress={scrollYProgress} range={[start, end]}>
              {word}
            </Word>
          );
        })}

        {highlightWords.length > 0 && (
          <span className="w-full block mt-3.5 sm:mt-5 font-editorial font-bold text-[28px] sm:text-[38px] md:text-[46px] tracking-tight">
            {highlightWords.map((word, j) => {
              const start = (words.length + j) / totalWords;
              const end = start + 1 / totalWords;
              return (
                <Word
                  key={`hw-${j}`}
                  progress={scrollYProgress}
                  range={[start, end]}
                  isHighlight
                >
                  {word}
                </Word>
              );
            })}
          </span>
        )}
      </p>
    </div>
  );
}
