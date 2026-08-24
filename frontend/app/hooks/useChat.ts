"use client";

// useChat — conversation state and streaming submit.
//
// Responsibility: own the chat transcript for the personal app — messages,
// the in-flight assistant reply, conversation id, scroll state, image
// attachments, and the SSE submit that fills the reply.
//
// Design note (the perf fix): the in-flight reply is kept in a *separate*
// `streaming` state, not by mutating the last entry of `messages` on every
// tick. During a 30 ms typewriter interval only the single streaming bubble
// re-renders; completed rows (wrapped in React.memo on the view side) are not
// reconciled at all. The previous implementation called `setMessages` with a
// fresh array 33 times a second for a transcript of any length.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  conversations as conversationsApi,
  streamQuery,
  type Citation,
  type QueryMetrics,
} from "../lib/api";
import type { CustomModel } from "../lib/customModel";
import type { PersonalDocument } from "./useDocuments";
import { ToastType } from "../Toast";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  annotations?: Citation[];
  images?: string[];
  metrics?: QueryMetrics;
}

export interface StreamingState {
  id: string;
  /** Text currently painted (typewriter). */
  content: string;
  /** Full text accumulated from the stream. */
  full: string;
  citations?: Citation[];
  metrics?: QueryMetrics;
}

export interface ChatImage {
  id: string;
  name: string;
  dataUrl: string;
}

interface UseChatOptions {
  documents: PersonalDocument[];
  generation: { topK: number; temperature: number; maxTokens: number };
  model: { selectedModel: string; activeCustomModel: CustomModel | null };
  creds: { groqKey: string; sarvamKey: string; clientId: string };
  isDemoSession: boolean;
  notify: (message: string, type?: ToastType) => void;
}

