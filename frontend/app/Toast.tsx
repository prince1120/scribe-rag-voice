"use client";

import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

export type ToastType = "error" | "success" | "info";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

const ACCENTS: Record<ToastType, { bar: string; icon: React.ReactNode }> = {
  error: { bar: "var(--color-danger)", icon: <AlertTriangle className="w-4 h-4" style={{ color: "var(--color-danger)" }} /> },
  success: { bar: "var(--color-success)", icon: <CheckCircle2 className="w-4 h-4" style={{ color: "var(--color-success)" }} /> },
  info: { bar: "var(--claude-accent)", icon: <Info className="w-4 h-4" style={{ color: "var(--claude-accent)" }} /> },
};

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  // Auto-dismiss. Errors linger a little longer so they're readable.
  useEffect(() => {
    const ms = toast.type === "error" ? 7000 : 4000;
    const t = setTimeout(() => onDismiss(toast.id), ms);
    return () => clearTimeout(t);
  }, [toast.id, toast.type, onDismiss]);

  const accent = ACCENTS[toast.type];

  return (
    <div
      role="status"
      className="voice-line-enter flex items-start gap-2.5 rounded-xl border shadow-lg px-3.5 py-3 pointer-events-auto"
      style={{
        background: "var(--claude-surface)",
        borderColor: "var(--claude-border)",
        borderLeft: `3px solid ${accent.bar}`,
      }}
    >
      <span className="mt-0.5 flex-shrink-0">{accent.icon}</span>
      <p className="text-[13px] leading-snug flex-1" style={{ color: "var(--claude-text-2)" }}>
        {toast.message}
      </p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="flex-shrink-0 -mr-1 -mt-0.5 w-6 h-6 inline-flex items-center justify-center rounded-md transition-colors"
        style={{ color: "var(--claude-muted)" }}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      className="fixed z-[60] flex flex-col gap-2 pointer-events-none
                 top-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-[360px]"
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
