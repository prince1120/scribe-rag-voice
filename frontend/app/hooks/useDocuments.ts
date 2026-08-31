"use client";

// useDocuments — the personal document library.
//
// Owns: the loaded list (with per-document selection for retrieval filtering),
// in-flight upload progress entries, the document editor modal's state, and
// every network call those need (through lib/api — no inline fetch here).
//
// Callers receive actions; they never mutate library state directly.

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, documents as documentsApi } from "../lib/api";
import { ToastType } from "../Toast";

export interface PersonalDocument {
  document_id: string;
  filename: string;
  status: string;
  chunk_count?: number;
  /** Unchecked sources are excluded from retrieval. Absent = included. */
  selected?: boolean;
}

export interface PendingUpload {
  id: string;
  filename: string;
  startedAt: number;
  sizeBytes: number;
}

export interface DocumentEditorState {
  documentId: string;
  filename: string;
  content: string;
  originalContent: string;
  editable: boolean;
  isImage: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

interface UseDocumentsOptions {
  creds: { groqKey: string; sarvamKey: string; clientId: string };
  /** Reload when these change (new session, new client id). */
  sessionId: string;
  enabled: boolean;
  notify: (message: string, type?: ToastType) => void;
}

export function useDocuments({ creds, sessionId, enabled, notify }: UseDocumentsOptions) {
  const [documents, setDocuments] = useState<PersonalDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [docEditor, setDocEditor] = useState<DocumentEditorState | null>(null);
  // Ticked once a second while uploads run so "Xs elapsed" labels stay live.
  const [nowTick, setNowTick] = useState(0);
  // Latest credentials, readable from stable callbacks without re-creating them.
  const credsRef = useRef(creds);
  useEffect(() => {
    credsRef.current = creds;
  }, [creds.groqKey, creds.sarvamKey, creds.clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore the previously uploaded document list on session load.
  useEffect(() => {
    if (!enabled || !sessionId) return;
    documentsApi
      .list(credsRef.current)
      .then((docs) =>
        setDocuments(
          Array.isArray(docs) && docs.length > 0
            ? docs.map((d) => ({ ...d, selected: true }))
            : []
        )
      )
      .catch(() => {
        /* backend unreachable or no documents yet — non-fatal */
      });
  }, [sessionId, enabled]);

  useEffect(() => {
    if (pendingUploads.length === 0) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pendingUploads.length]);

  const errorMessage = (error: unknown, fallback: string): string =>
    error instanceof ApiError ? error.message : fallback;

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      setUploading(true);
      for (const file of arr) {
        const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setPendingUploads((prev) => [
          ...prev,
          { id: uploadId, filename: file.name, sizeBytes: file.size, startedAt: Date.now() },
        ]);
        try {
          const result = await documentsApi.upload(file, credsRef.current);
          setDocuments((prev) => [...prev, { ...result, selected: true }]);
          setUploadError(null);
          notify(`"${file.name}" added`, "success");
        } catch (error) {
          console.error("Upload error:", error);
          const msg = errorMessage(error, "Upload failed");
          setUploadError(msg);
          notify(msg, "error");
        } finally {
          setPendingUploads((prev) => prev.filter((u) => u.id !== uploadId));
        }
      }
      setUploading(false);
    },
    [notify]
  );

  const addPastedText = useCallback(
    async (title: string, content: string): Promise<boolean> => {
      try {
        const result = await documentsApi.paste(title || "Pasted text", content, credsRef.current);
        setDocuments((prev) => [...prev, { ...result, selected: true }]);
        setUploadError(null);
        notify(`"${result.filename || title}" added`, "success");
        return true;
      } catch (error) {
        console.error("Paste error:", error);
        const msg = errorMessage(error, "Paste failed");
        setUploadError(msg);
        notify(msg, "error");
        return false;
      }
    },
    [notify]
  );

  const deleteDocument = useCallback(
    async (documentId: string) => {
      const doc = documents.find((d) => d.document_id === documentId);
      try {
        await documentsApi.remove(documentId, credsRef.current);
        setDocuments((prev) => prev.filter((d) => d.document_id !== documentId));
        notify(`"${doc?.filename || "Document"}" deleted`, "info");
      } catch (error) {
        console.error("Delete error:", error);
        notify(errorMessage(error, "Couldn't delete that document. Please try again."), "error");
      }
    },
    [documents, notify]
  );

  const toggleDocumentSelected = useCallback((documentId: string) => {
    setDocuments((prev) =>
      prev.map((d) =>
        d.document_id === documentId
          ? { ...d, selected: d.selected === false ? true : false }
          : d
      )
    );
  }, []);

  const openDocument = useCallback(
    async (documentId: string) => {
      setDocEditor({
        documentId,
        filename: "",
        content: "",
        originalContent: "",
        editable: false,
        isImage: false,
        loading: true,
        saving: false,
        error: null,
      });
      try {
        const data = await documentsApi.content(documentId, credsRef.current);
        setDocEditor({
          documentId,
          filename: data.filename,
          content: data.content,
          originalContent: data.content,
          editable: data.editable,
          isImage: data.is_image,
          loading: false,
          saving: false,
          error: null,
        });
      } catch (error) {
        console.error("Load document content error:", error);
        setDocEditor((prev) =>
          prev ? { ...prev, loading: false, error: "Failed to load document content" } : null
        );
        notify("Couldn't load that document's content.", "error");
      }
    },
    [notify]
  );

  const saveDocumentEditor = useCallback(async () => {
    if (!docEditor || docEditor.saving) return;
    setDocEditor((prev) => (prev ? { ...prev, saving: true, error: null } : null));
    try {
      const result = await documentsApi.saveContent(
        docEditor.documentId,
        docEditor.content,
        credsRef.current
      );
      setDocuments((prev) =>
        prev.map((d) =>
          d.document_id === docEditor.documentId ? { ...d, chunk_count: result.chunk_count } : d
        )
      );
      setDocEditor((prev) => (prev ? { ...prev, saving: false, originalContent: prev.content } : null));
      notify("Changes saved", "success");
    } catch (error) {
      console.error("Save document content error:", error);
      setDocEditor((prev) => (prev ? { ...prev, saving: false, error: "Failed to save — try again" } : null));
      notify("Couldn't save your changes. Please try again.", "error");
    }
  }, [docEditor, notify]);

  return {
    documents,
    uploading,
    uploadError,
    pendingUploads,
    nowTick,
    docEditor,
    setDocEditor,
    uploadFiles,
    addPastedText,
    deleteDocument,
    toggleDocumentSelected,
    openDocument,
    saveDocumentEditor,
    clearLibrary: () => setDocuments([]),
  };
}
