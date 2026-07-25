import type { NextConfig } from "next";

// Hosts allowed to access /_next/* dev assets when not on localhost
// (ngrok, ip:port from another device, etc). Set ALLOWED_DEV_ORIGINS
// as a comma-separated list, or just hardcode below.
const envOrigins = (process.env.ALLOWED_DEV_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Produces a minimal .next/standalone server for the Docker image.
  output: "standalone",

  // NOTE: Streaming proxy lives in app/api/v1/[...path]/route.ts because
  // Next dev `rewrites` buffer SSE responses, breaking token streaming.
  // The route handler reads BACKEND_ORIGIN from the same env var.

  // Allow ngrok / LAN IP / etc to load Next dev assets (HMR, _next/*).
  // ngrok-free URLs rotate per session — add yours via env var:
  //   $env:ALLOWED_DEV_ORIGINS = "abcd-1234.ngrok-free.app"
  //   npm run dev
  allowedDevOrigins: [
    // Wildcards (supported in newer Next.js versions)
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
    "*.trycloudflare.com",
    // Explicit fallback — current ngrok URL
    "58c1-223-178-214-156.ngrok-free.app",
    // LAN addresses, for testing on a phone over the same Wi-Fi. Without the
    // host here Next blocks /_next/* and HMR, so the page server-renders but
    // never hydrates — it sits on the loading state forever, which looks like
    // a hung app rather than a blocked asset.
    "172.23.101.186",
    "192.168.*.*",
    "172.16.*.*",
    "172.23.*.*",
    "10.*.*.*",
    ...envOrigins,
  ],
};

export default nextConfig;