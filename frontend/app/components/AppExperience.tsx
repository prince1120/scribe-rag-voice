"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Shared navigation feedback for every public and owner surface.
 * Next's route can change faster than a full loading screen mounts, so a thin
 * progress rail confirms the click immediately without delaying navigation.
 */
export function AppExperience() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"idle" | "loading" | "complete">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const finish = () => {
      if (phase === "idle") return;
      setPhase("complete");
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setPhase("idle"), 260);
    };
    finish();
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
    // `pathname` is the completion signal; `phase` must not restart this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const start = () => {
      setPhase("loading");
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
      safetyTimer.current = setTimeout(() => setPhase("idle"), 5000);
    };

    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return;

      const target = event.target as Element | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const next = new URL(anchor.href, window.location.href);
      if (next.origin !== window.location.origin) return;
      if (`${next.pathname}${next.search}` === `${location.pathname}${location.search}`) return;
      start();
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", start);
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
    };
  }, []);

  return (
    <div
      className={`route-progress ${phase === "loading" ? "is-loading" : ""} ${phase === "complete" ? "is-complete" : ""}`}
      aria-hidden="true"
    >
      <span />
    </div>
  );
}
