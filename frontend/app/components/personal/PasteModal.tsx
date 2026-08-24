"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface PasteModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (title: string, content: string) => Promise<boolean>;
}

export function PasteModal({ open, onClose, onSubmit }: PasteModalProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    const ok = await onSubmit(title.trim() || "Pasted text", content);
    setSubmitting(false);
    if (ok) {
      setTitle("");
      setContent("");
      onClose();
    }
  };

  const handleClose = () => {
    if (!submitting) onClose();
  };

  return (
    <>
      <div onClick={handleClose} className="fixed inset-0 z-40" style={{ background: "rgba(20, 20, 18, 0.35)" }} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-lg rounded-xl shadow-2xl flex flex-col"
          style={{ background: "var(--claude-bg)", border: "1px solid var(--claude-border)", maxHeight: "80vh" }}
        >
          <div className="h-14 px-5 flex items-center justify-between border-b flex-shrink-0" style={{ borderColor: "var(--claude-border)" }}>
            <span className="text-[14px] font-semibold" style={{ color: "var(--claude-text)" }}>Paste text as a source</span>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="w-8 h-8 rounded-md inline-flex items-center justify-center transition-colors"
              style={{ color: "var(--claude-muted)" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              className="w-full h-9 px-3 rounded-lg text-[13px] outline-none"
              style={{ background: "var(--claude-surface)", border: "1px solid var(--claude-border-strong)", color: "var(--claude-text)" }}
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste or type text content here…"
              rows={10}
              className="w-full px-3 py-2 rounded-lg text-[13px] leading-relaxed outline-none resize-none"
              style={{ background: "var(--claude-surface)", border: "1px solid var(--claude-border-strong)", color: "var(--claude-text)" }}
            />
          </div>
          <div className="px-5 py-3 border-t flex-shrink-0 flex justify-end gap-2" style={{ borderColor: "var(--claude-border)" }}>
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="h-9 px-4 rounded-lg text-[13px] font-medium transition-colors"
              style={{ background: "var(--claude-surface)", border: "1px solid var(--claude-border-strong)", color: "var(--claude-text-2)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !content.trim()}
              className="h-9 px-4 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-50"
              style={{ background: "var(--claude-accent)", color: "white" }}
            >
              {submitting ? "Adding…" : "Add as source"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
