"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function DynamicLinkRedirect() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();

  useEffect(() => {
    const slug = params?.slug;
    if (!slug) {
      router.replace("/directory");
      return;
    }

    // Redirect directly to directory with agent handle
    router.replace(`/directory?handle=${encodeURIComponent(slug)}`);
  }, [params, router]);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center font-sans"
      style={{ background: "var(--claude-bg)", color: "var(--claude-text)" }}
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "var(--claude-accent)", borderTopColor: "transparent" }}
        />
        <p className="text-xs font-medium" style={{ color: "var(--claude-muted)" }}>
          Connecting to assistant…
        </p>
      </div>
    </div>
  );
}
