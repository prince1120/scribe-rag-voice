"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  UploadCloud,
  FileText,
  Trash2,
  Plus,
  Send,
  BookOpen,
  Loader2,
  Check,
  ExternalLink,
  X,
  Paperclip,
  Image as ImageIcon,
  ClipboardPaste,
  Settings,
  LogOut,
  Phone,
  Menu,
  Copy,
  KeyRound,
  SlidersHorizontal,
  RefreshCw,
  RotateCcw,
  Cpu,
  Sparkles,
  ArrowDown,
  ListFilter,
  ChevronDown,
  Bookmark,
} from "lucide-react";
import { VoiceCallModal } from "./VoiceCall";
import { ScribeMark } from "./Logo";
import { ToastStack, type ToastItem, type ToastType } from "./Toast";

// Relative path — Next.js rewrites (next.config.ts) proxies /api/* to the
// FastAPI backend. This way the browser only talks to the page's own origin,
// which makes ngrok / Vercel / any public deployment work without touching code.
import { Message as ChatMessageView } from "./components/chat/Message";
import { useDrawer } from "./components/useDrawer";

const API_BASE = "/api/v1";
// Mirrors backend DEMO_MAX_DOCUMENTS / DEMO_TOP_K (app/config.py) — display
// only, the backend is the source of truth and enforces these regardless.
const DEMO_MAX_DOCUMENTS = 4;
const DEMO_TOP_K = 3;

// FastAPI error responses are JSON `{"detail": "..."}` — fall back to raw
// text if parsing fails so we never show the user "[object Object]".
async function extractErrorDetail(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.detail === "string") return parsed.detail;
  } catch {
    /* not JSON — fall through to raw text */
  }
  return text || `HTTP ${response.status}`;
}

interface Document {
  document_id: string;
  filename: string;
  status: string;
  chunk_count?: number;
  selected?: boolean;
}

interface Citation {
  document_id: string;
  filename: string;
  chunk_id: string;
  page_number?: number;
  chunk_index?: number;
  score: number;
  snippet: string;            // short preview (≤240 chars) shown on source cards
  content?: string;           // full chunk text shown in the side panel
  display_number?: string;    // hierarchical id like "1.1", "1.2", "2.1"
}

interface QueryMetrics {
  retrieval_ms: number;
  ttft_ms: number;
  total_ms: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  annotations?: Citation[];
  images?: string[]; // data URLs of any images attached by the user with this message
  metrics?: QueryMetrics;
}

interface KeyPair {
  groqKey: string;
  sarvamKey: string;
}

