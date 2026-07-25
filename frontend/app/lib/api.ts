// One typed entry point for every backend call.
//
// Previously each surface built its own fetch inline, so error handling,
// demo-key headers, and credential mode were re-implemented per call site and
// drifted. Centralising them means a fix — a new header, a changed auth rule —
// happens once.
//
// Transport only: no React, no state. Hooks compose on top of this.

export const API_BASE = "/api/v1";

export interface DocumentSummary {
  document_id: string;
  filename: string;
  status: string;
  chunk_count: number;
  message?: string;
}

export interface Citation {
  document_id: string;
  filename: string;
  chunk_id: string;
  page_number?: number | null;
  chunk_index?: number | null;
  score: number;
  snippet: string;
  content: string;
  display_number?: string;
}

export interface QueryMetrics {
  retrieval_ms: number;
  ttft_ms: number;
  total_ms: number;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  citations?: Citation[] | null;
}

export interface Conversation {
  conversation_id: string;
  tenant_id: string;
  messages: ConversationMessage[];
  created_at: string;
  updated_at: string;
}

/** Thrown for any non-2xx response. `status` lets callers branch on 401
 *  (re-lock the UI) or 429 (back off) without parsing message text. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

/** Per-visitor credentials for demo mode. The owner's session travels as an
 *  HttpOnly cookie instead and is never readable here. */
export interface DemoCredentials {
  groqKey?: string | null;
  sarvamKey?: string | null;
  clientId?: string | null;
  customLlmBaseUrl?: string | null;
  customLlmKey?: string | null;
}

function demoHeaders(creds?: DemoCredentials): Record<string, string> {
  if (!creds) return {};
  const headers: Record<string, string> = {};
  if (creds.groqKey) headers["X-User-Groq-Key"] = creds.groqKey;
  if (creds.sarvamKey) headers["X-User-Sarvam-Key"] = creds.sarvamKey;
  if (creds.clientId) headers["X-Client-Id"] = creds.clientId;
  if (creds.customLlmBaseUrl) headers["X-Custom-LLM-Base-URL"] = creds.customLlmBaseUrl;
  if (creds.customLlmKey) headers["X-Custom-LLM-Key"] = creds.customLlmKey;
  return headers;
}

async function toApiError(response: Response): Promise<ApiError> {
  // FastAPI puts the human-readable reason in `detail`; fall back to the
  // status text so an HTML error page never surfaces as the message.
  let detail = response.statusText || "Request failed";
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") detail = body.detail;
    else if (typeof body?.error === "string") detail = body.error;
  } catch {
    /* non-JSON error body — keep the status text */
  }
  return new ApiError(response.status, detail);
}

export async function request<T>(
  path: string,
  init: RequestInit & { creds?: DemoCredentials } = {}
): Promise<T> {
  const { creds, headers, ...rest } = init;
  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    // The owner's identity is an HttpOnly cookie, so it only travels when
    // credentials are included. Omitting this is a silent 401 on every call.
    credentials: "include",
    headers: { ...demoHeaders(creds), ...(headers as Record<string, string>) },
  });

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ---- Session ---------------------------------------------------------------

export const session = {
  config: () => request<{ gate_enabled: boolean }>("/session/config"),
  status: () =>
    request<{ authenticated: boolean; is_owner: boolean; gate_enabled: boolean }>(
      "/session"
    ),
  login: (passcode: string) =>
    request<{ authenticated: boolean }>("/session/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    }),
  logout: () => request<{ status: string }>("/session/logout", { method: "POST" }),
};

// ---- Documents -------------------------------------------------------------

export const documents = {
  list: (creds?: DemoCredentials) =>
    request<DocumentSummary[]>("/documents", { creds }),

  upload: (file: File, creds?: DemoCredentials) => {
    const form = new FormData();
    form.append("file", file);
    // Content-Type is deliberately unset: the browser must add the multipart
    // boundary itself, and setting it manually corrupts the request.
    return request<DocumentSummary>("/documents/upload", {
      method: "POST",
      body: form,
      creds,
    });
  },

  paste: (title: string, content: string, creds?: DemoCredentials) =>
    request<DocumentSummary>("/documents/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
      creds,
    }),

  remove: (documentId: string, creds?: DemoCredentials) =>
    request<{ status: string }>(`/documents/${encodeURIComponent(documentId)}`, {
      method: "DELETE",
      creds,
    }),

  content: (documentId: string, creds?: DemoCredentials) =>
    request<{
      document_id: string;
      filename: string;
      content: string;
      editable: boolean;
      is_image: boolean;
    }>(`/documents/${encodeURIComponent(documentId)}/content`, { creds }),

  saveContent: (documentId: string, content: string, creds?: DemoCredentials) =>
    request<DocumentSummary>(`/documents/${encodeURIComponent(documentId)}/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      creds,
    }),

  fileUrl: (documentId: string) =>
    `${API_BASE}/documents/${encodeURIComponent(documentId)}/file`,
};

// ---- Conversations ---------------------------------------------------------

export const conversations = {
  list: (creds?: DemoCredentials) => request<Conversation[]>("/conversations", { creds }),
  create: (creds?: DemoCredentials) =>
    request<{ conversation_id: string }>("/conversations", { method: "POST", creds }),
};

// ---- Chat streaming --------------------------------------------------------

export interface StreamHandlers {
  onToken: (text: string) => void;
  onCitations?: (citations: Citation[]) => void;
  onMetrics?: (metrics: QueryMetrics) => void;
  onError?: (message: string) => void;
}

export interface StreamOptions {
  query: string;
  conversationId?: string | null;
  documentIds?: string[] | null;
  model?: string | null;
  temperature?: number | null;
  topK?: number | null;
  attachedImages?: string[] | null;
  creds?: DemoCredentials;
  signal?: AbortSignal;
}

/**
 * Consume the SSE chat stream.
 *
 * Frames arrive as `data: {...}` and are parsed for one of four shapes:
 * `text` (a token), `annotations` (citations), `metrics`, or `error`. Buffering
 * matters — a chunk boundary can land mid-frame, and parsing per-chunk instead
 * of per-complete-line drops tokens at exactly those boundaries.
 */
export async function streamQuery(
  options: StreamOptions,
  handlers: StreamHandlers
): Promise<void> {
  const response = await fetch(`${API_BASE}/query/stream`, {
    method: "POST",
    credentials: "include",
    signal: options.signal,
    headers: { "Content-Type": "application/json", ...demoHeaders(options.creds) },
    body: JSON.stringify({
      query: options.query,
      conversation_id: options.conversationId ?? undefined,
      document_ids: options.documentIds ?? undefined,
      model: options.model ?? undefined,
      temperature: options.temperature ?? undefined,
      top_k: options.topK ?? undefined,
      attached_images: options.attachedImages ?? undefined,
    }),
  });

  if (!response.ok) throw await toApiError(response);
  if (!response.body) throw new ApiError(502, "No response stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // The trailing element may be a partial line; hold it for the next read.
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const frame = JSON.parse(payload);
          if (typeof frame.text === "string") handlers.onToken(frame.text);
          else if (frame.annotations) handlers.onCitations?.(frame.annotations);
          else if (frame.metrics) handlers.onMetrics?.(frame.metrics);
          else if (frame.error) handlers.onError?.(String(frame.error));
        } catch {
          // A malformed frame should not abort a stream that is otherwise
          // delivering tokens.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
