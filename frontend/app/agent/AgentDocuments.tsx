"use client";

import { ownerFetch } from "../lib/ownerFetch";

// Documents for a business agent.
//
// Lives on the agent screen rather than behind a link to the personal app,
// because from the owner's point of view these are not a library — they are
// part of the assistant's configuration, alongside its prompt and its voice.
// Sending them elsewhere to manage them implied two different things.

import { useCallback, useEffect, useRef, useState } from "react";

interface Doc {
  document_id: string;
  filename: string;
  status: string;
  chunk_count: number;
  /** Whether the assistant may answer from this document. Enforced on the
   *  server — this checkbox reflects that state, it does not decide it. */
  agent_enabled: boolean;
}

export function AgentDocuments({
  max = 3,
  onCountChange,
  purpose = "rag",
}: {
  max?: number;
  onCountChange?: (count: number) => void;
  purpose?: "rag" | "agent";
}) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await ownerFetch(`/api/v1/documents?purpose=${purpose}`);
      if (!response.ok) throw new Error();
      const data: Doc[] = await response.json();
      setDocs(data);
      onCountChange?.(data.length);
    } catch {
      setError("Could not load your documents.");
    } finally {
      setLoading(false);
    }
  }, [onCountChange, purpose]);

  useEffect(() => { void load(); }, [load]);

  const upload = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;

      // Checked here as well as on the server so the owner is told before
      // waiting through an upload that was always going to be refused.
      if (docs.length >= max) {
        setError(`An assistant can use up to ${max} documents. Remove one first.`);
        return;
      }

      setUploading(true);
      setError("");
      try {
        for (const file of Array.from(files).slice(0, max - docs.length)) {
          const form = new FormData();
          form.append("file", file);
          const response = await ownerFetch(`/api/v1/documents/upload?purpose=${purpose}`, {
            method: "POST",
            body: form,
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body?.detail || `Could not add ${file.name}.`);
          }
        }
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add that file.");
      } finally {
        setUploading(false);
        // Cleared so re-picking the same file fires a change event again.
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [docs.length, max, load]
  );

  async function toggle(documentId: string, enabled: boolean) {
    // Optimistic: the checkbox responds immediately and is reverted if the
    // request fails. A round trip before the tick moves reads as a broken
    // control, and this is a setting people flip while comparing answers.
    setDocs((prev) =>
      prev.map((d) =>
        d.document_id === documentId ? { ...d, agent_enabled: enabled } : d
      )
    );
    setError("");
    try {
      const response = await ownerFetch(
        `/api/v1/documents/${encodeURIComponent(documentId)}/enabled`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        }
      );
      if (!response.ok) throw new Error();
    } catch {
      setDocs((prev) =>
        prev.map((d) =>
          d.document_id === documentId ? { ...d, agent_enabled: !enabled } : d
        )
      );
      setError("Could not change that document. Try again.");
    }
  }

  const [deleteDocTarget, setDeleteDocTarget] = useState<{ id: string; name: string } | null>(null);

  async function removeConfirmed() {
    if (!deleteDocTarget) return;
    try {
      await ownerFetch(`/api/v1/documents/${encodeURIComponent(deleteDocTarget.id)}`, {
        method: "DELETE",
      });
      setDeleteDocTarget(null);
      await load();
    } catch {
      setError("Could not remove that document.");
      setDeleteDocTarget(null);
    }
  }

  const full = docs.length >= max;

  const label = purpose === "agent" ? "Creation Documents" : "Knowledge Documents (RAG)";
  const hint = purpose === "agent"
    ? "Files used once to create this agent's prompt — not used for live RAG. Upload here to build new agent; editing RAG docs below won't affect creation."
    : "What your assistant knows live — FAQ, price list, policy. Keep short and specific. Untick to keep but leave out of answers.";
  return (
    <section className="agent-section">
      <span className="agent-label">
        {label} <span className="agent-optional">{docs.length} of {max}</span>
      </span>
      <p className="agent-hint">
        {hint}
      </p>

      {!full && (
        <div
          className={`agent-drop ${dragging ? "is-over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void upload(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter") inputRef.current?.click(); }}
        >
          <input
            ref={inputRef}
            type="file"
            className="agent-drop-input"
            onChange={(e) => void upload(e.target.files)}
            accept=".pdf,.docx,.pptx,.txt,.csv,.xlsx,.md,.png,.jpg,.jpeg"
            multiple
          />
          <span className="agent-drop-title">
            {uploading ? "Adding…" : "Add a document"}
          </span>
          <span className="agent-drop-hint">
            Drop a file here, or click to choose. PDF, DOCX, TXT, CSV, XLSX.
          </span>
        </div>
      )}

      {error && <p className="agent-error" role="alert">{error}</p>}

      {loading ? (
        <span className="ds-skeleton agent-doc-skeleton" />
      ) : docs.length === 0 ? (
        <p className="agent-hint">
          No documents yet. Your assistant will answer from its prompt alone.
        </p>
      ) : (
        <>
          <ul className="agent-docs">
            {docs.map((doc) => (
              <li
                key={doc.document_id}
                className={`agent-doc ${doc.agent_enabled ? "" : "is-off"}`}
              >
                <label className="agent-doc-toggle">
                  <input
                    type="checkbox"
                    checked={doc.agent_enabled}
                    onChange={(e) => void toggle(doc.document_id, e.target.checked)}
                    aria-label={`Use ${doc.filename} in answers`}
                  />
                  <span className="agent-doc-name">{doc.filename}</span>
                </label>
                <span className="agent-doc-meta">
                  {doc.status === "processed"
                    ? `${doc.chunk_count} section${doc.chunk_count === 1 ? "" : "s"}`
                    : doc.status}
                </span>
                <button
                  type="button"
                  className="agent-doc-remove ds-pressable ds-tap"
                  onClick={() => setDeleteDocTarget({ id: doc.document_id, name: doc.filename })}
                  aria-label={`Remove ${doc.filename}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {docs.every((d) => !d.agent_enabled) && (
            <p className="agent-hint">
              Every document is switched off, so your assistant will answer from
              its prompt alone.
            </p>
          )}

          {deleteDocTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
              <div className="bg-white rounded-2xl w-full max-w-xs p-5 border shadow-2xl flex flex-col gap-3">
                <h4 className="text-xs font-bold text-gray-900">Remove Document?</h4>
                <p className="text-[11px] text-gray-500">
                  Are you sure you want to remove <span className="font-semibold text-gray-800">{deleteDocTarget.name}</span> from your knowledge base?
                </p>
                <div className="flex items-center justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setDeleteDocTarget(null)}
                    className="h-8 px-3 rounded-lg border text-xs text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeConfirmed()}
                    className="h-8 px-3 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
