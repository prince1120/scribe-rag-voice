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
}

export function AgentDocuments({
  max = 3,
  onCountChange,
}: {
  max?: number;
  onCountChange?: (count: number) => void;
}) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await ownerFetch("/api/v1/documents");
      if (!response.ok) throw new Error();
      const data: Doc[] = await response.json();
      setDocs(data);
      onCountChange?.(data.length);
    } catch {
      setError("Could not load your documents.");
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

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
          const response = await ownerFetch("/api/v1/documents/upload", {
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

  async function remove(documentId: string, filename: string) {
    if (!window.confirm(`Remove ${filename} from your assistant?`)) return;
    try {
      await ownerFetch(`/api/v1/documents/${encodeURIComponent(documentId)}`, {
        method: "DELETE",
      });
      await load();
    } catch {
      setError("Could not remove that document.");
    }
  }

  const full = docs.length >= max;

  return (
    <section className="agent-section">
      <span className="agent-label">
        Documents <span className="agent-optional">{docs.length} of {max}</span>
      </span>
      <p className="agent-hint">
        What your assistant knows — an FAQ, price list, or policy sheet. Keep
        them short and specific; a few focused pages answer better than a
        manual.
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
        <ul className="agent-docs">
          {docs.map((doc) => (
            <li key={doc.document_id} className="agent-doc">
              <span className="agent-doc-name">{doc.filename}</span>
              <span className="agent-doc-meta">
                {doc.status === "processed"
                  ? `${doc.chunk_count} section${doc.chunk_count === 1 ? "" : "s"}`
                  : doc.status}
              </span>
              <button
                type="button"
                className="agent-doc-remove ds-pressable ds-tap"
                onClick={() => remove(doc.document_id, doc.filename)}
                aria-label={`Remove ${doc.filename}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
