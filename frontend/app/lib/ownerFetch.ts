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
export function ownerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...init,
    credentials: "include",
    headers: { ...ownerHeaders(), ...(init.headers as Record<string, string>) },
  });
}
