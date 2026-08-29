"use client";

// Public Business Directory & Agent Hub.
// Visitors browse active businesses and immediately connect via voice call or text chat.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Building2,
  Check,
  Copy,
  MessageSquare,
  Phone,
  Search,
  Sparkles,
} from "lucide-react";
import { ScribeMark } from "../Logo";

interface AgentCard {
  handle: string;
  business_name: string;
  business_category: string;
  agent_name: string;
  greeting: string;
  language: string;
  voice_id: string;
  has_voice: boolean;
  has_chat: boolean;
  deployed_at: string | null;
}

function browserId(): string {
  const KEY = "app_client_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export default function DirectoryPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Connect modal state
  const [connectModalAgent, setConnectModalAgent] = useState<AgentCard | null>(null);
  const [connectMode, setConnectMode] = useState<"voice" | "chat">("voice");
  const [callerName, setCallerName] = useState("");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [generatedLink, setGeneratedLink] = useState<{ url: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadAgents() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/v1/directory/agents");
        if (!res.ok) {
          throw new Error("Failed to load business directory.");
        }
        const data = await res.json();
        if (!cancelled) {
          const list: AgentCard[] = data.agents || [];
          setAgents(list);

          if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            const targetHandle = params.get("handle") || params.get("agent");
            if (targetHandle) {
              const matched = list.find((a) => a.handle === targetHandle);
              if (matched) {
                setConnectModalAgent(matched);
                setConnectMode("voice");
              }
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load directory.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadAgents();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = [
    "all",
    ...Array.from(new Set(agents.map((a) => a.business_category.toLowerCase()))).filter(Boolean),
  ];

  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      !search ||
      agent.business_name.toLowerCase().includes(search.toLowerCase()) ||
      agent.agent_name.toLowerCase().includes(search.toLowerCase()) ||
      agent.greeting.toLowerCase().includes(search.toLowerCase()) ||
      agent.business_category.toLowerCase().includes(search.toLowerCase());

    const matchesCategory =
      selectedCategory === "all" ||
      agent.business_category.toLowerCase() === selectedCategory.toLowerCase();

    return matchesSearch && matchesCategory;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedName = localStorage.getItem("directory_caller_name");
      if (savedName) setCallerName(savedName);
    }
  }, []);

  const handleConnect = async (agent: AgentCard, mode: "voice" | "chat") => {
    if (!callerName.trim()) {
      setError("Please enter your name.");
      return;
    }
    setConnectingId(agent.handle);
    setError("");
    const finalName = callerName.trim();
    if (typeof window !== "undefined") {
      localStorage.setItem("directory_caller_name", finalName);
    }

    try {
      const res = await fetch("/api/v1/directory/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": browserId(),
        },
        body: JSON.stringify({
          handle: agent.handle,
          name: finalName,
          mode,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not connect to this assistant.");
      }

      const data = await res.json();
      if (data.token) {
        const fullUrl = `${window.location.origin}/t/${data.token}`;
        setGeneratedLink({ url: fullUrl, token: data.token });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect.");
    } finally {
      setConnectingId(null);
    }
  };

  const copyLink = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col font-sans"
      style={{ background: "var(--claude-bg)", color: "var(--claude-text)" }}
    >
      {/* Top Header */}
      <header
        className="sticky top-0 z-20 border-b backdrop-blur-md px-4 sm:px-8 py-3 flex items-center justify-between"
        style={{
          borderColor: "var(--claude-border)",
          background: "rgba(240, 238, 230, 0.85)",
        }}
      >
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 group">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center border shadow-xs transition-transform group-hover:scale-105"
              style={{
                background: "var(--claude-surface)",
                borderColor: "var(--claude-border)",
                color: "var(--claude-accent)",
              }}
            >
              <ScribeMark className="w-5 h-5" />
            </div>
            <span
              className="font-serif-display font-semibold text-lg tracking-tight"
              style={{ color: "var(--claude-text)" }}
            >
              Scribe
            </span>
          </Link>
          <span
            className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border"
            style={{
              borderColor: "var(--claude-border)",
              background: "var(--claude-surface)",
              color: "var(--claude-muted)",
            }}
          >
            Directory
          </span>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/signin"
            className="text-xs font-medium px-3.5 py-1.5 rounded-lg text-white transition-opacity hover:opacity-90 shadow-xs"
            style={{ background: "var(--claude-accent)" }}
          >
            Business Sign In →
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="px-4 sm:px-8 pt-10 pb-8 max-w-5xl mx-auto w-full text-center">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-4 border"
          style={{
            borderColor: "var(--claude-border)",
            background: "var(--claude-surface)",
            color: "var(--claude-accent)",
          }}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Live Business Assistants</span>
        </div>

        <h1
          className="font-serif-display text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-3"
          style={{ color: "var(--claude-text)" }}
        >
          Talk to a Business Assistant
        </h1>
        <p
          className="text-sm sm:text-base max-w-2xl mx-auto mb-8"
          style={{ color: "var(--claude-muted)", lineHeight: 1.6 }}
        >
          Browse active businesses using Scribe. Choose any assistant below to start a live, spoken
          voice call or text chat grounded in their verified services and documents.
        </p>

        {/* Search & Filter Bar */}
        <div className="max-w-2xl mx-auto flex flex-col gap-3">
          <div
            className="flex items-center gap-2 rounded-xl border px-3.5 py-2.5 shadow-xs"
            style={{
              borderColor: "var(--claude-border)",
              background: "var(--claude-surface)",
            }}
          >
            <Search className="w-4 h-4" style={{ color: "var(--claude-muted)" }} />
            <input
              type="text"
              placeholder="Search by business name, doctor, clinic, or service…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent border-none outline-none text-sm placeholder:text-[var(--claude-muted)]"
              style={{ color: "var(--claude-text)" }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="text-xs px-1.5 py-0.5 rounded text-[var(--claude-muted)] hover:text-[var(--claude-text)]"
              >
                Clear
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 justify-center scrollbar-none">
            {categories.map((cat) => {
              const label = cat === "all" ? "All Categories" : cat.charAt(0).toUpperCase() + cat.slice(1);
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-xs font-medium px-3.5 py-1.5 rounded-full border transition-all cursor-pointer whitespace-nowrap ${
                    isActive
                      ? "border-[var(--claude-accent)] bg-[var(--claude-accent-soft)] text-[var(--claude-accent)] font-semibold shadow-xs"
                      : "border-[var(--claude-border)] bg-[var(--claude-surface)] text-[var(--claude-text-2)] hover:border-[var(--claude-border-strong)]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Directory Grid */}
      <main className="px-4 sm:px-8 pb-16 max-w-5xl mx-auto w-full flex-1">
        {error && (
          <div
            className="p-4 rounded-xl border mb-6 text-center text-xs font-medium"
            style={{
              borderColor: "var(--color-danger-soft)",
              background: "var(--color-danger-soft)",
              color: "var(--color-danger)",
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-2xl border p-5 flex flex-col gap-4 animate-pulse"
                style={{
                  borderColor: "var(--claude-border)",
                  background: "var(--claude-surface)",
                }}
              >
                <div className="h-4 bg-[var(--claude-border)] rounded w-1/3" />
                <div className="h-6 bg-[var(--claude-border)] rounded w-3/4" />
                <div className="h-12 bg-[var(--claude-border)] rounded w-full" />
                <div className="h-9 bg-[var(--claude-border)] rounded w-full mt-auto" />
              </div>
            ))}
          </div>
        ) : filteredAgents.length === 0 ? (
          <div
            className="rounded-2xl border p-12 text-center max-w-lg mx-auto flex flex-col items-center gap-3"
            style={{
              borderColor: "var(--claude-border)",
              background: "var(--claude-surface)",
            }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: "var(--claude-surface-2)", color: "var(--claude-muted)" }}
            >
              <Building2 className="w-6 h-6" />
            </div>
            <h3 className="font-serif-display font-semibold text-lg" style={{ color: "var(--claude-text)" }}>
              No Assistants Found
            </h3>
            <p className="text-xs" style={{ color: "var(--claude-muted)", lineHeight: 1.5 }}>
              {search || selectedCategory !== "all"
                ? "No assistants match your search query or selected category. Try a different search term or clear the filter."
                : "No business assistants are currently active. Please check back soon!"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAgents.map((agent) => {
              const isConnecting = connectingId === agent.handle;
              return (
                <div
                  key={agent.handle}
                  className="rounded-2xl border p-5 flex flex-col justify-between transition-all hover:shadow-md hover:border-[var(--claude-border-strong)]"
                  style={{
                    borderColor: "var(--claude-border)",
                    background: "var(--claude-surface)",
                  }}
                >
                  <div>
                    {/* Header: Category & Live Indicator */}
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <span
                        className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md"
                        style={{
                          background: "var(--claude-surface-2)",
                          color: "var(--claude-muted)",
                        }}
                      >
                        {agent.business_category || "Business"}
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Live
                      </span>
                    </div>

                    {/* Business Name */}
                    <h2
                      className="font-serif-display text-lg font-bold tracking-tight mb-1"
                      style={{ color: "var(--claude-text)" }}
                    >
                      {agent.business_name}
                    </h2>

                    {/* Assistant Persona Tag */}
                    <p className="text-xs font-medium mb-3" style={{ color: "var(--claude-accent)" }}>
                      Assistant: <span className="font-semibold">{agent.agent_name}</span>
                    </p>

                    {/* Greeting Preview */}
                    <div
                      className="rounded-xl p-3 text-xs mb-4 italic"
                      style={{
                        background: "var(--claude-bg)",
                        color: "var(--claude-text-2)",
                        border: "1px solid var(--claude-border)",
                        lineHeight: 1.5,
                      }}
                    >
                      "{agent.greeting}"
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 pt-2 border-t" style={{ borderColor: "var(--claude-border)" }}>
                    {agent.has_voice && (
                      <button
                        type="button"
                        onClick={() => {
                          setConnectModalAgent(agent);
                          setConnectMode("voice");
                          setGeneratedLink(null);
                        }}
                        disabled={isConnecting}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-semibold text-white shadow-xs transition-opacity hover:opacity-95 cursor-pointer disabled:opacity-50"
                        style={{ background: "var(--claude-accent)" }}
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>{isConnecting && connectMode === "voice" ? "Connecting…" : "Talk via Voice Call"}</span>
                      </button>
                    )}

                    {agent.has_chat && (
                      <button
                        type="button"
                        onClick={() => {
                          setConnectModalAgent(agent);
                          setConnectMode("chat");
                          setGeneratedLink(null);
                        }}
                        disabled={isConnecting}
                        className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-medium border transition-colors hover:border-[var(--claude-border-strong)] cursor-pointer ${
                          !agent.has_voice ? "text-white font-semibold shadow-xs" : ""
                        }`}
                        style={{
                          borderColor: !agent.has_voice ? "transparent" : "var(--claude-border)",
                          background: !agent.has_voice ? "var(--claude-accent)" : "var(--claude-surface)",
                          color: !agent.has_voice ? "var(--claude-surface)" : "var(--claude-text-2)",
                        }}
                      >
                        <MessageSquare className="w-3.5 h-3.5" style={{ color: !agent.has_voice ? "var(--claude-surface)" : "var(--claude-muted)" }} />
                        <span>{isConnecting && connectMode === "chat" ? "Connecting…" : "Chat via Text"}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Quick Connect Modal */}
      {connectModalAgent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(20, 20, 18, 0.45)", backdropFilter: "blur(4px)" }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border p-6 flex flex-col gap-4 shadow-xl animate-scale"
            style={{
              borderColor: "var(--claude-border)",
              background: "var(--claude-surface)",
            }}
          >
            <div className="flex items-center justify-between">
              <span
                className="text-[11px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full"
                style={{ background: "var(--claude-accent-soft)", color: "var(--claude-accent)" }}
              >
                {connectMode === "voice" ? "Voice Call" : "Text Chat"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setConnectModalAgent(null);
                  setGeneratedLink(null);
                }}
                className="text-sm font-semibold text-[var(--claude-muted)] hover:text-[var(--claude-text)] cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div>
              <h3 className="font-serif-display text-lg font-bold" style={{ color: "var(--claude-text)" }}>
                Connect to {connectModalAgent.business_name}
              </h3>
              <p className="text-xs mt-1" style={{ color: "var(--claude-muted)", lineHeight: 1.5 }}>
                Connecting to assistant <span className="font-medium text-[var(--claude-text)]">{connectModalAgent.agent_name}</span>.
              </p>
            </div>

            {!generatedLink ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold" style={{ color: "var(--claude-text)" }}>
                    Your Name <span style={{ color: "var(--color-danger)" }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={callerName}
                    onChange={(e) => setCallerName(e.target.value)}
                    placeholder="Rahul Sharma"
                    required
                    maxLength={80}
                    className="rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-[var(--claude-accent)] focus:ring-2 focus:ring-[var(--claude-accent-soft)]"
                    style={{
                      borderColor: "var(--claude-border)",
                      background: "var(--claude-bg)",
                      color: "var(--claude-text)",
                    }}
                    autoFocus
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => void handleConnect(connectModalAgent, connectMode)}
                    disabled={connectingId !== null || !callerName.trim()}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: "var(--claude-accent)" }}
                  >
                    {connectingId !== null ? "Creating session…" : `Connect & Start ${connectMode === "voice" ? "Call" : "Chat"} →`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConnectModalAgent(null)}
                    className="py-2.5 px-4 rounded-xl text-xs font-medium border cursor-pointer"
                    style={{
                      borderColor: "var(--claude-border)",
                      background: "var(--claude-bg)",
                      color: "var(--claude-muted)",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3 pt-1">
                <div
                  className="rounded-xl p-3 border text-xs flex flex-col gap-1.5"
                  style={{ borderColor: "var(--claude-border)", background: "var(--claude-bg)" }}
                >
                  <span className="text-[11px] font-semibold text-[var(--claude-muted)]">Your Direct Link:</span>
                  <span className="font-mono text-[11px] break-all select-all" style={{ color: "var(--claude-text)" }}>
                    {generatedLink.url}
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => router.push(`/t/${generatedLink.token}`)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-semibold text-white shadow-sm cursor-pointer"
                    style={{ background: "var(--claude-accent)" }}
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Start Voice Call Now →</span>
                  </button>

                  <button
                    type="button"
                    onClick={copyLink}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium border cursor-pointer hover:border-[var(--claude-border-strong)]"
                    style={{
                      borderColor: "var(--claude-border)",
                      background: "var(--claude-surface)",
                      color: "var(--claude-text-2)",
                    }}
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-[var(--claude-muted)]" />}
                    <span>{copied ? "Link Copied to Clipboard!" : "Copy Call Link to Use Anywhere"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer
        className="border-t py-6 px-4 sm:px-8 text-center text-xs"
        style={{ borderColor: "var(--claude-border)", color: "var(--claude-muted)" }}
      >
        <p>Scribe AI Assistants — Grounded, low-latency communication for businesses and creators.</p>
      </footer>
    </div>
  );
}
