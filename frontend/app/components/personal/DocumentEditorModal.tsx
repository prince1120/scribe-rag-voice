"use client";

import { ExternalLink, Loader2, X } from "lucide-react";
import { API_BASE } from "../../lib/api";
import type { DocumentEditorState } from "../../hooks/useDocuments";

interface DocumentEditorModalProps {
  docEditor: DocumentEditorState | null;
  setDocEditor: React.Dispatch<React.SetStateAction<DocumentEditorState | null>>;
  onSave: () => void;
}

export function DocumentEditorModal({ docEditor, setDocEditor, onSave }: DocumentEditorModalProps) {
  if (!docEditor) return null;

  return (
    <>
      <div onClick={() => !docEditor.saving && setDocEditor(null)} className="fixed inset-0 z-40" style={{ background: "rgba(20, 20, 18, 0.35)" }} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-2xl rounded-xl shadow-2xl flex flex-col"
          style={{ background: "var(--claude-bg)", border: "1px solid var(--claude-border)", height: "80vh" }}
        >
          <div className="h-14 px-5 flex items-center justify-between border-b flex-shrink-0 gap-3" style={{ borderColor: "var(--claude-border)" }}>
            <span className="text-[14px] font-semibold truncate" style={{ color: "var(--claude-text)" }} title={docEditor.filename}>
              {docEditor.filename || "Loading…"}
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => window.open(`${API_BASE}/documents/${docEditor.documentId}/file`, "_blank")}
                title="Open original file (with original formatting)"
                className="h-8 px-3 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors"
                style={{ background: "var(--claude-surface)", border: "1px solid var(--claude-border-strong)", color: "var(--claude-text-2)" }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Original
              </button>
              <button
                type="button"
                onClick={() => !docEditor.saving && setDocEditor(null)}
                aria-label="Close"
                className="w-8 h-8 rounded-md inline-flex items-center justify-center transition-colors"
                style={{ color: "var(--claude-muted)" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col">
            {docEditor.loading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--claude-muted)" }} />
              </div>
            ) : docEditor.error && !docEditor.content ? (
              <div className="flex-1 flex items-center justify-center text-[13px]" style={{ color: "var(--claude-muted)" }}>
                {docEditor.error}
              </div>
            ) : docEditor.editable ? (
              <>
                {docEditor.isImage && (
                  <p className="text-[11px] mb-2" style={{ color: "var(--claude-muted)" }}>
                    This is the text detected in the image (used for search) — the image itself isn&apos;t edited here.
                  </p>
                )}
                <textarea
                  value={docEditor.content}
                  onChange={(e) => setDocEditor((prev) => (prev ? { ...prev, content: e.target.value } : null))}
                  className="flex-1 w-full px-3 py-2.5 rounded-lg text-[13px] leading-relaxed outline-none resize-none"
                  style={{
                    background: "var(--claude-surface)",
                    border: "1px solid var(--claude-border-strong)",
                    color: "var(--claude-text)",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                  spellCheck={false}
                />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center text-[13px] px-6" style={{ color: "var(--claude-muted)" }}>
                Editing isn&apos;t supported for this file type — use &quot;Original&quot; above to view it.
              </div>
            )}
          </div>

          {docEditor.editable && !docEditor.loading && (
            <div className="px-5 py-3 border-t flex-shrink-0 flex items-center justify-between gap-2" style={{ borderColor: "var(--claude-border)" }}>
              <span className="text-[11px]" style={{ color: "#DC2626" }}>
                {docEditor.error || ""}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDocEditor(null)}
                  disabled={docEditor.saving}
                  className="h-9 px-4 rounded-lg text-[13px] font-medium transition-colors"
                  style={{ background: "var(--claude-surface)", border: "1px solid var(--claude-border-strong)", color: "var(--claude-text-2)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={docEditor.saving || docEditor.content === docEditor.originalContent}
                  className="h-9 px-4 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-50"
                  style={{ background: "var(--claude-accent)", color: "white" }}
                >
                  {docEditor.saving ? "Saving & re-indexing…" : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
