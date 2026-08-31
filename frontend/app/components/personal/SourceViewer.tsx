"use client";

import { ExternalLink, X } from "lucide-react";
import { API_BASE, type Citation } from "../../lib/api";

interface SourceViewerProps {
  viewingSource: { citation: Citation; label: string } | null;
  onClose: () => void;
}

export function SourceViewer({ viewingSource, onClose }: SourceViewerProps) {
  if (!viewingSource) return null;

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40" style={{ background: "rgba(20, 20, 18, 0.25)" }} />
      <aside
        className="fixed top-0 right-0 h-full w-full sm:w-[480px] z-50 flex flex-col shadow-2xl"
        style={{ background: "var(--claude-bg)", borderLeft: "1px solid var(--claude-border)" }}
      >
        <div className="h-16 px-5 flex items-center gap-3 border-b flex-shrink-0" style={{ borderColor: "var(--claude-border)" }}>
          <span
            className="text-[11px] font-bold min-w-[28px] h-6 inline-flex items-center justify-center rounded flex-shrink-0 px-1.5"
            style={{ background: "var(--claude-accent)", color: "white" }}
          >
            {viewingSource.label}
          </span>
          <div className="flex-1 min-w-0 leading-tight">
            <div className="text-[14px] font-semibold truncate" style={{ color: "var(--claude-text)" }} title={viewingSource.citation.filename}>
              {viewingSource.citation.filename}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: "var(--claude-muted)" }}>
              {viewingSource.citation.page_number ? `Page ${viewingSource.citation.page_number} · ` : ""}
              Relevance {(viewingSource.citation.score * 100).toFixed(0)}%
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-md inline-flex items-center justify-center transition-colors"
            style={{ color: "var(--claude-muted)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--claude-surface-2)";
              e.currentTarget.style.color = "var(--claude-text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--claude-muted)";
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="text-[11px] uppercase tracking-wider font-semibold mb-3" style={{ color: "var(--claude-muted)" }}>
            Excerpt used in answer
          </div>
          <div
            className="rounded-xl p-4 text-[14px] leading-[1.7] whitespace-pre-wrap break-words"
            style={{
              background: "var(--claude-surface)",
              border: "1px solid var(--claude-border)",
              color: "var(--claude-text-2)",
              borderLeft: "3px solid var(--claude-accent)",
            }}
          >
            {viewingSource.citation.content || viewingSource.citation.snippet || "(No excerpt available)"}
          </div>
          {viewingSource.citation.chunk_index !== undefined && (
            <div className="text-[11px] mt-3 px-1" style={{ color: "var(--claude-muted)" }}>
              Chunk #{viewingSource.citation.chunk_index + 1}
              {viewingSource.citation.page_number ? ` from page ${viewingSource.citation.page_number}` : ""}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex-shrink-0" style={{ borderColor: "var(--claude-border)" }}>
          <button
            type="button"
            onClick={() => window.open(`${API_BASE}/documents/${viewingSource.citation.document_id}/file`, "_blank")}
            className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[13px] font-medium transition-colors"
            style={{ background: "var(--claude-surface)", border: "1px solid var(--claude-border-strong)", color: "var(--claude-text-2)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--claude-accent-soft)";
              e.currentTarget.style.borderColor = "var(--claude-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--claude-surface)";
              e.currentTarget.style.borderColor = "var(--claude-border-strong)";
            }}
          >
            <ExternalLink className="w-4 h-4" />
            Open original document
          </button>
        </div>
      </aside>
    </>
  );
}