let messageCounter = 0;
function newMessageId(): string {
  messageCounter += 1;
  return `msg-${Date.now()}-${messageCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function fileToResizedDataUrl(file: File, maxDim = 1280, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas 2D not supported"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function useChat(options: UseChatOptions) {
  const { documents, generation, model, creds, isDemoSession, notify } = options;

  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);

  // Scroll / timeline state (chat concern, not page layout).
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState("");
  const [viewingSource, setViewingSource] = useState<{ citation: Citation; label: string } | null>(null);

  // Image attachments for the next user turn.
  const [chatImages, setChatImages] = useState<ChatImage[]>([]);
  const [dragOverComposer, setDragOverComposer] = useState(false);
  const chatImageInputRef = useRef<HTMLInputElement>(null);

  // Refs so the async submit closure reads current values without recreating.
  const credsRef = useRef(creds);
  const documentsRef = useRef(documents);
  const generationRef = useRef(generation);
  const modelRef = useRef(model);
  const isDemoRef = useRef(isDemoSession);
  useEffect(() => {
    credsRef.current = creds;
  }, [creds.groqKey, creds.sarvamKey, creds.clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);
  useEffect(() => {
    generationRef.current = generation;
  }, [generation.topK, generation.temperature, generation.maxTokens]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    modelRef.current = model;
  }, [model.selectedModel, model.activeCustomModel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    isDemoRef.current = isDemoSession;
  }, [isDemoSession]);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ---- Conversation ----------------------------------------------------------

  const ensureConversationId = useCallback(async (): Promise<string> => {
    if (conversationId) return conversationId;
    try {
      const data = await conversationsApi.create(credsRef.current);
      const id = data.conversation_id || "";
      if (id) setConversationId(id);
      return id;
    } catch (error) {
      console.error("Create conversation error:", error);
      notify("Couldn't start a conversation — your history won't be saved this session.", "error");
      return "";
    }
  }, [conversationId, notify]);

  const startNewConversation = useCallback(() => {
    setConversationId("");
    setMessages([]);
    setStreaming(null);
    setInput("");
    setViewingSource(null);
    setActiveQuestionId("");
    setShowScrollBottom(false);
    // Reset scroll position so new chat starts at top and doesn't inherit "far from bottom"
    requestAnimationFrame(() => {
      const el = chatScrollRef.current;
      if (el) el.scrollTop = 0;
    });
  }, []);

  const openSource = useCallback((citation: Citation, label: string) => {
    setViewingSource({ citation, label });
  }, []);

  // ---- Image attachments -----------------------------------------------------

  const addChatImages = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) return;
    setChatImages((prev) => {
      const remaining = Math.max(0, 3 - prev.length);
      if (remaining === 0) return prev;
      // Process async but cap synchronously so rapid drops don't overshoot.
      const toProcess = arr.slice(0, remaining);
      void (async () => {
        for (const file of toProcess) {
          try {
            const dataUrl = await fileToResizedDataUrl(file);
            setChatImages((cur) => [
              ...cur,
              { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: file.name, dataUrl },
            ]);
          } catch (e) {
            console.error("Image attach failed:", e);
          }
        }
      })();
      return prev;
    });
  }, []);

  const removeChatImage = useCallback((id: string) => {
    setChatImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const onComposerDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverComposer(false);
      if (e.dataTransfer.files?.length) addChatImages(e.dataTransfer.files);
    },
    [addChatImages]
  );

  const onComposerPaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!e.clipboardData?.files?.length) return;
      const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
      if (imgs.length > 0) {
        e.preventDefault();
        addChatImages(imgs);
      }
    },
    [addChatImages]
  );

  // ---- Scroll ---------------------------------------------------------------

  const smartScrollToBottom = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (isNearBottom) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    smartScrollToBottom();
  }, [messages, smartScrollToBottom]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    // Never show jump on empty/hero state — nothing to scroll to
    if (messages.length === 0 && !streaming) {
      if (showScrollBottom) setShowScrollBottom(false);
      return;
    }
    const isFarFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight > 140;
    setShowScrollBottom(isFarFromBottom);

    const userMsgs = messages.filter((m) => m.role === "user");
    if (userMsgs.length === 0) return;
    const containerTop = el.getBoundingClientRect().top;
    let bestId = activeQuestionId || userMsgs[0].id;
    let minDistance = Infinity;
    for (const m of userMsgs) {
      const msgEl = document.getElementById(`msg-${m.id}`);
      if (!msgEl) continue;
      const rect = msgEl.getBoundingClientRect();
      const distance = Math.abs(rect.top - (containerTop + 40));
      if (rect.top <= containerTop + el.clientHeight * 0.75 && distance < minDistance) {
        minDistance = distance;
        bestId = m.id;
      }
    }
    if (bestId && bestId !== activeQuestionId) setActiveQuestionId(bestId);
  }, [messages, activeQuestionId, streaming, showScrollBottom]);

  // ---- Submit ---------------------------------------------------------------

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (isLoading) return;
      if (!input.trim() && chatImages.length === 0) return;

      const docs = documentsRef.current;
      const gen = generationRef.current;
      const mdl = modelRef.current;

      if (docs.length === 0 && chatImages.length === 0) return;
      const selectedCount = docs.filter((d) => d.selected !== false).length;
      if (docs.length > 0 && selectedCount === 0 && chatImages.length === 0) {
        notify("Select at least one source to search, or attach an image.", "info");
        return;
      }

      // Guard + paint BEFORE any await — so the UI never shows a gap where the
      // message appears to vanish and the user double-clicks.
      setIsLoading(true);

      const userImages = chatImages.length > 0 ? [...chatImages] : undefined;
      const userMessage: ChatMessage = {
        id: newMessageId(),
        role: "user",
        content: input,
        images: userImages?.map((i) => i.dataUrl),
      };
      const assistantId = newMessageId();

      setMessages((prev) => [...prev, userMessage]);
      setStreaming({ id: assistantId, content: "", full: "" });
      setInput("");
      setChatImages([]);
      setShowScrollBottom(false);

      const convId = await ensureConversationId();

      setTimeout(() => {
        if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }, 10);

      const includedIds = docs.filter((d) => d.selected !== false).map((d) => d.document_id);

      // Local accumulators — the stream handlers and the drain loop share these
      // without needing refs/closures over React state.
      let rawAccumulated = "";
      let citations: Citation[] | undefined;
      let metrics: QueryMetrics | undefined;

      // Typewriter: advance displayed content toward the full text.
      // Only `streaming` is written, so completed rows do not re-render.
      const intervalId = window.setInterval(() => {
        setStreaming((prev) => {
          if (!prev || prev.content.length >= prev.full.length) return prev;
          const diff = prev.full.length - prev.content.length;
          const step = Math.max(1, Math.min(diff, Math.ceil(diff / 3)));
          return { ...prev, content: prev.full.slice(0, prev.content.length + step) };
        });
      }, 30);

      try {
        await streamQuery(
          {
            query: userMessage.content,
            conversationId: convId || undefined,
            documentIds: includedIds.length > 0 ? includedIds : null,
            model: mdl.activeCustomModel ? mdl.activeCustomModel.model : mdl.selectedModel,
            temperature: gen.temperature,
            topK: isDemoRef.current ? 3 : gen.topK,
            maxTokens: gen.maxTokens,
            attachedImages: userImages ? userImages.map((i) => i.dataUrl) : null,
            creds: {
              ...credsRef.current,
              ...(mdl.activeCustomModel
                ? { customLlmBaseUrl: mdl.activeCustomModel.baseUrl, customLlmKey: mdl.activeCustomModel.apiKey }
                : {}),
            },
          },
          {
            onToken: (text) => {
              rawAccumulated += text;
              setStreaming((prev) => (prev ? { ...prev, full: rawAccumulated } : prev));
            },
            onCitations: (c) => {
              citations = c;
              setStreaming((prev) => (prev ? { ...prev, citations: c } : prev));
            },
            onMetrics: (m) => {
              metrics = m;
              setStreaming((prev) => (prev ? { ...prev, metrics: m } : prev));
            },
            onError: (message) => notify(message, "error"),
          }
        );

        // Drain the typewriter before committing the final message.
        await new Promise<void>((resolve) => {
          const check = window.setInterval(() => {
            let done = false;
            setStreaming((prev) => {
              if (!prev || prev.content.length >= prev.full.length) done = true;
              return prev;
            });
            if (done) {
              window.clearInterval(check);
              resolve();
            }
          }, 20);
          // Safety: never wait more than 3 s for the drain.
          window.setTimeout(() => {
            window.clearInterval(check);
            resolve();
          }, 3000);
        });
        window.clearInterval(intervalId);

        const finalText = rawAccumulated;
        const finalCitations = citations;
        const finalMetrics = metrics;

        setStreaming(null);
        if (finalText || (finalCitations && finalCitations.length > 0)) {
          setMessages((prev) => [
            ...prev,
            {
              id: assistantId,
              role: "assistant",
              content: finalText,
              ...(finalCitations && finalCitations.length > 0 ? { annotations: finalCitations } : {}),
              ...(finalMetrics ? { metrics: finalMetrics } : {}),
            },
          ]);
        }
      } catch (error) {
        window.clearInterval(intervalId);
        console.error("Query error:", error);
        const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Something went wrong";
        notify(msg, "error");
        setStreaming((prev) => {
          // Nothing streamed — drop the placeholder entirely.
          if (!prev || !prev.content) return null;
          // Partial reply streamed before the failure — commit it so the user
          // still sees what arrived.
          const partial: ChatMessage = {
            id: assistantId,
            role: "assistant",
            content: prev.full || prev.content,
            ...(prev.citations ? { annotations: prev.citations } : {}),
            ...(prev.metrics ? { metrics: prev.metrics } : {}),
          };
          setMessages((msgs) => [...msgs, partial]);
          return null;
        });
      } finally {
        setIsLoading(false);
      }
    },
    [input, chatImages, isLoading, ensureConversationId, notify]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit]
  );

  return {
    // state
    conversationId,
    setConversationId,
    messages,
    setMessages,
    input,
    setInput,
    isLoading,
    streaming,
    showScrollBottom,
    setShowScrollBottom,
    activeQuestionId,
    setActiveQuestionId,
    viewingSource,
    setViewingSource,
    chatImages,
    dragOverComposer,
    setDragOverComposer,
    // refs
    chatScrollRef,
    messagesEndRef,
    textareaRef,
    chatImageInputRef,
    // actions
    handleSubmit,
    startNewConversation,
    openSource,
    addChatImages,
    removeChatImage,
    onComposerDrop,
    onComposerPaste,
    handleChatScroll,
    smartScrollToBottom,
    onKeyDown,
  };
}
