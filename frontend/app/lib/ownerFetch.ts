// Every console request, identified.
//
// A workspace is identified by the API keys its owner brought — the tenant id
// is derived from them server-side. The console pages were sending only the
// session cookie, so the server could not tell which workspace was asking and
// resolved a different one: a workspace with no saved keys, which is why
// "Add your Groq API key in Account" kept appearing after the keys had been
// saved.
//
// This is the same omission that hid the Personal/Business question, so it
// lives in one place now rather than being remembered per call site.

const GROQ_KEY = "demo_groq_key";
const SARVAM_KEY = "demo_sarvam_key";
const CLIENT_ID = "app_client_id";

const pendingReads = new Map<string, Promise<Response>>();
const referenceReads = new Map<string, { expires: number; response: Response }>();
const REFERENCE_PATHS = new Set([
  "/api/v1/voice/speakers", "/api/v1/voice/languages", "/api/v1/workspace/categories",
]);
let requestGeneration = 0;
const PAGE_PATHS = new Set(["/api/v1/contacts", "/api/v1/contacts/overview", "/api/v1/workspace/agents", "/api/v1/calendar/services", "/api/v1/calendar/availability", "/api/v1/calendar/bookings", "/api/v1/calendar/reports", "/api/v1/calendar/notifications"]);

/** Clear response reuse when the account changes or business data is edited. */
export function clearOwnerRequests() {
  requestGeneration += 1;
  pendingReads.clear();
  referenceReads.clear();
}

/** Identity headers for the current browser, or nothing on the server. */
export function ownerHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};

  const headers: Record<string, string> = {};
  const groq = localStorage.getItem(GROQ_KEY);
  const sarvam = localStorage.getItem(SARVAM_KEY);
  const clientId = localStorage.getItem(CLIENT_ID);

  if (groq) headers["X-User-Groq-Key"] = groq;
  if (sarvam) headers["X-User-Sarvam-Key"] = sarvam;
  if (clientId) headers["X-Client-Id"] = clientId;
  return headers;
}

/**
 * `fetch` for console screens.
 *
 * Always sends credentials — an owner who signed in with a password is
 * identified by cookie — *and* the key headers, since an owner who arrived
 * with keys is identified by those. Whichever applies, the server sees it.
 */
export async function ownerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(ownerHeaders());
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  const method = (init.method || "GET").toUpperCase();
  const options: RequestInit = {
    ...init,
    credentials: "include",
    headers,
  };
  if (method !== "GET") {
    clearOwnerRequests();
    try { return await fetch(path, options); }
    finally { clearOwnerRequests(); }
  }
  // Abortable reads belong to their caller; sharing their cancellation would
  // unexpectedly cancel another screen's request. Explicit cache policy wins.
  if (typeof window === "undefined" || init.signal || init.cache || init.body) {
    return fetch(path, options);
  }
  const generation = requestGeneration;
  const key = JSON.stringify([path, Array.from(headers.entries()), generation]);
  const cached = referenceReads.get(key);
  if (cached && cached.expires > Date.now()) return cached.response.clone();
  referenceReads.delete(key);
  let pending = pendingReads.get(key);
  if (!pending) {
    pending = fetch(path, options).then(async (response) => {
      // Buffer the small shared JSON payload once so simultaneous callers can
      // consume independent responses without competing for the same stream.
      if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const result = new Response(await response.arrayBuffer(), {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
        if (generation === requestGeneration && (REFERENCE_PATHS.has(path) || PAGE_PATHS.has(path))) {
          if (referenceReads.size >= 32) referenceReads.delete(referenceReads.keys().next().value!);
          referenceReads.set(key, { expires: Date.now() + (REFERENCE_PATHS.has(path) ? 60_000 : 10_000), response: result.clone() });
        }
        return result;
      }
      return response;
    });
    pendingReads.set(key, pending);
  }
  try { return (await pending).clone(); }
  finally { if (pendingReads.get(key) === pending) pendingReads.delete(key); }
}
