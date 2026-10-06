"use client";

import { useCallback, useEffect, useRef } from "react";

/** One cancellable startup/live call per screen, including before a room exists. */
export function useCallAttempt() {
  const current = useRef<AbortController | null>(null);
  const beginCall = useCallback(() => {
    if (current.current) return null;
    const attempt = new AbortController();
    current.current = attempt;
    return attempt;
  }, []);
  const cancelCall = useCallback(() => {
    current.current?.abort();
    current.current = null;
  }, []);
  const isCurrentCall = useCallback((attempt: AbortController) =>
    current.current === attempt && !attempt.signal.aborted, []);
  useEffect(() => cancelCall, [cancelCall]);
  return { beginCall, cancelCall, isCurrentCall };
}