// A user-added OpenAI-compatible model — any provider that speaks the
// OpenAI chat-completions protocol (Mistral, OpenRouter, a self-hosted
// server, ...). Stored in localStorage only; the API key never touches our
// own server config, it's sent per-request the same way the Groq/Sarvam
// demo keys already are.
interface CustomModel {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

const CUSTOM_MODEL_PREFIX = "custom:";

let messageCounter = 0;
function newMessageId(): string {
  messageCounter += 1;
  return `msg-${Date.now()}-${messageCounter}-${Math.random().toString(36).slice(2, 8)}`;
}


export default function Home() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [pasting, setPasting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keySwitcherOpen, setKeySwitcherOpen] = useState(false);
  const [newKeyInput, setNewKeyInput] = useState("");
  const [voiceCallOpen, setVoiceCallOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const sidebarRef = useRef<HTMLElement>(null);
  // Null until the workspace answers. The personal app must not render before
  // then: a business owner would see a document library appear and vanish,
  // which reads as the app being confused about what it is.
  const [workspaceResolved, setWorkspaceResolved] = useState<boolean | null>(null);

  const handleOpenVoiceCall = useCallback(() => {
    setVoiceCallOpen(true);
    try {
      sessionStorage.setItem("voice_call_open", "true");
      const url = new URL(window.location.href);
      url.searchParams.set("voice", "true");
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* ignore */
    }
  }, []);

  const handleCloseVoiceCall = useCallback(() => {
    setVoiceCallOpen(false);
    try {
      sessionStorage.removeItem("voice_call_open");
      const url = new URL(window.location.href);
      url.searchParams.delete("voice");
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* ignore */
    }
  }, []);

  // Toast notifications (errors: bad key, service down, etc.)
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const notify = useCallback((message: string, type: ToastType = "error") => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Set defaults initially to avoid hydration mismatch (SSR-compatible).
  // Settings and Groq Key are loaded from localStorage after mounting.
  const [topK, setTopK] = useState(5);
  const [temperature, setTemperature] = useState(0.1);
  const [maxTokens, setMaxTokens] = useState(800);

  const [groqKey, setGroqKey] = useState<string>("");
  const [groqKeyInput, setGroqKeyInput] = useState("");
  const [sarvamKey, setSarvamKey] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("openai/gpt-oss-20b");
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [addingCustomModel, setAddingCustomModel] = useState(false);
  const [customModelForm, setCustomModelForm] = useState({ label: "", baseUrl: "", apiKey: "", model: "" });
  const [sarvamKeyInput, setSarvamKeyInput] = useState("");
  const [sarvamSwitcherOpen, setSarvamSwitcherOpen] = useState(false);
  const [newSarvamKeyInput, setNewSarvamKeyInput] = useState("");
  const [keyHistory, setKeyHistory] = useState<KeyPair[]>([]);
  const isDemoSession = Boolean(groqKey);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("rag_settings");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.topK === "number") setTopK(parsed.topK);
        if (typeof parsed.temperature === "number") setTemperature(parsed.temperature);
        if (typeof parsed.maxTokens === "number") setMaxTokens(parsed.maxTokens);
      }
    } catch {
      /* ignore */
    }

    try {
      const raw = localStorage.getItem("demo_session_key_history");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setKeyHistory(parsed.filter((item) => typeof item?.groqKey === "string" && typeof item?.sarvamKey === "string"));
        }
      } else {
        const legacyRaw = localStorage.getItem("demo_groq_key_history");
        if (legacyRaw) {
          const parsed = JSON.parse(legacyRaw);
          if (Array.isArray(parsed)) {
            const items = parsed
              .filter((k) => typeof k === "string")
              .map((k) => ({ groqKey: k, sarvamKey: "" }));
            setKeyHistory(items);
          }
        }
      }
    } catch {
      /* ignore */
    }

    try {
      const savedKey = localStorage.getItem("demo_groq_key");
      if (savedKey) setGroqKey(savedKey);
    } catch {
      /* ignore */
    }

    try {
      const savedSarvamKey = localStorage.getItem("demo_sarvam_key");
      if (savedSarvamKey) {
        setSarvamKey(savedSarvamKey);
        setSarvamKeyInput(savedSarvamKey);
      }
    } catch {
      /* ignore */
    }

    try {
      const savedModel = localStorage.getItem("demo_selected_model");
      if (savedModel) setSelectedModel(savedModel);
    } catch {
      /* ignore */
    }

    try {
      const savedCustom = localStorage.getItem("custom_models");
      if (savedCustom) {
        const parsed = JSON.parse(savedCustom);
        if (Array.isArray(parsed)) setCustomModels(parsed);
      }
    } catch {
      /* ignore */
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const isVoiceParam = params.get("voice") === "true";
      const isVoiceSaved = sessionStorage.getItem("voice_call_open") === "true";
      if (isVoiceParam || isVoiceSaved) {
        setVoiceCallOpen(true);
      }
    } catch {
      /* ignore */
    }

    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(
      "rag_settings",
      JSON.stringify({ topK, temperature, maxTokens })
    );
  }, [topK, temperature, maxTokens, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("demo_selected_model", selectedModel);
  }, [selectedModel, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("custom_models", JSON.stringify(customModels));
  }, [customModels, mounted]);

  const activeCustomModel = customModels.find((m) => `${CUSTOM_MODEL_PREFIX}${m.id}` === selectedModel);

  const addCustomModel = () => {
    const label = customModelForm.label.trim();
    const baseUrl = customModelForm.baseUrl.trim();
    const apiKey = customModelForm.apiKey.trim();
    const model = customModelForm.model.trim();
    if (!label || !baseUrl || !apiKey || !model) {
      notify("Fill in all four fields to add a model.", "error");
      return;
    }
    const id = Date.now().toString(36);
    setCustomModels((prev) => [...prev, { id, label, baseUrl, apiKey, model }]);
    setSelectedModel(`${CUSTOM_MODEL_PREFIX}${id}`);
    setCustomModelForm({ label: "", baseUrl: "", apiKey: "", model: "" });
    setAddingCustomModel(false);
    notify(`Added "${label}" — now selected.`, "info");
  };

  const removeCustomModel = (id: string) => {
    setCustomModels((prev) => prev.filter((m) => m.id !== id));
    if (selectedModel === `${CUSTOM_MODEL_PREFIX}${id}`) {
      setSelectedModel("openai/gpt-oss-20b");
    }
  };

  const [docEditor, setDocEditor] = useState<{
    documentId: string;
    filename: string;
    content: string;
    originalContent: string;
    editable: boolean;
    isImage: boolean;
    loading: boolean;
    saving: boolean;
    error: string | null;
  } | null>(null);
  const [pendingUploads, setPendingUploads] = useState<
    { id: string; filename: string; startedAt: number; sizeBytes: number }[]
  >([]);
  const [nowTick, setNowTick] = useState(() => Date.now()); // updated every second so elapsed-time labels stay live

  // Images attached to the next chat message (data URLs)
  const [chatImages, setChatImages] = useState<
    { id: string; name: string; dataUrl: string }[]
  >([]);
  const [dragOverComposer, setDragOverComposer] = useState(false);
  const chatImageInputRef = useRef<HTMLInputElement>(null);
  const [tenantId] = useState("default");

  // Demo session: visitors paste their own Groq API key so their chat usage
  // is billed to them, not us. Sent as X-User-Groq-Key on every request;
  // the backend derives an isolated tenant from it and caps documents/top_k.
  // Persisted in localStorage only — never touches our own server config.
  const MAX_KEY_HISTORY = 5;
  const [clientId, setClientId] = useState<string>("");

  useEffect(() => {
    if (!mounted) return;
    let storedId = localStorage.getItem("app_client_id");
    if (!storedId) {
      storedId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem("app_client_id", storedId);
    }
    setClientId(storedId);
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !clientId) return;
    try {
      const raw = localStorage.getItem(`demo_session_key_history_${clientId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setKeyHistory(parsed.filter((item) => typeof item?.groqKey === "string" && typeof item?.sarvamKey === "string"));
        }
      }
    } catch {
      /* ignore */
    }
  }, [clientId, mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (groqKey) localStorage.setItem("demo_groq_key", groqKey);
    else localStorage.removeItem("demo_groq_key");
  }, [groqKey, mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (sarvamKey) localStorage.setItem("demo_sarvam_key", sarvamKey);
    else localStorage.removeItem("demo_sarvam_key");
  }, [sarvamKey, mounted]);

  const maskKey = (key: string): string => {
    if (key.length <= 12) return `${key.slice(0, 3)}…`;
    return `${key.slice(0, 7)}…${key.slice(-4)}`;
  };

  // Start (or resume) a session with this key, remembering it — most
  // recently used first, deduped, capped — so it's a one-click pick next visit.
  const startSession = (key: string, sKey?: string) => {
    const trimmedGroq = key.trim();
    const trimmedSarvam = sKey ? sKey.trim() : sarvamKey.trim();
    if (!trimmedGroq || !trimmedSarvam) {
      notify("Both Groq API Key and Sarvam API Key are required to start a session.", "error");
      return;
    }

    setGroqKey(trimmedGroq);
    setGroqKeyInput("");

    setSarvamKey(trimmedSarvam);
    setSarvamKeyInput(trimmedSarvam);

    const currentSarvam = trimmedSarvam;

    setKeyHistory((prev) => {
      const filtered = prev.filter((item) => item.groqKey !== trimmedGroq);
      const next = [{ groqKey: trimmedGroq, sarvamKey: currentSarvam }, ...filtered].slice(0, MAX_KEY_HISTORY);
      if (typeof window !== "undefined") {
        const storageKey = clientId ? `demo_session_key_history_${clientId}` : "demo_session_key_history";
        localStorage.setItem(storageKey, JSON.stringify(next));
      }
      return next;
    });
  };

  const selectRecentPair = (pair: KeyPair) => {
    setGroqKeyInput(pair.groqKey);
    setSarvamKeyInput(pair.sarvamKey);
  };

  const forgetPair = (groqKeyStr: string) => {
    setKeyHistory((prev) => {
      const next = prev.filter((item) => item.groqKey !== groqKeyStr);
      if (typeof window !== "undefined") {
        const storageKey = clientId ? `demo_session_key_history_${clientId}` : "demo_session_key_history";
        localStorage.setItem(storageKey, JSON.stringify(next));
      }
      return next;
    });
  };

  // End the active session but keep the key in history — clearing history
  // is a separate, explicit action so ending a session doesn't lose it.
  const endSession = () => {
    setGroqKey("");
    setSarvamKey("");
    setDocuments([]);
    setMessages([]);
    setConversationId("");
  };

  // Switch to a different key mid-session (from Settings) without dropping
  // back to the full gate screen.
  const switchKey = (newKey: string) => {
    const trimmed = newKey.trim();
    if (!trimmed || trimmed === groqKey) return;
    if (!sarvamKey.trim()) {
      notify("Both Groq API Key and Sarvam API Key are required.", "error");
      return;
    }
    setMessages([]);
    setConversationId("");
    setViewingSource(null);
    startSession(trimmed, sarvamKey);
    notify("Switched keys — starting a fresh session.", "info");
  };

  const switchPair = (pair: KeyPair) => {
    if (!pair.groqKey || !pair.sarvamKey) {
      notify("Both Groq API Key and Sarvam API Key are required.", "error");
      return;
    }
    setMessages([]);
    setConversationId("");
    setViewingSource(null);
    startSession(pair.groqKey, pair.sarvamKey);
    notify("Switched key pairs — starting a fresh session.", "info");
  };

  const demoHeaders: Record<string, string> = {
    ...(groqKey ? { "X-User-Groq-Key": groqKey } : {}),
    ...(sarvamKey ? { "X-User-Sarvam-Key": sarvamKey } : {}),
    ...(clientId ? { "X-Client-Id": clientId } : {}),
  };

  const [conversationId, setConversationId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [questionIndexOpen, setQuestionIndexOpen] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState<string>("");
  const [timelineRailOpen, setTimelineRailOpen] = useState<boolean>(false);
  const [viewingSource, setViewingSource] = useState<{
    citation: Citation;
    label: string; // hierarchical id like "1.1", or fallback "1"
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const openSource = (citation: Citation, label: string) => {
    setViewingSource({ citation, label });
  };

  // ---- Chat image attachments -----------------------------------------

  const fileToResizedDataUrl = (
    file: File,
    maxDim = 1280,
    quality = 0.85
  ): Promise<string> =>
    new Promise((resolve, reject) => {
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

  const addChatImages = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) return;
    const remaining = Math.max(0, 3 - chatImages.length);
    if (remaining === 0) return;
    const toProcess = arr.slice(0, remaining);
    for (const file of toProcess) {
      try {
        const dataUrl = await fileToResizedDataUrl(file);
        setChatImages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            dataUrl,
          },
        ]);
      } catch (e) {
        console.error("Image attach failed:", e);
      }
    }
  };

  const removeChatImage = (id: string) => {
    setChatImages((prev) => prev.filter((i) => i.id !== id));
  };

  const onComposerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverComposer(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addChatImages(e.dataTransfer.files);
    }
  };

  const onComposerPaste = (e: React.ClipboardEvent) => {
    if (!e.clipboardData?.files || e.clipboardData.files.length === 0) return;
    const imgs = Array.from(e.clipboardData.files).filter((f) =>
      f.type.startsWith("image/")
    );
    if (imgs.length > 0) {
      e.preventDefault();
      addChatImages(imgs);
    }
  };

  const handleChatScroll = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    const isFarFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight > 140;
    setShowScrollBottom(isFarFromBottom);

    const userMsgs = messages.filter((m) => m.role === "user");
    if (userMsgs.length > 0) {
      const containerTop = el.getBoundingClientRect().top;
      let bestId = activeQuestionId || userMsgs[0].id;
      let minDistance = Infinity;

      for (const m of userMsgs) {
        const msgEl = document.getElementById(`msg-${m.id}`);
        if (msgEl) {
          const rect = msgEl.getBoundingClientRect();
          const distance = Math.abs(rect.top - (containerTop + 40));
          if (rect.top <= containerTop + el.clientHeight * 0.75 && distance < minDistance) {
            minDistance = distance;
            bestId = m.id;
          }
        }
      }
      if (bestId && bestId !== activeQuestionId) {
        setActiveQuestionId(bestId);
      }
    }
  };

  const smartScrollToBottom = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    smartScrollToBottom();
  }, [messages, smartScrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  // Tick every second so the "Xs elapsed" labels stay live while uploads run
  useEffect(() => {
    if (pendingUploads.length === 0) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pendingUploads.length]);

  // Restore the previously uploaded document list on load/refresh — the
  // backend now persists document metadata, so this no longer disappears.
  useEffect(() => {
    if (!mounted) return;
    fetch(`${API_BASE}/documents?tenant_id=${tenantId}`, { headers: demoHeaders })
      .then((res) => (res.ok ? res.json() : []))
      .then((docs: Document[]) => {
        setDocuments(
          Array.isArray(docs) && docs.length > 0
            ? docs.map((d) => ({ ...d, selected: true }))
            : []
        );
      })
      .catch(() => {
        /* backend unreachable or no documents yet — non-fatal */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groqKey, sarvamKey, clientId, mounted]);

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    for (const file of Array.from(files)) {
      const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPendingUploads((prev) => [
        ...prev,
        {
          id: uploadId,
          filename: file.name,
          sizeBytes: file.size,
          startedAt: Date.now(),
        },
      ]);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("tenant_id", tenantId);

      try {
        const response = await fetch(`${API_BASE}/documents/upload`, {
          method: "POST",
          headers: demoHeaders,
          body: formData,
        });
        if (!response.ok) {
          throw new Error(await extractErrorDetail(response));
        }
        const result = await response.json();
        setDocuments((prev) => [...prev, { ...result, selected: true }]);
        setUploadError(null);
        notify(`"${file.name}" added`, "success");
      } catch (error) {
        console.error("Upload error:", error);
        const msg = error instanceof Error ? error.message : "Upload failed";
        setUploadError(msg);
        notify(msg, "error");
      } finally {
        setPendingUploads((prev) => prev.filter((u) => u.id !== uploadId));
      }
    }
    setUploading(false);
  };

  const handlePasteSubmit = async () => {
    if (!pasteContent.trim() || pasting) return;
    setPasting(true);
    try {
      const response = await fetch(`${API_BASE}/documents/paste`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...demoHeaders },
        body: JSON.stringify({
          title: pasteTitle.trim() || "Pasted text",
          content: pasteContent,
          tenant_id: tenantId,
        }),
      });
      if (!response.ok) {
        throw new Error(await extractErrorDetail(response));
      }
      const result = await response.json();
      setDocuments((prev) => [...prev, { ...result, selected: true }]);
      setPasteModalOpen(false);
      setPasteTitle("");
      setPasteContent("");
      setUploadError(null);
      notify(`"${result.filename || pasteTitle.trim() || "Pasted text"}" added`, "success");
    } catch (error) {
      console.error("Paste error:", error);
      const msg = error instanceof Error ? error.message : "Paste failed";
      setUploadError(msg);
      notify(msg, "error");
    } finally {
      setPasting(false);
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    const doc = documents.find((d) => d.document_id === documentId);
    try {
      const response = await fetch(
        `${API_BASE}/documents/${documentId}?tenant_id=${tenantId}`,
        { method: "DELETE", headers: demoHeaders }
      );
      if (!response.ok) throw new Error(await extractErrorDetail(response));
      setDocuments((prev) =>
        prev.filter((doc) => doc.document_id !== documentId)
      );
      notify(`"${doc?.filename || "Document"}" deleted`, "info");
    } catch (error) {
      console.error("Delete error:", error);
      notify("Couldn't delete that document. Please try again.", "error");
    }
  };

  const toggleDocumentSelected = (documentId: string) => {
    setDocuments((prev) =>
      prev.map((d) =>
        d.document_id === documentId
          ? { ...d, selected: d.selected === false ? true : false }
          : d
      )
    );
  };

  const openDocument = async (documentId: string) => {
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
      const response = await fetch(
        `${API_BASE}/documents/${documentId}/content?tenant_id=${tenantId}`,
        { headers: demoHeaders }
      );
      if (!response.ok) throw new Error(await extractErrorDetail(response));
      const data = await response.json();
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
      setDocEditor((prev) =>
        prev ? { ...prev, loading: false, error: "Failed to load document content" } : null
      );
      console.error("Load document content error:", error);
      notify("Couldn't load that document's content.", "error");
    }
  };

  const saveDocumentEditor = async () => {
    if (!docEditor || docEditor.saving) return;
    setDocEditor((prev) => (prev ? { ...prev, saving: true, error: null } : null));
    try {
      const response = await fetch(
        `${API_BASE}/documents/${docEditor.documentId}/content`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...demoHeaders },
          body: JSON.stringify({ content: docEditor.content, tenant_id: tenantId }),
        }
      );
      if (!response.ok) throw new Error(await extractErrorDetail(response));
      const result = await response.json();
      setDocuments((prev) =>
        prev.map((d) =>
          d.document_id === docEditor.documentId
            ? { ...d, chunk_count: result.chunk_count }
            : d
        )
      );
      setDocEditor((prev) =>
        prev
          ? { ...prev, saving: false, originalContent: prev.content }
          : null
      );
      notify("Changes saved", "success");
    } catch (error) {
      setDocEditor((prev) =>
        prev ? { ...prev, saving: false, error: "Failed to save — try again" } : null
      );
      console.error("Save document content error:", error);
      notify("Couldn't save your changes. Please try again.", "error");
    }
  };

  // Lazily create a conversation on the first message of a session, so
  // conversation_history (and query rewriting for follow-ups) actually has
  // something to work with. Returns the id to use for this request —
  // avoids reading conversationId from stale closure state right after
  // setConversationId().
  const ensureConversationId = async (): Promise<string> => {
    if (conversationId) return conversationId;
    try {
      const response = await fetch(
        `${API_BASE}/conversations?tenant_id=${encodeURIComponent(tenantId)}`,
        { method: "POST", headers: demoHeaders }
      );
      if (!response.ok) {
        notify("Couldn't start a conversation — your history won't be saved this session.", "error");
        return "";
      }
      const data = await response.json();
      const id = data.conversation_id || "";
      if (id) setConversationId(id);
      return id;
    } catch (error) {
      console.error("Create conversation error:", error);
      notify("Couldn't start a conversation — your history won't be saved this session.", "error");
      return "";
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isLoading) return;
    // Need either some text or an attached image
    if (!input.trim() && chatImages.length === 0) return;
    // If no docs uploaded AND no attached image, nothing to answer from
    if (documents.length === 0 && chatImages.length === 0) return;

    // Unchecking every source used to send document_ids: null, which the
    // backend reads as "no filter" and answers from ALL documents — the exact
    // opposite of what unchecking them means. Refuse instead.
    const selectedCount = documents.filter((d) => d.selected !== false).length;
    if (documents.length > 0 && selectedCount === 0 && chatImages.length === 0) {
      notify("Select at least one source to search, or attach an image.", "info");
      return;
    }

    // Arm the guard and paint the message BEFORE any await. Previously
    // ensureConversationId() ran first, so a network round-trip passed with
    // nothing on screen and isLoading still false: the message appeared to
    // vanish, people clicked send again, and the second click sailed past the
    // guard above. Two identical questions, two answers, double the API cost.
    setIsLoading(true);

    const userMessage: Message = {
      id: newMessageId(),
      role: "user",
      content: input,
      images: chatImages.length > 0 ? chatImages.map((i) => i.dataUrl) : undefined,
    };
    const assistantMessage: Message = {
      // randomUUID, not Date.now(): two submits in the same millisecond
      // produced colliding keys and React reused the wrong node.
      id: newMessageId(),
      role: "assistant",
      content: "",
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
    setChatImages([]);
    setShowScrollBottom(false);

    const convId = await ensureConversationId();

    setTimeout(() => {
      if (chatScrollRef.current) {
        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
    }, 10);

    const includedIds = documents
      .filter((d) => d.selected !== false)
      .map((d) => d.document_id);

    try {
      const response = await fetch(`${API_BASE}/query/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...demoHeaders,
          ...(activeCustomModel
            ? {
                "X-Custom-LLM-Base-URL": activeCustomModel.baseUrl,
                "X-Custom-LLM-Key": activeCustomModel.apiKey,
              }
            : {}),
        },
        body: JSON.stringify({
          query: userMessage.content,
          tenant_id: tenantId,
          conversation_id: convId,
          top_k: isDemoSession ? 3 : topK,
          temperature: temperature,
          max_tokens: maxTokens,
          model: activeCustomModel ? activeCustomModel.model : selectedModel,
          document_ids: includedIds.length > 0 ? includedIds : null,
          attached_images:
            chatImages.length > 0 ? chatImages.map((i) => i.dataUrl) : null,
        }),
      });

      if (!response.ok) {
        throw new Error(await extractErrorDetail(response));
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let rawAccumulated = "";
      let displayedText = "";
      let citations: Citation[] = [];
      let metrics: QueryMetrics | undefined;

      const intervalId = setInterval(() => {
        if (displayedText.length < rawAccumulated.length) {
          const diff = rawAccumulated.length - displayedText.length;
          const step = Math.max(1, Math.min(diff, Math.ceil(diff / 3)));
          displayedText = rawAccumulated.slice(0, displayedText.length + step);

          setMessages((prev) => {
            const newMessages = [...prev];
            const lastIdx = newMessages.length - 1;
            const lastMsg = newMessages[lastIdx];
            if (lastMsg && lastMsg.role === "assistant") {
              newMessages[lastIdx] = {
                ...lastMsg,
                content: displayedText,
              };
            }
            return newMessages;
          });
        }
      }, 30);

      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.text) {
                  rawAccumulated += parsed.text;
                }
                if (parsed.annotations) {
                  citations = parsed.annotations;
                }
                if (parsed.metrics) {
                  metrics = parsed.metrics;
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      }

      while (displayedText.length < rawAccumulated.length) {
        await new Promise((r) => setTimeout(r, 20));
      }
      clearInterval(intervalId);

      setMessages((prev) => {
        const newMessages = [...prev];
        const lastIdx = newMessages.length - 1;
        const lastMsg = newMessages[lastIdx];
        if (lastMsg && lastMsg.role === "assistant") {
          newMessages[lastIdx] = {
            ...lastMsg,
            content: rawAccumulated,
            ...(citations.length > 0 ? { annotations: citations } : {}),
            ...(metrics ? { metrics } : {}),
          };
        }
        return newMessages;
      });
    } catch (error) {
      console.error("Query error:", error);
      const msg = error instanceof Error ? error.message : "Something went wrong";
      notify(msg, "error");
      // If nothing streamed back at all, drop the empty placeholder bubble
      // instead of leaving it stuck on the typing-dots forever. If a partial
      // answer did stream before the failure, leave it — partial is still useful.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.id === assistantMessage.id && !last.content) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const startNewConversation = () => {
    setConversationId("");
    setMessages([]);
    setInput("");
    setViewingSource(null);
    setSidebarOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const suggestions = [
    "Summarize the key points",
    "What are the main conclusions?",
    "List the important dates and figures",
    "Compare the documents",
  ];

  // Avoid a flash of the "paste your key" gate on every reload: groqKey
  // starts empty (required for SSR — localStorage doesn't exist server-side)
  // and is only populated from localStorage in an effect that runs after
  // the first paint. Rendering nothing decisive until that effect has run
  // means we never show the wrong screen, even briefly — same output on
  // server and first client paint, so no hydration mismatch either.
  // Above every early return — hook order must be identical on each render.
  useDrawer({ open: sidebarOpen, onClose: () => setSidebarOpen(false), panelRef: sidebarRef });

  // Ask Personal-or-Business once, the first time a workspace is seen, and
  // send business owners to their console rather than a document library they
  // did not come here for. Also checks if a returning owner with a valid
  // session cookie arrives at /, so they are never asked for API keys.
  useEffect(() => {
    if (!mounted) return;
    setWorkspaceResolved(true);
  }, [mounted]);

  if (!mounted) {
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ background: "var(--claude-bg)" }}
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{
            background: "linear-gradient(145deg, var(--claude-accent), var(--claude-accent-hover))",
            opacity: 0.85,
          }}
        >
          <ScribeMark className="w-[18px] h-[18px] text-white" />
        </div>
      </div>
    );
  }

  // Keys are in but the workspace has not answered yet: hold, rather than
  // render a product this person may not be here for.
  if (groqKey && sarvamKey && workspaceResolved === null) {
    return (
      <div className="gate-loading" role="status" aria-label="Loading">
        <span className="gate-spinner" />
      </div>
    );
  }

  if (!groqKey || !sarvamKey) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-4 sm:p-6"
        style={{ background: "var(--claude-bg)" }}
      >
        <div
          className="w-full max-w-md rounded-xl border p-6 flex flex-col gap-4 shadow-sm"
          style={{ borderColor: "var(--claude-border)", background: "var(--claude-sidebar)" }}
        >
          <div className="flex items-center justify-between gap-3 pb-2 border-b" style={{ borderColor: "var(--claude-border)" }}>
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(145deg, var(--claude-accent), var(--claude-accent-hover))" }}
              >
                <ScribeMark className="w-[18px] h-[18px] text-white" />
              </div>
              <div className="flex flex-col justify-center leading-tight">
                <h1
                  className="font-serif-display text-[19px] leading-tight tracking-tight"
                  style={{ color: "var(--claude-text)" }}
                >
                  Scribe
                </h1>
                <p className="text-[11px] leading-tight mt-0.5" style={{ color: "var(--claude-muted)" }}>
                  Personal chat & business voice assistants
                </p>
              </div>
            </div>

            <Link
              href="/signin"
              className="text-[12px] font-semibold px-2.5 py-1.5 rounded-md border transition-colors hover:bg-white text-center"
              style={{
                borderColor: "var(--claude-border)",
                color: "var(--claude-accent)",
                background: "var(--claude-surface)",
              }}
            >
              Owner Sign In →
            </Link>
            <Link
              href="/directory"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:border-[var(--claude-border-strong)]"
              style={{
                borderColor: "var(--claude-border)",
                color: "var(--claude-text-2)",
                background: "var(--claude-surface)",
              }}
            >
              Explore Directory ↗
            </Link>
          </div>

          <div className="rounded-lg p-3 text-[12px] flex items-center justify-between gap-3"
               style={{ background: "var(--claude-surface-2)", border: "1px solid var(--claude-border)" }}>
            <div>
              <span className="font-semibold block" style={{ color: "var(--claude-text)" }}>
                Want to talk to a business assistant?
              </span>
              <span className="text-[11px]" style={{ color: "var(--claude-muted)" }}>
                Explore live AI phone assistants deployed by businesses and call them directly.
              </span>
            </div>
            <Link
              href="/directory"
              className="shrink-0 text-[11px] font-medium underline"
              style={{ color: "var(--claude-accent)" }}
            >
              Open Directory →
            </Link>
          </div>

          <div className="pt-1">
            <span className="text-[11px] uppercase tracking-wider font-bold block mb-1" style={{ color: "var(--claude-muted)" }}>
              Personal Demo Mode
            </span>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--claude-text-2)" }}>
              Paste your own API keys to start a personal session — up to {DEMO_MAX_DOCUMENTS} documents,
              {DEMO_TOP_K} chunks retrieved per answer, and voice or text chat. Keys stay in your browser.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider block" style={{ color: "var(--claude-muted)" }}>
                Groq API Key (Required)
              </label>
              <input
                type="password"
                value={groqKeyInput}
                onChange={(e) => setGroqKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && groqKeyInput.trim()) startSession(groqKeyInput, sarvamKeyInput);
                }}
                placeholder="gsk_..."
                autoFocus
                className="w-full rounded-md border px-3 py-2 text-[13px] outline-none"
                style={{
                  borderColor: "var(--claude-border)",
                  background: "var(--claude-bg)",
                  color: "var(--claude-text)",
                }}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider block" style={{ color: "var(--claude-muted)" }}>
                Sarvam API Key (Required for Voice)
              </label>
              <input
                type="password"
                value={sarvamKeyInput}
                onChange={(e) => setSarvamKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && groqKeyInput.trim()) startSession(groqKeyInput, sarvamKeyInput);
                }}
                placeholder="Sarvam API Key..."
                className="w-full rounded-md border px-3 py-2 text-[13px] outline-none"
                style={{
                  borderColor: "var(--claude-border)",
                  background: "var(--claude-bg)",
                  color: "var(--claude-text)",
                }}
              />
            </div>
          </div>

          <button
            type="button"
            disabled={!groqKeyInput.trim() || !sarvamKeyInput.trim()}
            onClick={() => startSession(groqKeyInput, sarvamKeyInput)}
            className="w-full rounded-md py-2.5 text-[13px] font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            style={{ background: "var(--claude-accent)" }}
          >
            Start personal chat session
          </button>

          <div className="flex items-center justify-center gap-4">
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] underline text-center inline-flex items-center justify-center gap-1"
              style={{ color: "var(--claude-muted)" }}
            >
              Get free Groq key <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://dashboard.sarvam.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] underline text-center inline-flex items-center justify-center gap-1"
              style={{ color: "var(--claude-muted)" }}
            >
              Get free Sarvam key <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {keyHistory.length > 0 && (
            <div className="pt-1 border-t" style={{ borderColor: "var(--claude-border)" }}>
              <p
                className="text-[11px] uppercase tracking-[0.08em] font-semibold mt-3 mb-2"
                style={{ color: "var(--claude-muted)" }}
              >
                Recently used
              </p>
              <div className="flex flex-col gap-1">
                {keyHistory.map((pair) => (
                  <div
                    key={pair.groqKey}
                    className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
                    style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)" }}
                  >
                    <button
                      type="button"
                      onClick={() => selectRecentPair(pair)}
                      className="flex-1 text-left text-[12px] font-mono truncate"
                      style={{ color: "var(--claude-text-2)" }}
                      title="Use this key pair"
                    >
                      {maskKey(pair.groqKey)} {pair.sarvamKey ? `(Sarvam: ${maskKey(pair.sarvamKey)})` : ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => forgetPair(pair.groqKey)}
                      aria-label="Forget this key pair"
                      title="Forget this key pair"
                      className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded transition-colors"
                      style={{ color: "var(--claude-muted)" }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex overflow-hidden" style={{ background: "var(--claude-bg)", height: "100dvh" }}>
      {/* Mobile drawer backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 md:hidden ds-animate-fade"
          style={{ background: "rgba(20, 20, 18, 0.35)", backdropFilter: "blur(2px)" }}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ============ Sidebar ============ */}
      <aside
        ref={sidebarRef}
        id="app-sidebar"
        aria-label="Documents and conversations"
        className={`w-80 max-w-[85vw] flex flex-col border-r fixed md:static inset-y-0 left-0 z-40 md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        style={{
          background: "var(--claude-sidebar)",
          borderColor: "var(--claude-border)",
          transition: "transform var(--duration-slow) var(--ease-decelerate)",
        }}
      >
        {/* Brand */}
        <div
          className="h-16 px-5 flex items-center gap-3 border-b"
          style={{ borderColor: "var(--claude-border)" }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(145deg, var(--claude-accent), var(--claude-accent-hover))" }}
          >
            <ScribeMark className="w-[18px] h-[18px] text-white" />
          </div>
          <div className="flex flex-col justify-center leading-tight">
            <h1
              className="font-serif-display text-[19px] leading-tight tracking-tight"
              style={{ color: "var(--claude-text)" }}
            >
              Scribe
            </h1>
            <p
              className="text-[11px] leading-tight mt-0.5"
              style={{ color: "var(--claude-muted)" }}
            >
              Chat with your documents
            </p>
          </div>
        </div>

        {/* New chat */}
        <div className="px-4 pt-4">
          <button
            onClick={startNewConversation}
            className="w-full flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: "var(--claude-accent)",
              color: "white",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--claude-accent-hover)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "var(--claude-accent)")
            }
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} />
            New chat
          </button>
        </div>

        {/* Upload */}
        <div className="px-4 pt-3">
          <label
            className="flex flex-col items-center justify-center w-full py-5 border border-dashed rounded-xl cursor-pointer transition-colors"
            style={{
              borderColor: "var(--claude-border-strong)",
              background: "var(--claude-surface)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--claude-accent-soft)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "var(--claude-surface)")
            }
          >
            <UploadCloud
              className="w-5 h-5 mb-2"
              style={{ color: "var(--claude-accent)" }}
            />
            <p
              className="text-[13px] font-medium leading-none"
              style={{ color: "var(--claude-text-2)" }}
            >
              {uploading ? "Uploading…" : "Upload documents"}
            </p>
            <p
              className="text-[11px] mt-1.5 leading-none"
              style={{ color: "var(--claude-muted)" }}
            >
              PDF · DOCX · PPTX · TXT · CSV · XLSX · Images
            </p>
            <input
              type="file"
              className="hidden"
              multiple
              accept=".pdf,.docx,.pptx,.txt,.md,.csv,.xlsx,.png,.jpg,.jpeg,.webp,.bmp,.tiff,.tif,.gif"
              onChange={handleFileUpload}
              disabled={uploading}
            />
          </label>
          <button
            type="button"
            onClick={() => setPasteModalOpen(true)}
            className="mt-2 w-full flex items-center justify-center gap-1.5 h-8 rounded-lg text-[12px] font-medium transition-colors"
            style={{ color: "var(--claude-muted)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.color = "var(--claude-accent)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = "var(--claude-muted)")
            }
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            Paste text instead
          </button>
          {uploadError && (
            <p
              className="mt-2 text-[11px] leading-snug px-1"
              style={{ color: "var(--claude-danger, #d9534f)" }}
            >
              {uploadError}
            </p>
          )}
        </div>

        {/* Document list */}
        <div className="flex-1 overflow-y-auto px-4 pt-5 pb-4">
          {/* Pending uploads */}
          {pendingUploads.length > 0 && (
            <div className="mb-4">
              <h3
                className="text-[11px] uppercase tracking-[0.08em] font-semibold leading-none mb-2 px-1"
                style={{ color: "var(--claude-muted)" }}
              >
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
                      style={{
                        background: "var(--claude-surface)",
                        border: "1px solid var(--claude-border)",
                      }}
                    >
                      <div
                        className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{ background: "var(--claude-accent-soft)" }}
                      >
                        <Loader2
                          className="w-4 h-4 animate-spin"
                          style={{ color: "var(--claude-accent)" }}
                        />
                      </div>
                      <div className="flex-1 min-w-0 leading-tight">
                        <p
                          className="text-[13px] font-medium truncate leading-tight"
                          style={{ color: "var(--claude-text-2)" }}
                        >
                          {p.filename}
                        </p>
                        <p
                          className="text-[11px] mt-0.5 leading-tight"
                          style={{ color: "var(--claude-muted)" }}
                        >
                          {isLikelyOcr ? "Running OCR · " : "Processing · "}
                          {elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p
                className="text-[11px] leading-snug mt-2 px-1"
                style={{ color: "var(--claude-muted)" }}
              >
                Scanned PDFs and images use AI OCR — usually a few seconds per
                page. Don&apos;t close the tab.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between mb-2.5 px-1">
            <h3
              className="text-[11px] uppercase tracking-[0.08em] font-semibold leading-none"
              style={{ color: "var(--claude-muted)" }}
            >
              Sources
            </h3>
            <span
              className="text-[10px] font-medium leading-none px-1.5 h-[18px] inline-flex items-center rounded-full"
              style={{
                background: "var(--claude-surface-2)",
                color: "var(--claude-muted)",
              }}
            >
              {documents.length}
            </span>
          </div>

          {documents.length === 0 && !uploading && (
            <div
              className="text-center py-8 px-4 rounded-xl border"
              style={{
                background: "var(--claude-surface)",
                borderColor: "var(--claude-border)",
              }}
            >
              <BookOpen
                className="w-7 h-7 mx-auto mb-2"
                style={{ color: "var(--claude-border-strong)" }}
              />
              <p
                className="text-[12px] leading-snug"
                style={{ color: "var(--claude-muted)" }}
              >
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
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--claude-surface)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <button
                    type="button"
                    onClick={() => toggleDocumentSelected(doc.document_id)}
                    aria-label={included ? "Exclude from chat" : "Include in chat"}
                    title={included ? "Included — click to exclude" : "Excluded — click to include"}
                    className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center flex-shrink-0 transition-colors"
                    style={{
                      background: included ? "var(--claude-accent)" : "transparent",
                      border: included
                        ? "1px solid var(--claude-accent)"
                        : "1.5px solid var(--claude-border-strong)",
                    }}
                  >
                    {included && (
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => openDocument(doc.document_id)}
                    title="Open document"
                    className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 transition-transform hover:scale-105"
                    style={{ background: "var(--claude-accent-soft)" }}
                  >
                    <FileText
                      className="w-4 h-4"
                      style={{ color: "var(--claude-accent-hover)" }}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => openDocument(doc.document_id)}
                    className="flex-1 min-w-0 leading-tight text-left"
                    title="Open document"
                  >
                    <p
                      className="text-[13px] font-medium truncate leading-tight hover:underline"
                      style={{ color: "var(--claude-text-2)" }}
                    >
                      {doc.filename}
                    </p>
                    <p
                      className="text-[11px] mt-0.5 leading-tight"
                      style={{ color: "var(--claude-muted)" }}
                    >
                      {doc.status} · {doc.chunk_count || 0} chunks
                    </p>
                  </button>

                  <button
                    onClick={() => handleDeleteDocument(doc.document_id)}
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

        {/* Footer */}
        <div
          className="px-5 py-3 border-t text-[11px] flex items-center justify-between gap-2"
          style={{
            borderColor: "var(--claude-border)",
            color: "var(--claude-muted)",
          }}
        >
          {isDemoSession ? (
            <>
              <span className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: "var(--claude-accent)" }}
                />
                <span className="truncate">
                  Demo session · up to {DEMO_MAX_DOCUMENTS} docs, top_k {DEMO_TOP_K}
                </span>
              </span>
              <button
                type="button"
                onClick={endSession}
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
            <span>
              Tenant · <span style={{ color: "var(--claude-text-2)" }}>{tenantId}</span>
            </span>
          )}
        </div>
      </aside>

      {/* ============ Main chat ============ */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header
          className="h-16 px-4 sm:px-6 border-b flex items-center justify-between gap-2"
          style={{
            borderColor: "var(--claude-border)",
            background: "var(--claude-bg)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              className="md:hidden w-9 h-9 -ml-1 rounded-md inline-flex items-center justify-center flex-shrink-0 transition-colors"
              style={{ color: "var(--claude-text-2)" }}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex flex-col justify-center leading-tight min-w-0">
              <h2
                className="font-serif-display text-[19px] leading-tight tracking-tight truncate"
                style={{ color: "var(--claude-text)" }}
              >
                Conversation
              </h2>
              <p
                className="text-[11px] leading-tight mt-0.5"
                style={{ color: "var(--claude-muted)" }}
              >
                {documents.length > 0
                  ? `Grounded in ${documents.length} source${documents.length === 1 ? "" : "s"}`
                  : "Upload a document to get started"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 relative">
            {messages.filter((m) => m.role === "user").length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setQuestionIndexOpen(!questionIndexOpen)}
                  title="Jump to any question in session"
                  className="text-[11px] h-7 px-2.5 inline-flex items-center gap-1.5 rounded-full border transition-colors cursor-pointer"
                  style={{
                    borderColor: questionIndexOpen
                      ? "var(--claude-accent)"
                      : "var(--claude-border)",
                    color: questionIndexOpen
                      ? "var(--claude-accent)"
                      : "var(--claude-text-2)",
                    background: questionIndexOpen
                      ? "var(--claude-accent-soft)"
                      : "var(--claude-surface)",
                  }}
                >
                  <ListFilter className="w-3 h-3 text-[var(--claude-accent)]" />
                  <span>
                    {(() => {
                      const userMsgs = messages.filter((m) => m.role === "user");
                      const activeIdx = userMsgs.findIndex((m) => m.id === activeQuestionId);
                      return activeIdx >= 0
                        ? `Q${activeIdx + 1} of ${userMsgs.length}`
                        : `${userMsgs.length} question${userMsgs.length === 1 ? "" : "s"}`;
                    })()}
                  </span>
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </button>

                {questionIndexOpen && (
                  <div
                    className="absolute right-0 top-9 z-50 w-72 max-h-[380px] overflow-y-auto rounded-2xl border shadow-xl p-3 space-y-2 msg-enter backdrop-blur-xl"
                    style={{
                      background: "var(--claude-surface)",
                      borderColor: "var(--claude-border-strong)",
                      boxShadow: "0 12px 36px rgba(0, 0, 0, 0.14)",
                    }}
                  >
                    <div className="flex items-center justify-between border-b pb-2 px-1" style={{ borderColor: "var(--claude-border)" }}>
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-[var(--claude-muted)]">
                        <ListFilter className="w-3.5 h-3.5 text-[var(--claude-accent)]" />
                        <span>Timeline Outline</span>
                      </div>
                      <span className="text-[10px] text-[var(--claude-muted)] font-mono">
                        {messages.filter((m) => m.role === "user").length} questions
                      </span>
                    </div>

                    <div className="relative pl-7 space-y-2.5 pt-1.5 pb-1.5 before:absolute before:left-[11px] before:top-4 before:bottom-4 before:w-[2px] before:bg-[var(--claude-border)]">
                      {messages
                        .filter((m) => m.role === "user")
                        .map((m, idx, userMsgs) => {
                          const activeIdx = userMsgs.findIndex((msg) => msg.id === activeQuestionId);
                          const isActive = m.id === activeQuestionId || (activeIdx === -1 && idx === userMsgs.length - 1);
                          const msgIdx = messages.findIndex((msg) => msg.id === m.id);
                          const assistantMsg = msgIdx >= 0 ? messages[msgIdx + 1] : null;
                          const citationCount = assistantMsg?.annotations?.length || 0;

                          return (
                            <div key={m.id} className="relative group">
                              {/* Pixel-Perfect Symmetric Stepper Dot */}
                              <div
                                className={`absolute left-[-22px] top-3.5 w-3 h-3 rounded-full border transition-all ${
                                  isActive
                                    ? "bg-[var(--claude-accent)] border-[var(--claude-accent)] scale-110 ring-4 ring-[var(--claude-accent-soft)] z-10"
                                    : "bg-[var(--claude-surface)] border-[var(--claude-border-strong)] group-hover:border-[var(--claude-accent)] z-10"
                                }`}
                              />

                              <button
                                type="button"
                                onClick={() => {
                                  setActiveQuestionId(m.id);
                                  setQuestionIndexOpen(false);
                                  const el = document.getElementById(`msg-${m.id}`);
                                  if (el) {
                                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }
                                }}
                                className={`w-full text-left p-2.5 rounded-xl text-[12px] transition-all cursor-pointer border ${
                                  isActive
                                    ? "bg-[var(--claude-accent-soft)] border-[var(--claude-accent)] font-medium shadow-sm"
                                    : "hover:bg-[var(--claude-surface-2)] border-transparent"
                                }`}
                                style={{ color: "var(--claude-text)" }}
                              >
                                <div className="flex items-center justify-between text-[10px] text-[var(--claude-muted)] mb-0.5 font-semibold">
                                  <span className={isActive ? "text-[var(--claude-accent)] font-bold" : ""}>Question {idx + 1}</span>
                                  {citationCount > 0 && (
                                    <span className="bg-[var(--claude-surface)] px-1.5 py-0.2 rounded border text-[9px]" style={{ borderColor: "var(--claude-border)" }}>
                                      {citationCount} src{citationCount === 1 ? "" : "s"}
                                    </span>
                                  )}
                                </div>
                                <p className="line-clamp-2 leading-snug">
                                  {m.content || "Attached image question"}
                                </p>
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={handleOpenVoiceCall}
              title="Start a voice call"
              aria-label="Voice call"
              className="w-7 h-7 rounded-full border inline-flex items-center justify-center transition-colors"
              style={{
                borderColor: "var(--claude-border)",
                color: "var(--claude-muted)",
                background: "var(--claude-surface)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--claude-accent)";
                e.currentTarget.style.borderColor = "var(--claude-accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--claude-muted)";
                e.currentTarget.style.borderColor = "var(--claude-border)";
              }}
            >
              <Phone className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="RAG & generation settings"
              aria-label="Settings"
              className="w-7 h-7 rounded-full border inline-flex items-center justify-center transition-colors"
              style={{
                borderColor: "var(--claude-border)",
                color: "var(--claude-muted)",
                background: "var(--claude-surface)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--claude-accent)";
                e.currentTarget.style.borderColor = "var(--claude-accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--claude-muted)";
                e.currentTarget.style.borderColor = "var(--claude-border)";
              }}
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto relative ds-scroll"
          ref={chatScrollRef}
          onScroll={handleChatScroll}
          style={{ overscrollBehaviorY: "contain" }}
        >
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            {messages.length === 0 && (
              <div className="flex flex-col items-center text-center pt-20 pb-10">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6"
                  style={{ background: "linear-gradient(145deg, var(--claude-accent), var(--claude-accent-hover))" }}
                >
                  <ScribeMark className="w-7 h-7 text-white" />
                </div>
                <h2
                  className="font-serif-display text-[34px] leading-tight tracking-tight mb-3"
                  style={{ color: "var(--claude-text)" }}
                >
                  How can I help you today?
                </h2>
                <p
                  className="text-[14px] leading-relaxed max-w-md mb-10"
                  style={{ color: "var(--claude-muted)" }}
                >
                  Ask anything about your uploaded documents. I&apos;ll respond
                  with citations so you can verify every claim.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-xl">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      disabled={documents.length === 0}
                      onClick={() => setInput(s)}
                      className="text-left px-4 py-3 rounded-xl border text-[13px] leading-snug transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{
                        borderColor: "var(--claude-border)",
                        background: "var(--claude-surface)",
                        color: "var(--claude-text-2)",
                      }}
                      onMouseEnter={(e) => {
                        if (documents.length === 0) return;
                        e.currentTarget.style.background =
                          "var(--claude-accent-soft)";
                        e.currentTarget.style.borderColor =
                          "var(--claude-accent)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background =
                          "var(--claude-surface)";
                        e.currentTarget.style.borderColor =
                          "var(--claude-border)";
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="msg-list-inner">
              {messages.map((message) => (
                <div key={message.id} id={`msg-${message.id}`} className="scroll-mt-6">
                  <ChatMessageView
                    message={{
                      id: message.id,
                      role: message.role,
                      content: message.content,
                      citations: message.annotations,
                      images: message.images,
                      metrics: message.metrics,
                      streaming:
                        isLoading &&
                        message.role === "assistant" &&
                        message.id === messages[messages.length - 1]?.id,
                    }}
                    onOpenCitation={openSource}
                  />
                </div>
              ))}
            </div>

            <div ref={messagesEndRef} />
          </div>

        </div>

        {/* Composer */}
        <div
          className="border-t relative"
          style={{
            borderColor: "var(--claude-border)",
            background: "var(--claude-cream)",
          }}
        >
          {/* Non-overlapping Jump to Bottom Button */}
          {showScrollBottom && (
            <button
              type="button"
              onClick={() => {
                const el = chatScrollRef.current;
                if (el) {
                  el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                }
              }}
              aria-label="Scroll to bottom"
              title="Jump to latest message"
              className="absolute -top-11 right-4 sm:right-6 z-40 h-8 px-3 rounded-full shadow-md border inline-flex items-center gap-1.5 text-[11px] font-medium transition-all transform hover:scale-105 active:scale-95 cursor-pointer backdrop-blur-md"
              style={{
                background: "var(--claude-surface)",
                borderColor: "var(--claude-border-strong)",
                color: "var(--claude-text)",
                boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
              }}
            >
              <ArrowDown className="w-3.5 h-3.5 text-[var(--claude-accent)] flex-shrink-0" />
              <span>Jump to bottom</span>
            </button>
          )}
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4">
            <form onSubmit={handleSubmit}>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragOverComposer) setDragOverComposer(true);
                }}
                onDragLeave={() => setDragOverComposer(false)}
                onDrop={onComposerDrop}
                className="rounded-2xl border transition-all relative"
                style={{
                  borderColor: dragOverComposer
                    ? "var(--claude-accent)"
                    : "var(--claude-border-strong)",
                  background: dragOverComposer
                    ? "var(--claude-accent-soft)"
                    : "var(--claude-surface)",
                  boxShadow: dragOverComposer
                    ? "0 0 0 3px var(--claude-accent-soft)"
                    : "none",
                }}
              >
                {/* Image preview strip */}
                {chatImages.length > 0 && (
                  <div className="flex flex-wrap gap-2 px-3 pt-3">
                    {chatImages.map((img) => (
                      <div
                        key={img.id}
                        className="relative group"
                        style={{
                          width: 64,
                          height: 64,
                          borderRadius: 10,
                          overflow: "hidden",
                          border: "1px solid var(--claude-border)",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.dataUrl}
                          alt={img.name}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => removeChatImage(img.id)}
                          aria-label="Remove image"
                          className="absolute top-1 right-1 w-5 h-5 rounded-full inline-flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{
                            background: "rgba(20,20,18,0.75)",
                            color: "white",
                          }}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-end gap-2 pl-3 pr-2 py-2">
                  <button
                    type="button"
                    onClick={() => chatImageInputRef.current?.click()}
                    aria-label="Attach image"
                    title="Attach image (or drag/drop, or paste)"
                    className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors flex-shrink-0"
                    style={{ color: "var(--claude-muted)" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        "var(--claude-surface-2)";
                      e.currentTarget.style.color = "var(--claude-accent)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--claude-muted)";
                    }}
                    disabled={isLoading || chatImages.length >= 3}
                  >
                    <Paperclip className="w-[18px] h-[18px]" strokeWidth={2} />
                  </button>
                  <input
                    ref={chatImageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) addChatImages(e.target.files);
                      e.target.value = "";
                    }}
                  />

                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    onPaste={onComposerPaste}
                    placeholder={
                      documents.length === 0 && chatImages.length === 0
                        ? "Upload a document or drop an image to start chatting…"
                        : chatImages.length > 0
                          ? "Ask about the attached image…"
                          : "Ask a question, or drop an image here…"
                    }
                    rows={1}
                    className="flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-[var(--claude-muted)] disabled:cursor-not-allowed"
                    style={{ color: "var(--claude-text)" }}
                    disabled={isLoading}
                  />
                  {(() => {
                    const canSend =
                      !isLoading &&
                      (input.trim().length > 0 || chatImages.length > 0) &&
                      (documents.length > 0 || chatImages.length > 0);
                    return (
                      <button
                        type="submit"
                        disabled={!canSend}
                        className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed flex-shrink-0"
                        style={{
                          background: canSend
                            ? "var(--claude-accent)"
                            : "var(--claude-border-strong)",
                          color: "white",
                        }}
                        onMouseEnter={(e) => {
                          if (canSend)
                            e.currentTarget.style.background =
                              "var(--claude-accent-hover)";
                        }}
                        onMouseLeave={(e) => {
                          if (canSend)
                            e.currentTarget.style.background =
                              "var(--claude-accent)";
                        }}
                        aria-label="Send message"
                      >
                        {isLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" strokeWidth={2.25} />
                        )}
                      </button>
                    );
                  })()}
                </div>

                {/* Drag-overlay hint */}
                {dragOverComposer && (
                  <div
                    className="absolute inset-0 flex items-center justify-center rounded-2xl pointer-events-none"
                    style={{
                      background: "var(--claude-accent-soft)",
                      color: "var(--claude-accent-hover)",
                    }}
                  >
                    <div className="flex items-center gap-2 text-[14px] font-medium">
                      <ImageIcon className="w-5 h-5" />
                      Drop image to attach
                    </div>
                  </div>
                )}
              </div>
              <p
                className="text-[11px] text-center mt-2.5 leading-none"
                style={{ color: "var(--claude-muted)" }}
              >
                {documents.length === 0 && chatImages.length === 0
                  ? "Upload a document or drop an image to start chatting."
                  : "Enter to send · Shift+Enter newline · drag/drop or paste images (max 3)"}
              </p>
            </form>
          </div>
        </div>
      </main>

      {/* ============ Source viewer side panel ============ */}
      {viewingSource && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setViewingSource(null)}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(20, 20, 18, 0.25)" }}
          />
          {/* Panel */}
          <aside
            className="fixed top-0 right-0 h-full w-full sm:w-[480px] z-50 flex flex-col shadow-2xl"
            style={{
              background: "var(--claude-bg)",
              borderLeft: "1px solid var(--claude-border)",
            }}
          >
            {/* Header */}
            <div
              className="h-16 px-5 flex items-center gap-3 border-b flex-shrink-0"
              style={{ borderColor: "var(--claude-border)" }}
            >
              <span
                className="text-[11px] font-bold min-w-[28px] h-6 inline-flex items-center justify-center rounded flex-shrink-0 px-1.5"
                style={{ background: "var(--claude-accent)", color: "white" }}
              >
                {viewingSource.label}
              </span>
              <div className="flex-1 min-w-0 leading-tight">
                <div
                  className="text-[14px] font-semibold truncate"
                  style={{ color: "var(--claude-text)" }}
                  title={viewingSource.citation.filename}
                >
                  {viewingSource.citation.filename}
                </div>
                <div
                  className="text-[11px] mt-0.5"
                  style={{ color: "var(--claude-muted)" }}
                >
                  {viewingSource.citation.page_number
                    ? `Page ${viewingSource.citation.page_number} · `
                    : ""}
                  Relevance{" "}
                  {(viewingSource.citation.score * 100).toFixed(0)}%
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingSource(null)}
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

            {/* Body — the snippet */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div
                className="text-[11px] uppercase tracking-wider font-semibold mb-3"
                style={{ color: "var(--claude-muted)" }}
              >
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
                {viewingSource.citation.content
                  || viewingSource.citation.snippet
                  || "(No excerpt available)"}
              </div>
              {viewingSource.citation.chunk_index !== undefined && (
                <div
                  className="text-[11px] mt-3 px-1"
                  style={{ color: "var(--claude-muted)" }}
                >
                  Chunk #{viewingSource.citation.chunk_index + 1}
                  {viewingSource.citation.page_number
                    ? ` from page ${viewingSource.citation.page_number}`
                    : ""}
                </div>
              )}
            </div>

            {/* Footer — open original */}
            <div
              className="px-5 py-3 border-t flex-shrink-0"
              style={{ borderColor: "var(--claude-border)" }}
            >
              <button
                type="button"
                onClick={() =>
                  window.open(
                    `${API_BASE}/documents/${viewingSource.citation.document_id}/file`,
                    "_blank"
                  )
                }
                className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[13px] font-medium transition-colors"
                style={{
                  background: "var(--claude-surface)",
                  border: "1px solid var(--claude-border-strong)",
                  color: "var(--claude-text-2)",
                }}
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
      )}

      {docEditor && (
        <>
          <div
            onClick={() => !docEditor.saving && setDocEditor(null)}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(20, 20, 18, 0.35)" }}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="w-full max-w-2xl rounded-xl shadow-2xl flex flex-col"
              style={{
                background: "var(--claude-bg)",
                border: "1px solid var(--claude-border)",
                height: "80vh",
              }}
            >
              <div
                className="h-14 px-5 flex items-center justify-between border-b flex-shrink-0 gap-3"
                style={{ borderColor: "var(--claude-border)" }}
              >
                <span
                  className="text-[14px] font-semibold truncate"
                  style={{ color: "var(--claude-text)" }}
                  title={docEditor.filename}
                >
                  {docEditor.filename || "Loading…"}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      window.open(
                        `${API_BASE}/documents/${docEditor.documentId}/file`,
                        "_blank"
                      )
                    }
                    title="Open original file (with original formatting)"
                    className="h-8 px-3 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors"
                    style={{
                      background: "var(--claude-surface)",
                      border: "1px solid var(--claude-border-strong)",
                      color: "var(--claude-text-2)",
                    }}
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
                    <Loader2
                      className="w-5 h-5 animate-spin"
                      style={{ color: "var(--claude-muted)" }}
                    />
                  </div>
                ) : docEditor.error && !docEditor.content ? (
                  <div
                    className="flex-1 flex items-center justify-center text-[13px]"
                    style={{ color: "var(--claude-muted)" }}
                  >
                    {docEditor.error}
                  </div>
                ) : docEditor.editable ? (
                  <>
                    {docEditor.isImage && (
                      <p
                        className="text-[11px] mb-2"
                        style={{ color: "var(--claude-muted)" }}
                      >
                        This is the text detected in the image (used for search) — the image itself isn&apos;t edited here.
                      </p>
                    )}
                    <textarea
                      value={docEditor.content}
                      onChange={(e) =>
                        setDocEditor((prev) =>
                          prev ? { ...prev, content: e.target.value } : null
                        )
                      }
                      className="flex-1 w-full px-3 py-2.5 rounded-lg text-[13px] leading-relaxed outline-none resize-none"
                      style={{
                        background: "var(--claude-surface)",
                        border: "1px solid var(--claude-border-strong)",
                        color: "var(--claude-text)",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, monospace",
                      }}
                      spellCheck={false}
                    />
                  </>
                ) : (
                  <div
                    className="flex-1 flex items-center justify-center text-center text-[13px] px-6"
                    style={{ color: "var(--claude-muted)" }}
                  >
                    Editing isn&apos;t supported for this file type — use
                    &quot;Original&quot; above to view it.
                  </div>
                )}
              </div>

              {docEditor.editable && !docEditor.loading && (
                <div
                  className="px-5 py-3 border-t flex-shrink-0 flex items-center justify-between gap-2"
                  style={{ borderColor: "var(--claude-border)" }}
                >
                  <span
                    className="text-[11px]"
                    style={{ color: "#DC2626" }}
                  >
                    {docEditor.error || ""}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDocEditor(null)}
                      disabled={docEditor.saving}
                      className="h-9 px-4 rounded-lg text-[13px] font-medium transition-colors"
                      style={{
                        background: "var(--claude-surface)",
                        border: "1px solid var(--claude-border-strong)",
                        color: "var(--claude-text-2)",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveDocumentEditor}
                      disabled={
                        docEditor.saving ||
                        docEditor.content === docEditor.originalContent
                      }
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
      )}

      <VoiceCallModal
        isOpen={voiceCallOpen}
        onClose={handleCloseVoiceCall}
        apiBase={API_BASE}
        userGroqKey={groqKey || undefined}
        userSarvamKey={sarvamKey || undefined}
        notify={notify}
        tenantId={tenantId}
        conversationId={conversationId || undefined}
        hasDocuments={documents.length > 0}
        selectedModel={activeCustomModel ? activeCustomModel.model : selectedModel}
        customLlmBaseUrl={activeCustomModel?.baseUrl}
        customLlmApiKey={activeCustomModel?.apiKey}
        clientId={clientId}
        temperature={temperature}
        maxTokens={maxTokens}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {settingsOpen && (
        <>
          <div
            onClick={() => {
              setSettingsOpen(false);
              setKeySwitcherOpen(false);
            }}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(20, 20, 18, 0.35)" }}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="w-full max-w-md rounded-xl shadow-2xl flex flex-col"
              style={{
                background: "var(--claude-bg)",
                border: "1px solid var(--claude-border)",
                maxHeight: "85vh",
              }}
            >
              <div
                className="h-16 px-5 flex items-center justify-between border-b flex-shrink-0"
                style={{ borderColor: "var(--claude-border)" }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: "linear-gradient(145deg, var(--claude-accent), var(--claude-accent-hover))" }}
                  >
                    <ScribeMark className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex flex-col justify-center leading-tight">
                    <span
                      className="text-[15px] font-semibold font-serif-display"
                      style={{ color: "var(--claude-text)" }}
                    >
                      Settings
                    </span>
                    <span className="text-[11px] leading-tight" style={{ color: "var(--claude-muted)" }}>
                      Session &amp; generation preferences
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false);
                    setKeySwitcherOpen(false);
                  }}
                  aria-label="Close"
                  className="w-8 h-8 rounded-md inline-flex items-center justify-center transition-colors flex-shrink-0"
                  style={{ color: "var(--claude-muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--claude-surface-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="overflow-y-auto px-5 py-5 flex flex-col gap-6">
                {/* ---- API key / session ---- */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <KeyRound className="w-3.5 h-3.5" style={{ color: "var(--claude-accent)" }} />
                    <span
                      className="text-[11px] uppercase tracking-wider font-semibold"
                      style={{ color: "var(--claude-muted)" }}
                    >
                      Groq API key
                    </span>
                  </div>

                  <div
                    className="rounded-xl border px-3.5 py-3"
                    style={{
                      borderColor: "var(--claude-border)",
                      background: "var(--claude-surface)",
                      boxShadow: "0 1px 2px rgba(20,20,18,0.04)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex items-center gap-2">
                        {groqKey && (
                          <span
                            className="relative flex-shrink-0 w-2 h-2 rounded-full"
                            style={{ background: "#2e7d5b" }}
                            title="Active"
                          >
                            <span
                              className="absolute inset-0 rounded-full animate-ping"
                              style={{ background: "#2e7d5b", opacity: 0.6 }}
                            />
                          </span>
                        )}
                        <div className="min-w-0">
                          <div
                            className="text-[13px] font-mono truncate"
                            style={{ color: "var(--claude-text)" }}
                            title={groqKey ? "Your key — masked for privacy" : undefined}
                          >
                            {groqKey ? maskKey(groqKey) : "No key active"}
                          </div>
                          <div className="text-[11px] mt-0.5" style={{ color: "var(--claude-muted)" }}>
                            {groqKey ? "Active — used for this session" : "Paste a key to start"}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setKeySwitcherOpen((v) => !v)}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors"
                        style={{ borderColor: "var(--claude-border)", color: "var(--claude-text-2)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = "var(--claude-accent)";
                          e.currentTarget.style.borderColor = "var(--claude-accent)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = "var(--claude-text-2)";
                          e.currentTarget.style.borderColor = "var(--claude-border)";
                        }}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Change
                      </button>
                    </div>

                    {keySwitcherOpen && (
                      <div
                        className="mt-3 pt-3 border-t flex flex-col gap-2.5"
                        style={{ borderColor: "var(--claude-border)" }}
                      >
                        {keyHistory.filter((p) => p.groqKey !== groqKey).length > 0 && (
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-medium" style={{ color: "var(--claude-muted)" }}>
                              Switch to a recent key pair
                            </span>
                            {keyHistory
                              .filter((p) => p.groqKey !== groqKey)
                              .map((pair) => (
                                <div
                                  key={pair.groqKey}
                                  className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
                                  style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)" }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      switchPair(pair);
                                      setKeySwitcherOpen(false);
                                    }}
                                    className="flex-1 text-left text-[12px] font-mono truncate"
                                    style={{ color: "var(--claude-text-2)" }}
                                  >
                                    {maskKey(pair.groqKey)} {pair.sarvamKey ? `(with Sarvam: ${maskKey(pair.sarvamKey)})` : ""}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => forgetPair(pair.groqKey)}
                                    aria-label="Forget this key pair"
                                    title="Forget this key pair"
                                    className="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded transition-colors"
                                    style={{ color: "var(--claude-muted)" }}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                          </div>
                        )}

                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] font-medium" style={{ color: "var(--claude-muted)" }}>
                            Or paste a new key
                          </span>
                          <div className="flex gap-1.5">
                            <input
                              type="password"
                              value={newKeyInput}
                              onChange={(e) => setNewKeyInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && newKeyInput.trim()) {
                                  switchKey(newKeyInput);
                                  setNewKeyInput("");
                                  setKeySwitcherOpen(false);
                                }
                              }}
                              placeholder="gsk_..."
                              className="flex-1 min-w-0 rounded-md border px-2.5 py-1.5 text-[12px] outline-none"
                              style={{
                                borderColor: "var(--claude-border)",
                                background: "var(--claude-bg)",
                                color: "var(--claude-text)",
                              }}
                            />
                            <button
                              type="button"
                              disabled={!newKeyInput.trim()}
                              onClick={() => {
                                switchKey(newKeyInput);
                                setNewKeyInput("");
                                setKeySwitcherOpen(false);
                              }}
                              className="flex-shrink-0 h-8 px-3 rounded-md text-[12px] font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              style={{ background: "var(--claude-accent)" }}
                            >
                              Use
                            </button>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setSettingsOpen(false);
                            setKeySwitcherOpen(false);
                            endSession();
                          }}
                          className="self-start inline-flex items-center gap-1.5 mt-1 text-[12px] font-medium transition-colors"
                          style={{ color: "#c0392b" }}
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          Remove key &amp; end session
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* ---- Sarvam API key (Optional) ---- */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <KeyRound className="w-3.5 h-3.5" style={{ color: "var(--claude-accent)" }} />
                    <span
                      className="text-[11px] uppercase tracking-wider font-semibold"
                      style={{ color: "var(--claude-muted)" }}
                    >
                      Sarvam API key (Required)
                    </span>
                  </div>

                  <div
                    className="rounded-xl border px-3.5 py-3"
                    style={{
                      borderColor: "var(--claude-border)",
                      background: "var(--claude-surface)",
                      boxShadow: "0 1px 2px rgba(20,20,18,0.04)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex items-center gap-2">
                        {sarvamKey && (
                          <span
                            className="relative flex-shrink-0 w-2 h-2 rounded-full"
                            style={{ background: "#2e7d5b" }}
                            title="Active"
                          >
                            <span
                              className="absolute inset-0 rounded-full animate-ping"
                              style={{ background: "#2e7d5b", opacity: 0.6 }}
                            />
                          </span>
                        )}
                        <div className="min-w-0">
                          <div
                            className="text-[13px] font-mono truncate"
                            style={{ color: "var(--claude-text)" }}
                            title={sarvamKey ? "Your key — masked for privacy" : undefined}
                          >
                            {sarvamKey ? maskKey(sarvamKey) : "No key active"}
                          </div>
                          <div className="text-[11px] mt-0.5" style={{ color: "var(--claude-muted)" }}>
                            {sarvamKey ? "Used for Indian language voice STT/TTS" : "Required — used for this session"}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSarvamSwitcherOpen((v) => !v)}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border transition-colors"
                        style={{ borderColor: "var(--claude-border)", color: "var(--claude-text-2)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = "var(--claude-accent)";
                          e.currentTarget.style.borderColor = "var(--claude-accent)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = "var(--claude-text-2)";
                          e.currentTarget.style.borderColor = "var(--claude-border)";
                        }}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Change
                      </button>
                    </div>

                    {sarvamSwitcherOpen && (
                      <div
                        className="mt-3 pt-3 border-t flex flex-col gap-2.5"
                        style={{ borderColor: "var(--claude-border)" }}
                      >
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] font-medium" style={{ color: "var(--claude-muted)" }}>
                            Paste Sarvam key
                          </span>
                          <div className="flex gap-1.5">
                            <input
                              type="password"
                              value={newSarvamKeyInput}
                              onChange={(e) => setNewSarvamKeyInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const trimmed = newSarvamKeyInput.trim();
                                  setSarvamKey(trimmed);
                                  setNewSarvamKeyInput("");
                                  setSarvamSwitcherOpen(false);
                                  notify(trimmed ? "Updated Sarvam API key." : "Removed Sarvam API key.", "info");
                                }
                              }}
                              placeholder="Sarvam API key..."
                              className="flex-1 min-w-0 rounded-md border px-2.5 py-1.5 text-[12px] outline-none"
                              style={{
                                borderColor: "var(--claude-border)",
                                background: "var(--claude-bg)",
                                color: "var(--claude-text)",
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const trimmed = newSarvamKeyInput.trim();
                                setSarvamKey(trimmed);
                                setNewSarvamKeyInput("");
                                setSarvamSwitcherOpen(false);
                                notify(trimmed ? "Updated Sarvam API key." : "Removed Sarvam API key.", "info");
                              }}
                              className="flex-shrink-0 h-8 px-3 rounded-md text-[12px] font-medium text-white transition-colors"
                              style={{ background: "var(--claude-accent)" }}
                            >
                              Save
                            </button>
                          </div>
                        </div>

                        {sarvamKey && (
                          <button
                            type="button"
                            onClick={() => {
                              setSettingsOpen(false);
                              setSarvamSwitcherOpen(false);
                              endSession();
                              notify("Removed keys and ended session.", "info");
                            }}
                            className="self-start inline-flex items-center gap-1.5 mt-1 text-[12px] font-medium transition-colors"
                            style={{ color: "#c0392b" }}
                          >
                            <LogOut className="w-3.5 h-3.5" />
                            Remove key &amp; end session
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* ---- Model Selection ---- */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Cpu className="w-3.5 h-3.5" style={{ color: "var(--claude-accent)" }} />
                    <span
                      className="text-[11px] uppercase tracking-wider font-semibold"
                      style={{ color: "var(--claude-muted)" }}
                    >
                      Active LLM Model
                    </span>
                  </div>
                  <div
                    className="rounded-xl border p-2.5 flex flex-col gap-1.5"
                    style={{
                      borderColor: "var(--claude-border)",
                      background: "var(--claude-surface)",
                      boxShadow: "0 1px 2px rgba(20,20,18,0.04)",
                    }}
                  >
                    {[
                      { id: "openai/gpt-oss-20b", name: "GPT OSS 20B", desc: "Fast & lightweight model for standard replies", tag: "Fast" },
                      { id: "openai/gpt-oss-120b", name: "GPT OSS 120B", desc: "Ultra-smart, massive scale reasoning", tag: "Premium" },
                      { id: "qwen/qwen3.6-27b", name: "Qwen 3.6 27B", desc: "Advanced multilingual & coding tasks", tag: "Reasoning" },
                      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", desc: "Balanced reasoning, complex prompts", tag: "Versatile" },
                      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", desc: "Immediate responses, extremely fast", tag: "Instant" }
                    ].map((m) => {
                      const active = selectedModel === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedModel(m.id);
                            notify(`Switched model to ${m.name}`, "info");
                          }}
                          className="w-full text-left rounded-lg border px-3 py-2 transition-all flex items-start justify-between gap-3 text-[12px] cursor-pointer hover:border-[var(--claude-border-strong)]"
                          style={{
                            borderColor: active ? "var(--claude-accent)" : "var(--claude-border)",
                            background: active ? "var(--claude-accent-soft)" : "var(--claude-surface)",
                          }}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold" style={{ color: "var(--claude-text)" }}>{m.name}</span>
                              <span className="text-[8px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full" 
                                    style={{ 
                                      background: active ? "var(--claude-accent)" : "var(--claude-surface-2)",
                                      color: active ? "#fff" : "var(--claude-muted)"
                                    }}>
                                {m.tag}
                              </span>
                            </div>
                            <div className="text-[10px] mt-0.5" style={{ color: "var(--claude-muted)" }}>{m.desc}</div>
                          </div>
                          {active && <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--claude-accent)" }} />}
                        </button>
                      );
                    })}

                    {customModels.map((m) => {
                      const active = selectedModel === `${CUSTOM_MODEL_PREFIX}${m.id}`;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedModel(`${CUSTOM_MODEL_PREFIX}${m.id}`);
                            notify(`Switched model to ${m.label}`, "info");
                          }}
                          className="w-full text-left rounded-lg border px-3 py-2 transition-all flex items-start justify-between gap-3 text-[12px] cursor-pointer hover:border-[var(--claude-border-strong)]"
                          style={{
                            borderColor: active ? "var(--claude-accent)" : "var(--claude-border)",
                            background: active ? "var(--claude-accent-soft)" : "var(--claude-surface)",
                          }}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold" style={{ color: "var(--claude-text)" }}>{m.label}</span>
                              <span
                                className="text-[8px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full"
                                style={{
                                  background: active ? "var(--claude-accent)" : "var(--claude-surface-2)",
                                  color: active ? "#fff" : "var(--claude-muted)",
                                }}
                              >
                                Custom
                              </span>
                            </div>
                            <div className="text-[10px] mt-0.5 truncate" style={{ color: "var(--claude-muted)" }}>
                              {m.model} · {m.baseUrl}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeCustomModel(m.id);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  removeCustomModel(m.id);
                                }
                              }}
                              title="Remove this model"
                              aria-label="Remove this model"
                              className="w-6 h-6 inline-flex items-center justify-center rounded-md transition-colors"
                              style={{ color: "#c0392b" }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </span>
                            {active && <Check className="w-3.5 h-3.5" style={{ color: "var(--claude-accent)" }} />}
                          </div>
                        </button>
                      );
                    })}

                    {/* Add any OpenAI-compatible model — just a base URL, an
                        API key, and the model id. Nothing server-side: the
                        key lives in this browser and is sent per-request,
                        same as the Groq/Sarvam demo keys above. */}
                    {addingCustomModel ? (
                      <div
                        className="rounded-lg border px-3 py-2.5 flex flex-col gap-2 text-[12px]"
                        style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface-2)" }}
                      >
                        <input
                          type="text"
                          placeholder="Name (e.g. Mistral)"
                          value={customModelForm.label}
                          onChange={(e) => setCustomModelForm((f) => ({ ...f, label: e.target.value }))}
                          className="w-full rounded-md border px-2.5 py-1.5 text-[12px] outline-none"
                          style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
                        />
                        <input
                          type="text"
                          placeholder="Base URL (e.g. https://api.mistral.ai/v1)"
                          value={customModelForm.baseUrl}
                          onChange={(e) => setCustomModelForm((f) => ({ ...f, baseUrl: e.target.value }))}
                          className="w-full rounded-md border px-2.5 py-1.5 text-[12px] outline-none"
                          style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
                        />
                        <input
                          type="password"
                          placeholder="API key"
                          value={customModelForm.apiKey}
                          onChange={(e) => setCustomModelForm((f) => ({ ...f, apiKey: e.target.value }))}
                          className="w-full rounded-md border px-2.5 py-1.5 text-[12px] outline-none"
                          style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
                        />
                        <input
                          type="text"
                          placeholder="Model id (e.g. ministral-3b-2512)"
                          value={customModelForm.model}
                          onChange={(e) => setCustomModelForm((f) => ({ ...f, model: e.target.value }))}
                          className="w-full rounded-md border px-2.5 py-1.5 text-[12px] outline-none"
                          style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
                        />
                        <div className="flex justify-end gap-2 mt-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              setAddingCustomModel(false);
                              setCustomModelForm({ label: "", baseUrl: "", apiKey: "", model: "" });
                            }}
                            className="h-7 px-3 rounded-md text-[12px] font-medium"
                            style={{ color: "var(--claude-text-2)" }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={addCustomModel}
                            className="h-7 px-3 rounded-md text-[12px] font-medium text-white"
                            style={{ background: "var(--claude-accent)" }}
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingCustomModel(true)}
                        className="w-full text-left rounded-lg border border-dashed px-3 py-2 text-[12px] font-medium transition-colors flex items-center gap-1.5"
                        style={{ borderColor: "var(--claude-border-strong)", color: "var(--claude-muted)" }}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add a model (any OpenAI-compatible API)
                      </button>
                    )}
                  </div>
                </div>

                {/* ---- Generation & RAG settings ---- */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <SlidersHorizontal className="w-3.5 h-3.5" style={{ color: "var(--claude-accent)" }} />
                    <span
                      className="text-[11px] uppercase tracking-wider font-semibold"
                      style={{ color: "var(--claude-muted)" }}
                    >
                      RAG &amp; generation
                    </span>
                  </div>

                  <div
                    className="rounded-xl border px-4 py-4 flex flex-col gap-5"
                    style={{
                      borderColor: "var(--claude-border)",
                      background: "var(--claude-surface)",
                      boxShadow: "0 1px 2px rgba(20,20,18,0.04)",
                    }}
                  >
                    {/* Chunks retrieved (top_k) */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[13px] font-medium" style={{ color: "var(--claude-text-2)" }}>
                          Chunks retrieved (top_k)
                        </label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isDemoSession || (isDemoSession ? DEMO_TOP_K : topK) <= 1}
                            onClick={() => setTopK((v) => Math.max(1, v - 1))}
                            className="w-6 h-6 rounded-md border flex items-center justify-center text-[12px] font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
                          >
                            -
                          </button>
                          <span className="text-[12px] font-mono font-semibold w-6 text-center" style={{ color: "var(--claude-text)" }}>
                            {isDemoSession ? DEMO_TOP_K : topK}
                          </span>
                          <button
                            type="button"
                            disabled={isDemoSession || (isDemoSession ? DEMO_TOP_K : topK) >= 20}
                            onClick={() => setTopK((v) => Math.min(20, v + 1))}
                            className="w-6 h-6 rounded-md border flex items-center justify-center text-[12px] font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={20}
                        step={1}
                        value={isDemoSession ? DEMO_TOP_K : topK}
                        onChange={(e) => setTopK(Number(e.target.value))}
                        disabled={isDemoSession}
                        className="w-full custom-range-slider"
                        style={isDemoSession ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                      />
                      <p className="text-[11px]" style={{ color: "var(--claude-muted)" }}>
                        {isDemoSession ? `Fixed at ${DEMO_TOP_K} for demo sessions.` : "More chunks = better context coverage."}
                      </p>
                    </div>

                    {/* Temperature */}
                    <div className="flex flex-col gap-1.5 pt-4 border-t" style={{ borderColor: "var(--claude-border)" }}>
                      <div className="flex items-center justify-between">
                        <label className="text-[13px] font-medium" style={{ color: "var(--claude-text-2)" }}>
                          Temperature
                        </label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={temperature <= 0.0}
                            onClick={() => setTemperature((v) => Math.max(0.0, Number((v - 0.1).toFixed(1))))}
                            className="w-6 h-6 rounded-md border flex items-center justify-center text-[12px] font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
                          >
                            -
                          </button>
                          <span className="text-[12px] font-mono font-semibold w-8 text-center" style={{ color: "var(--claude-text)" }}>
                            {temperature.toFixed(1)}
                          </span>
                          <button
                            type="button"
                            disabled={temperature >= 2.0}
                            onClick={() => setTemperature((v) => Math.min(2.0, Number((v + 0.1).toFixed(1))))}
                            className="w-6 h-6 rounded-md border flex items-center justify-center text-[12px] font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.1}
                        value={temperature}
                        onChange={(e) => setTemperature(Number(e.target.value))}
                        className="w-full custom-range-slider"
                      />
                      <p className="text-[11px]" style={{ color: "var(--claude-muted)" }}>
                        Lower = precise & focused; higher = creative & diverse.
                      </p>
                    </div>

                    {/* Max answer tokens */}
                    <div className="flex flex-col gap-1.5 pt-4 border-t" style={{ borderColor: "var(--claude-border)" }}>
                      <div className="flex items-center justify-between">
                        <label className="text-[13px] font-medium" style={{ color: "var(--claude-text-2)" }}>
                          Max answer tokens
                        </label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={maxTokens <= 50}
                            onClick={() => setMaxTokens((v) => Math.max(50, v - 50))}
                            className="w-6 h-6 rounded-md border flex items-center justify-center text-[12px] font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
                          >
                            -
                          </button>
                          <span className="text-[12px] font-mono font-semibold w-10 text-center" style={{ color: "var(--claude-text)" }}>
                            {maxTokens}
                          </span>
                          <button
                            type="button"
                            disabled={maxTokens >= 4000}
                            onClick={() => setMaxTokens((v) => Math.min(4000, v + 50))}
                            className="w-6 h-6 rounded-md border flex items-center justify-center text-[12px] font-bold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ borderColor: "var(--claude-border-strong)", background: "var(--claude-bg)", color: "var(--claude-text)" }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={50}
                        max={4000}
                        step={50}
                        value={maxTokens}
                        onChange={(e) => setMaxTokens(Number(e.target.value))}
                        className="w-full custom-range-slider"
                      />
                      <p className="text-[11px]" style={{ color: "var(--claude-muted)" }}>
                        Controls the maximum length of generated replies.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div
                className="px-5 py-3.5 border-t flex-shrink-0 flex justify-between items-center"
                style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setTopK(5);
                    setTemperature(0.1);
                    setMaxTokens(800);
                    notify("Restored default generation settings", "info");
                  }}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors"
                  style={{ color: "var(--claude-muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--claude-text-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--claude-muted)")}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset to defaults
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen(false);
                    setKeySwitcherOpen(false);
                  }}
                  className="h-9 px-5 rounded-lg text-[13px] font-medium transition-colors"
                  style={{
                    background: "var(--claude-accent)",
                    color: "white",
                    boxShadow: "0 2px 8px -2px var(--claude-accent)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--claude-accent-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--claude-accent)")}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {pasteModalOpen && (
        <>
          <div
            onClick={() => !pasting && setPasteModalOpen(false)}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(20, 20, 18, 0.35)" }}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="w-full max-w-lg rounded-xl shadow-2xl flex flex-col"
              style={{
                background: "var(--claude-bg)",
                border: "1px solid var(--claude-border)",
                maxHeight: "80vh",
              }}
            >
              <div
                className="h-14 px-5 flex items-center justify-between border-b flex-shrink-0"
                style={{ borderColor: "var(--claude-border)" }}
              >
                <span
                  className="text-[14px] font-semibold"
                  style={{ color: "var(--claude-text)" }}
                >
                  Paste text as a source
                </span>
                <button
                  type="button"
                  onClick={() => !pasting && setPasteModalOpen(false)}
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
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  placeholder="Title (optional)"
                  className="w-full h-9 px-3 rounded-lg text-[13px] outline-none"
                  style={{
                    background: "var(--claude-surface)",
                    border: "1px solid var(--claude-border-strong)",
                    color: "var(--claude-text)",
                  }}
                />
                <textarea
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  placeholder="Paste or type text content here…"
                  rows={10}
                  className="w-full px-3 py-2 rounded-lg text-[13px] leading-relaxed outline-none resize-none"
                  style={{
                    background: "var(--claude-surface)",
                    border: "1px solid var(--claude-border-strong)",
                    color: "var(--claude-text)",
                  }}
                />
              </div>
              <div
                className="px-5 py-3 border-t flex-shrink-0 flex justify-end gap-2"
                style={{ borderColor: "var(--claude-border)" }}
              >
                <button
                  type="button"
                  onClick={() => setPasteModalOpen(false)}
                  disabled={pasting}
                  className="h-9 px-4 rounded-lg text-[13px] font-medium transition-colors"
                  style={{
                    background: "var(--claude-surface)",
                    border: "1px solid var(--claude-border-strong)",
                    color: "var(--claude-text-2)",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePasteSubmit}
                  disabled={pasting || !pasteContent.trim()}
                  className="h-9 px-4 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-50"
                  style={{ background: "var(--claude-accent)", color: "white" }}
                >
                  {pasting ? "Adding…" : "Add as source"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
