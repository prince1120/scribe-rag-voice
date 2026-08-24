"use client";

import { BookOpen, Check, ClipboardPaste, FileText, Loader2, LogOut, Plus, Trash2, UploadCloud } from "lucide-react";
import { ScribeMark } from "../../Logo";
import type { PersonalDocument, PendingUpload } from "../../hooks/useDocuments";

interface DocumentsSidebarProps {
  sidebarRef: React.RefObject<HTMLElement | null>;
  sidebarOpen: boolean;
  documents: PersonalDocument[];
  pendingUploads: PendingUpload[];
  nowTick: number;
  uploading: boolean;
  uploadError: string | null;
  isDemoSession: boolean;
  tenantId: string;
  onNewChat: () => void;
  onUploadFiles: (files: FileList | File[]) => void;
  onPasteOpen: () => void;
  onDeleteDocument: (documentId: string) => void;
  onToggleDocument: (documentId: string) => void;
  onOpenDocument: (documentId: string) => void;
  onEndSession: () => void;
}

const DEMO_MAX_DOCUMENTS = 4;
const DEMO_TOP_K = 3;

export function DocumentsSidebar({
  sidebarRef,
  sidebarOpen,
  documents,
  pendingUploads,
  nowTick,
  uploading,
  uploadError,
  isDemoSession,
  tenantId,
  onNewChat,
  onUploadFiles,
  onPasteOpen,
  onDeleteDocument,
  onToggleDocument,
  onOpenDocument,
  onEndSession,
}: DocumentsSidebarProps) {
  return (
    <aside
      ref={sidebarRef}
      id="app-sidebar"
      aria-label="Documents and conversations"
      className={`w-80 max-w-[85vw] flex flex-col border-r fixed md:static inset-y-0 left-0 z-40 md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      style={{
        background: "var(--claude-sidebar)",
        borderColor: "var(--claude-border)",
        transition: "transform var(--duration-slow) var(--ease-decelerate)",
      }}
    >
      <div className="h-16 px-5 flex items-center gap-3 border-b" style={{ borderColor: "var(--claude-border)" }}>
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "linear-gradient(145deg, var(--claude-accent), var(--claude-accent-hover))" }}
        >
          <ScribeMark className="w-[18px] h-[18px] text-white" />
        </div>
        <div className="flex flex-col justify-center leading-tight">
          <h1 className="font-serif-display text-[19px] leading-tight tracking-tight" style={{ color: "var(--claude-text)" }}>
            Scribe
          </h1>
          <p className="text-[11px] leading-tight mt-0.5" style={{ color: "var(--claude-muted)" }}>
            Chat with your documents
          </p>
        </div>
      </div>

      <div className="px-4 pt-4">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-medium transition-colors"
          style={{ background: "var(--claude-accent)", color: "white" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--claude-accent-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--claude-accent)")}
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          New chat
        </button>
      </div>

      <div className="px-4 pt-3">
        <label
          className="flex flex-col items-center justify-center w-full py-5 border border-dashed rounded-xl cursor-pointer transition-colors"
          style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-surface)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--claude-accent-soft)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--claude-surface)")}
        >
          <UploadCloud className="w-5 h-5 mb-2" style={{ color: "var(--claude-accent)" }} />
          <p className="text-[13px] font-medium leading-none" style={{ color: "var(--claude-text-2)" }}>
            {uploading ? "Uploading…" : "Upload documents"}
          </p>
          <p className="text-[11px] mt-1.5 leading-none" style={{ color: "var(--claude-muted)" }}>
            PDF · DOCX · PPTX · TXT · CSV · XLSX · Images
          </p>
          <input
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.docx,.pptx,.txt,.md,.csv,.xlsx,.png,.jpg,.jpeg,.webp,.bmp,.tiff,.tif,.gif"
            onChange={(e) => {
              if (e.target.files) {
                onUploadFiles(e.target.files);
                e.target.value = "";
              }
            }}
            disabled={uploading}
          />
        </label>
        <button
          type="button"
          onClick={onPasteOpen}
          className="mt-2 w-full flex items-center justify-center gap-1.5 h-8 rounded-lg text-[12px] font-medium transition-colors"
          style={{ color: "var(--claude-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--claude-accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--claude-muted)")}
        >
          <ClipboardPaste className="w-3.5 h-3.5" />
          Paste text instead
        </button>
        {uploadError && (
          <p className="mt-2 text-[11px] leading-snug px-1" style={{ color: "var(--claude-danger, #d9534f)" }}>
            {uploadError}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-5 pb-4">
        {pendingUploads.length > 0 && (
          <div className="mb-4">
            <h3 className="text-[11px] uppercase tracking-[0.08em] font-semibold leading-none mb-2 px-1" style={{ color: "var(--claude-muted)" }}>
              Processing
            </h3>
            <div className="space-y-1.5">
              {pendingUploads.map((p) => {
                const elapsed = Math.floor((nowTick - p.startedAt) / 1000);
                const ext = p.filename.split(".").pop()?.toLowerCase() || "";
                const isLikelyOcr = ["pdf", "png", "jpg", "jpeg", "webp", "bmp", "tiff", "tif", "gif"].includes(ext);
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
                    style={{ background: "var(--claude-surface)", border: "1px solid var(--claude-border)" }}
                  >
                    <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: "var(--claude-accent-soft)" }}>
                      <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--claude-accent)" }} />
                    </div>
                    <div className="flex-1 min-w-0 leading-tight">
                      <p className="text-[13px] font-medium truncate leading-tight" style={{ color: "var(--claude-text-2)" }}>
                        {p.filename}
                      </p>
                      <p className="text-[11px] mt-0.5 leading-tight" style={{ color: "var(--claude-muted)" }}>
                        {isLikelyOcr ? "Running OCR · " : "Processing · "}
                        {elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] leading-snug mt-2 px-1" style={{ color: "var(--claude-muted)" }}>
              Scanned PDFs and images use AI OCR — usually a few seconds per page. Don&apos;t close the tab.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between mb-2.5 px-1">
          <h3 className="text-[11px] uppercase tracking-[0.08em] font-semibold leading-none" style={{ color: "var(--claude-muted)" }}>
            Sources
          </h3>
          <span
            className="text-[10px] font-medium leading-none px-1.5 h-[18px] inline-flex items-center rounded-full"
            style={{ background: "var(--claude-surface-2)", color: "var(--claude-muted)" }}
          >
            {documents.length}
          </span>
        </div>

        {documents.length === 0 && !uploading && (
          <div className="text-center py-8 px-4 rounded-xl border" style={{ background: "var(--claude-surface)", borderColor: "var(--claude-border)" }}>
            <BookOpen className="w-7 h-7 mx-auto mb-2" style={{ color: "var(--claude-border-strong)" }} />
            <p className="text-[12px] leading-snug" style={{ color: "var(--claude-muted)" }}>
              No documents yet.
              <br />
              Upload one to begin.
            </p>
          </div>
        )}

        <div className="space-y-1">
          {documents.map((doc) => {
            const included = doc.selected !== false;
            return (
              <div
                key={doc.document_id}
                className="group flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors"
                style={{ background: "transparent", opacity: included ? 1 : 0.55 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--claude-surface)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <button
                  type="button"
                  onClick={() => onToggleDocument(doc.document_id)}
                  aria-label={included ? "Exclude from chat" : "Include in chat"}
                  title={included ? "Included — click to exclude" : "Excluded — click to include"}
                  className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center flex-shrink-0 transition-colors"
                  style={{
                    background: included ? "var(--claude-accent)" : "transparent",
                    border: included ? "1px solid var(--claude-accent)" : "1.5px solid var(--claude-border-strong)",
                  }}
                >
                  {included && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </button>

                <button
                  type="button"
                  onClick={() => onOpenDocument(doc.document_id)}
                  title="Open document"
                  className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 transition-transform hover:scale-105"
                  style={{ background: "var(--claude-accent-soft)" }}
                >
                  <FileText className="w-4 h-4" style={{ color: "var(--claude-accent-hover)" }} />
                </button>

                <button type="button" onClick={() => onOpenDocument(doc.document_id)} className="flex-1 min-w-0 leading-tight text-left" title="Open document">
                  <p className="text-[13px] font-medium truncate leading-tight hover:underline" style={{ color: "var(--claude-text-2)" }}>
                    {doc.filename}
                  </p>
                  <p className="text-[11px] mt-0.5 leading-tight" style={{ color: "var(--claude-muted)" }}>
                    {doc.status} · {doc.chunk_count || 0} chunks
                  </p>
                </button>

                <button
                  onClick={() => onDeleteDocument(doc.document_id)}
                  className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: "var(--claude-muted)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#FEE2E2";
                    e.currentTarget.style.color = "#DC2626";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--claude-muted)";
                  }}
                  aria-label="Delete document"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="px-5 py-3 border-t text-[11px] flex items-center justify-between gap-2"
        style={{ borderColor: "var(--claude-border)", color: "var(--claude-muted)" }}
      >
        {isDemoSession ? (
          <>
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--claude-accent)" }} />
              <span className="truncate">Personal · {DEMO_MAX_DOCUMENTS} docs · top_k {DEMO_TOP_K}</span>
            </span>
            <button
              type="button"
              onClick={onEndSession}
              title="End this demo session — clears chat and returns to the key screen"
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md font-medium transition-colors"
              style={{ color: "var(--claude-muted)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#d9534f";
                e.currentTarget.style.background = "rgba(217, 83, 79, 0.1)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--claude-muted)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              <LogOut className="w-3 h-3" />
              End session
            </button>
          </>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--claude-muted)" }} />
            <span>Workspace</span>
          </span>
        )}
      </div>
    </aside>
  );
}
