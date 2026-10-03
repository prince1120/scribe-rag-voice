"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

let openDialogs = 0;
let previousOverflow = "";

/** Keep dialogs outside scrolling and transformed page ancestors. */
export function ModalPortal({ children, label, onClose }: {
  children: ReactNode; label: string; onClose?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    if (openDialogs++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    (root.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)") ?? root.current)?.focus();
    return () => {
      if (--openDialogs === 0) document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={root} className="app-modal-portal" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape" && onClose) { event.preventDefault(); onClose(); }
        if (event.key !== "Tab") return;
        const elements = Array.from(root.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0']") ?? [])
          .filter((element) => element.getClientRects().length > 0);
        const first = elements[0], last = elements.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) {
          event.preventDefault(); first.focus();
        }
      }}>{children}</div>, document.body,
  );
}
