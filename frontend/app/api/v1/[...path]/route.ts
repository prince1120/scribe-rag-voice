// Streaming proxy from /api/v1/* on the Next frontend to the FastAPI backend.
// Next's `rewrites` config buffers SSE responses in dev, so we pipe the
// response stream manually here. Works for uploads, deletes, JSON queries,
// SSE streaming queries, and binary file serving.

import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND = process.env.BACKEND_ORIGIN || "http://127.0.0.1:8000";
// Server-side only — never sent to the browser. Set this to match the
// backend's API_KEY once auth is enabled there.
const BACKEND_API_KEY = process.env.BACKEND_API_KEY || "";

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

// Routes the voice worker calls server-to-server. They accept a tenant_id
// from the caller, so they must never be reachable from a browser — this
// proxy is public and attaches BACKEND_API_KEY to every request, which would
// otherwise authenticate an anonymous visitor straight into them. The backend
// also guards these with a separate internal key; this is the second lock.
const INTERNAL_ONLY_PATHS = new Set(["voice/retrieve", "voice/history"]);

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const { path } = await ctx.params;
  const joined = (path || []).join("/");

  if (INTERNAL_ONLY_PATHS.has(joined)) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const search = new URL(req.url).search;
  const upstream = `${BACKEND}/api/v1/${joined}${search}`;

  const headers = new Headers();
  for (const [k, v] of req.headers.entries()) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
  }
  if (BACKEND_API_KEY) {
    headers.set("X-API-Key", BACKEND_API_KEY);
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    cache: "no-store",
    redirect: "manual",
  };

  // Forward request body for methods that have one. Streaming the request
  // body needs `duplex: "half"` in Node fetch.
  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = req.body;
    init.duplex = "half";
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstream, init);
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "Backend unreachable",
        detail: (e as Error).message,
        upstream,
      }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  // Copy response headers, dropping hop-by-hop ones. Most importantly we
  // pass through `content-type` so SSE (`text/event-stream`) is preserved.
  const respHeaders = new Headers();
  for (const [k, v] of upstreamResponse.headers.entries()) {
    // set-cookie is handled below: iterating entries() joins duplicates into
    // one comma-separated string, which browsers reject.
    if (k.toLowerCase() === "set-cookie") continue;
    if (!HOP_BY_HOP.has(k.toLowerCase())) respHeaders.set(k, v);
  }
  // The session cookie is minted by the backend and must reach the browser
  // intact, or login silently succeeds and then every later request is 401.
  for (const cookie of upstreamResponse.headers.getSetCookie()) {
    respHeaders.append("set-cookie", cookie);
  }
  // Discourage any intermediate buffering of SSE.
  respHeaders.set("cache-control", "no-cache, no-transform");
  respHeaders.set("x-accel-buffering", "no");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: respHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
