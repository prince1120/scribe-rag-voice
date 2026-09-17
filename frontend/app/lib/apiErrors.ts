/**
 * Shared API error handler and sanitization utility for Scribe.
 *
 * Safely parses errors from backend FastAPI responses, Next.js proxy HTML responses,
 * timeouts, and network failures. Never exposes HTML, stack traces, internal URLs,
 * or API keys to the user.
 */

export interface ParsedApiError {
  status: number;
  message: string;
  isTimeout?: boolean;
  isAborted?: boolean;
  code?: string;
}

const SENSITIVE_PATTERNS = [
  /sk-[a-zA-Z0-9_\-]{16,}/gi,
  /gsk_[a-zA-Z0-9_\-]{16,}/gi,
  /Bearer\s+[a-zA-Z0-9_\-\.]+/gi,
  /https?:\/\/[a-zA-Z0-9_\-\.:]+/gi,
  /(\/[a-zA-Z0-9_\-\.]+){3,}/g, // unix paths
  /[A-Za-z]:\\[a-zA-Z0-9_\-\.\\]+/g, // Windows paths
  /Traceback \(most recent call last\):[\s\S]*/gi,
  /<[^>]+>/g, // HTML tags
];

/** Clean and sanitize any error message before showing it to the user. */
export function sanitizeErrorMessage(raw: string): string {
  if (!raw || typeof raw !== "string") return "An unexpected error occurred.";

  // If it contains HTML markup or <!DOCTYPE, it is an HTML error page
  if (raw.includes("<!DOCTYPE") || raw.includes("<html") || raw.includes("<h1>404") || raw.includes("<body")) {
    return "API endpoint not found or backend service is unreachable.";
  }

  let cleaned = raw;
  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length < 3) {
    return "The server encountered an error processing this request.";
  }

  if (cleaned.length > 280) {
    cleaned = cleaned.slice(0, 277) + "...";
  }

  return cleaned;
}

/**
 * Reads and extracts a safe human-readable error message from an HTTP Response.
 */
export async function extractApiErrorMessage(
  response: Response,
  fallbackMessage?: string
): Promise<string> {
  const status = response.status;
  const contentType = response.headers.get("content-type") || "";

  // Handle known standard status codes with appropriate defaults
  const statusFallbacks: Record<number, string> = {
    400: "Invalid request. Please verify the provided details.",
    401: "Authentication required. Please sign in again.",
    403: "Access forbidden or assistant is not deployed.",
    404: "Requested resource or endpoint was not found.",
    409: "A conflict occurred with an existing resource.",
    410: "This resource or access link has expired.",
    429: "Too many requests. Please wait a moment and try again.",
    500: "An internal server error occurred. Please try again.",
    502: "Backend service is currently unavailable. Please try again shortly.",
    503: "Service is temporarily offline or unavailable. Text support remains available.",
    504: "Server request timed out. Please try again in a moment.",
  };

  // Check if server returned HTML (e.g. Next.js 404 or Nginx gateway error)
  if (contentType.includes("text/html")) {
    if (status === 404) {
      return "The requested API route is not available on this server.";
    }
    if (status === 502 || status === 503) {
      return "Backend service is currently offline or unreachable.";
    }
    return statusFallbacks[status] || fallbackMessage || "The server returned an unexpected response.";
  }

  try {
    const text = await response.text();
    if (!text || !text.trim()) {
      return statusFallbacks[status] || fallbackMessage || `Request failed with status ${status}.`;
    }

    try {
      const data = JSON.parse(text);
      if (typeof data.detail === "string" && data.detail.trim()) {
        return sanitizeErrorMessage(data.detail);
      }
      if (typeof data.error === "string" && data.error.trim()) {
        return sanitizeErrorMessage(data.error);
      }
      if (typeof data.message === "string" && data.message.trim()) {
        return sanitizeErrorMessage(data.message);
      }
      if (Array.isArray(data.detail) && data.detail.length > 0) {
        // FastAPI validation errors
        const firstErr = data.detail[0];
        const field = Array.isArray(firstErr.loc) ? firstErr.loc.slice(1).join(".") : "field";
        const msg = firstErr.msg || "Invalid value";
        return sanitizeErrorMessage(`${field ? field + ": " : ""}${msg}`);
      }
    } catch {
      // Not valid JSON
      if (text.includes("<!DOCTYPE") || text.includes("<html")) {
        return statusFallbacks[status] || fallbackMessage || "Unexpected response from server.";
      }
      return sanitizeErrorMessage(text);
    }
  } catch {
    // Response stream could not be read
  }

  return statusFallbacks[status] || fallbackMessage || `Request failed with status ${status}.`;
}

/**
 * Formats any thrown exception (Error, DOMException, ApiError, etc.) into a safe message.
 */
export function formatClientError(
  err: unknown,
  fallbackMessage = "Operation failed. Please try again."
): string {
  if (!err) return fallbackMessage;

  if (err instanceof DOMException && err.name === "AbortError") {
    return "Request was cancelled.";
  }
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return "Request timed out. Please check your connection and try again.";
  }
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.message.toLowerCase().includes("aborted")) {
      return "Request was cancelled.";
    }
    if (err.name === "TimeoutError" || err.message.toLowerCase().includes("timeout")) {
      return "Request timed out. Please check your network connection and try again.";
    }
    if (err.message.toLowerCase().includes("failed to fetch") || err.message.toLowerCase().includes("networkerror")) {
      return "Could not connect to the server. Please ensure the backend is running.";
    }
    return sanitizeErrorMessage(err.message);
  }

  if (typeof err === "string") {
    return sanitizeErrorMessage(err);
  }

  return fallbackMessage;
}
