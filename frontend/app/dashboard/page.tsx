"use client";

// Owner dashboard: Session metrics, Voice vs Chat breakdown,
// paginated recent conversations with agent attribution and instant transcript modal.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Bot,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  MessageCircle,
  MessageSquare,
  Mic,
  Phone,
  RefreshCw,
  Sparkles,
  Users,
  X,
} from "lucide-react";

import { ownerFetch } from "../lib/ownerFetch";
import { OwnerShell } from "../components/owner/OwnerShell";
import { UsageCard } from "../components/owner/UsageCard";

interface SessionItem {
  session_id: string;
  contact_id: string;
  name: string;
  channel: string;
  started_at?: string | null;
  message_count?: number;
  has_transcript?: boolean;
  agent_name?: string;
  business_name?: string;
}

interface OverviewData {
  totals: {
    total_sessions: number;
    conversations: number;
    conversations_this_week: number;
    voice_calls: number;
    chat_sessions: number;
    people: number;
    unique_users: number;
    active_people: number;
    agent_name?: string;
    business_name?: string;
  };
  recent: SessionItem[];
}

interface TranscriptTurn {
  role: string;
  content: string;
  at?: string | null;
}

function formatWhen(value?: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeTime(value?: string | null): string {
  if (!value) return "";
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

import { getWorkspaceCache, setWorkspaceCache, useWorkspace } from "../lib/workspaceCache";

const ITEMS_PER_PAGE = 5;

export default function DashboardPage() {
  const ws = useWorkspace();

  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  // Transcript drawer modal
  const [activeSession, setActiveSession] = useState<SessionItem | null>(null);
  const [transcriptTurns, setTranscriptTurns] = useState<TranscriptTurn[]>([]);
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  const fetchOverview = async (opts?: { background?: boolean }) => {
    const isBackground = Boolean(opts?.background && data);
    if (!isBackground) setLoading(true);
    try {
      const overviewRes = await ownerFetch("/api/v1/contacts/overview");
      if (overviewRes.status === 403 || overviewRes.status === 401) {
        setError("Sign in as the owner to view your console.");
        return;
      }
      if (overviewRes.ok) {
        const fresh = await overviewRes.json();
        setData(fresh);
        setWorkspaceCache({ overviewData: fresh });
      }
    } catch {
      if (!data) setError("Could not load dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const cached = getWorkspaceCache();
    if (cached.overviewData) {
      setData(cached.overviewData);
      setLoading(false);
      // Revalidate in background without blocking UI — stale-while-revalidate
      void fetchOverview({ background: true });
      return;
    }
    void fetchOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTranscript = async (session: SessionItem) => {
    setActiveSession(session);
    setLoadingTranscript(true);
    setTranscriptTurns([]);
    try {
      const res = await ownerFetch(
        `/api/v1/contacts/${session.contact_id}/transcript?session_id=${session.session_id}`
      );
      if (res.ok) {
        const body = await res.json();
        setTranscriptTurns(body.messages || []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingTranscript(false);
    }
  };

  const recentList = data?.recent || [];
  const totalPages = Math.max(1, Math.ceil(recentList.length / ITEMS_PER_PAGE));
  const paginatedRecent = recentList.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  return (
    <OwnerShell>
      <main style={S.page} className="dash-page">
        {/* ── Top Header ─────────────────────────────────────── */}
        <header style={S.header} className="dash-header">
          <div>
            <h1 style={S.title}>Workspace Overview</h1>
            <p style={S.subtitle}>
              Real-time call volume, active caller metrics, and conversation history.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }} className="dash-header-actions">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void fetchOverview();
              }}
              style={S.refreshBtn}
              title="Refresh metrics"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              <span>Refresh</span>
            </button>
            <Link href="/directory" target="_blank" style={S.previewBtn}>
              <ExternalLink size={14} />
              <span>Public Directory</span>
            </Link>
          </div>
        </header>

        {error && (
          <div style={S.errorBanner} role="alert">
            {error}
          </div>
        )}

        {/* ── Analytics Stat Cards Grid ────────────────────────── */}
        <div style={S.statsGrid} className="dash-stats-grid">
          {/* Total Conversations */}
          <div style={{ ...S.statCard, background: "var(--claude-surface)", borderColor: "var(--claude-border)" }} className="dash-stat-card">
            <div style={S.statTop}>
              <div style={{ ...S.statIconWrap, background: "var(--claude-surface-2)", color: "var(--claude-accent)" }}>
                <BarChart3 size={18} />
              </div>
              <span style={{ ...S.statValue, color: "var(--claude-text)" }}>
                {data ? data.totals.total_sessions : 0}
              </span>
            </div>
            <span style={S.statLabel}>Total Completed Talks</span>
            <span style={S.statSub}>
              {data ? `${data.totals.conversations_this_week} this week` : "0 this week"}
            </span>
          </div>

          {/* Voice Calls */}
          <div style={{ ...S.statCard, background: "var(--claude-surface)", borderColor: "var(--claude-border)" }} className="dash-stat-card">
            <div style={S.statTop}>
              <div style={{ ...S.statIconWrap, background: "var(--claude-surface-2)", color: "var(--claude-accent)" }}>
                <Phone size={18} />
              </div>
              <span style={{ ...S.statValue, color: "var(--claude-text)" }}>
                {data ? data.totals.voice_calls : 0}
              </span>
            </div>
            <span style={S.statLabel}>Voice Calls Completed</span>
            <span style={S.statSub}>Live audio calls</span>
          </div>

          {/* Chat Conversations */}
          <div style={{ ...S.statCard, background: "var(--claude-surface)", borderColor: "var(--claude-border)" }} className="dash-stat-card">
            <div style={S.statTop}>
              <div style={{ ...S.statIconWrap, background: "var(--claude-surface-2)", color: "var(--claude-accent)" }}>
                <MessageSquare size={18} />
              </div>
              <span style={{ ...S.statValue, color: "var(--claude-text)" }}>
                {data ? data.totals.chat_sessions : 0}
              </span>
            </div>
            <span style={S.statLabel}>Chat Conversations</span>
            <span style={S.statSub}>Text interactions</span>
          </div>

          {/* Unique Callers */}
          <div style={{ ...S.statCard, background: "var(--claude-surface)", borderColor: "var(--claude-border)" }} className="dash-stat-card">
            <div style={S.statTop}>
              <div style={{ ...S.statIconWrap, background: "var(--claude-surface-2)", color: "var(--claude-accent)" }}>
                <Users size={18} />
              </div>
              <span style={{ ...S.statValue, color: "var(--claude-text)" }}>
                {data ? data.totals.unique_users : 0}
              </span>
            </div>
            <span style={S.statLabel}>Unique Callers</span>
            <span style={S.statSub}>Distinct customer contacts</span>
          </div>
        </div>

        {/* ── Main Section: Recent Completed Conversations & Calls ──────── */}
        {/* Spend before activity: a workspace being turned away at its limit
            is more urgent than how many calls it took. */}
        <UsageCard />

        <section style={S.sectionCard} className="dash-section-card">
          <div style={S.sectionHeader} className="dash-section-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={S.sectionIconWrap}>
                <Clock size={16} style={{ color: "var(--claude-accent)" }} />
              </div>
              <div>
                <h2 style={S.sectionTitle}>Completed Conversations & Calls</h2>
                <p style={S.sectionDesc}>
                  Every completed customer talk with agent attribution, dialogue turns, and full transcripts.
                </p>
              </div>
            </div>
            <Link href="/links" style={S.seeAllLink}>
              Manage Callers & Links →
            </Link>
          </div>

          {loading && !data ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", color: "var(--claude-text-2)", fontSize: 13 }}>
                <span className="w-3 h-3 rounded-full border-2 border-[var(--claude-border)] border-t-[var(--claude-accent)] animate-spin" aria-hidden />
                <span>Loading latest analytics…</span>
              </div>
              {[1, 2, 3].map((i) => (
                <div key={i} style={{ ...S.sessionRow, opacity: 0.9 }} className="dash-session-row">
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                    <div className="ds-skeleton" style={{ width: 40, height: 40, borderRadius: 9999 }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                      <div className="ds-skeleton" style={{ width: "42%", height: 14, borderRadius: 6 }} />
                      <div className="ds-skeleton" style={{ width: "28%", height: 10, borderRadius: 6, opacity: 0.7 }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : recentList.length === 0 ? (
            <div style={S.emptyState}>
              <Users size={32} style={{ color: "var(--claude-border-strong)", marginBottom: 8 }} />
              <p style={{ margin: 0, fontWeight: 600 }}>No conversations recorded yet</p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--claude-muted)" }}>
                Start a voice call or chat session from your invite link to view transcripts here.
              </p>
            </div>
          ) : (
            <>
              <div style={S.sessionsList} className="dash-sessions-list">
                {paginatedRecent.map((session, idx) => (
                  <div key={session.session_id || idx} style={S.sessionRow} className="dash-session-row">
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1, minWidth: 0 }} className="dash-session-main">
                      {/* Avatar */}
                      <div
                        style={{
                          ...S.avatar,
                          background: session.channel === "voice" ? "var(--color-danger-soft)" : "var(--claude-accent-soft)",
                          color: session.channel === "voice" ? "var(--color-danger)" : "var(--claude-accent-hover)",
                          border:
                            session.channel === "voice" ? "1px solid var(--color-danger-soft)" : "1px solid var(--claude-border)",
                          marginTop: 2,
                        }}
                      >
                        {initials(session.name || "Guest")}
                      </div>

                      {/* Info */}
                      <div style={S.sessionInfo} className="dash-session-info">
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={S.sessionName}>{session.name || "Guest Caller"}</span>
                          
                          {/* Channel Badge */}
                          <span
                            style={{
                              ...S.channelPill,
                              background: session.channel === "voice" ? "var(--color-danger-soft)" : "var(--claude-accent-soft)",
                              color: session.channel === "voice" ? "#be185d" : "#1d4ed8",
                            }}
                          >
                            {session.channel === "voice" ? (
                              <Mic size={11} />
                            ) : (
                              <MessageSquare size={11} />
                            )}
                            <span>{session.channel === "voice" ? "Voice Call" : "Chat"}</span>
                          </span>

                          {/* Agent & Business Attribution */}
                          <span style={S.agentPill}>
                            <Bot size={11} />
                            <span>{session.agent_name || "Assistant"}</span>
                            <span>•</span>
                            <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {session.business_name || ws.businessName || "Business"}
                            </span>
                          </span>
                        </div>

                        <div style={S.sessionMeta}>
                          <span>{formatWhen(session.started_at)}</span>
                          <span>•</span>
                          <span>{relativeTime(session.started_at)}</span>
                          {typeof session.message_count === "number" && session.message_count > 0 ? (
                            <>
                              <span>•</span>
                              <span style={{ fontWeight: 600, color: "var(--claude-text-2)" }}>
                                {session.message_count} dialogue turns
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Action */}
                    <button
                      type="button"
                      onClick={() => openTranscript(session)}
                      style={S.transcriptBtn}
                      className="dash-transcript-btn"
                    >
                      <MessageCircle size={14} />
                      <span>View Transcript</span>
                    </button>
                  </div>
                ))}
              </div>

              {/* ── Pagination Controls ── */}
              {totalPages > 1 && (
                <div style={S.paginationRow} className="dash-pagination-row">
                  <span style={S.paginationText}>
                    Showing {(page - 1) * ITEMS_PER_PAGE + 1}–
                    {Math.min(page * ITEMS_PER_PAGE, recentList.length)} of {recentList.length} talks
                  </span>

                  <div style={S.paginationBtns}>
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      style={{
                        ...S.pageBtn,
                        opacity: page <= 1 ? 0.4 : 1,
                        cursor: page <= 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      <ChevronLeft size={16} />
                      <span>Previous</span>
                    </button>

                    <span style={S.pageIndicator}>
                      Page {page} of {totalPages}
                    </span>

                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      style={{
                        ...S.pageBtn,
                        opacity: page >= totalPages ? 0.4 : 1,
                        cursor: page >= totalPages ? "not-allowed" : "pointer",
                      }}
                    >
                      <span>Next</span>
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── Slide-over Transcript Drawer Modal ───────────────── */}
        {activeSession && (
          <div style={S.modalBackdrop} onClick={() => setActiveSession(null)}>
            <div style={S.modalContent} onClick={(e) => e.stopPropagation()}>
              <div style={S.modalHeader}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={S.modalTitle}>{activeSession.name}'s Conversation</span>
                    <span
                      style={{
                        ...S.channelPill,
                        background: activeSession.channel === "voice" ? "var(--color-danger-soft)" : "var(--claude-accent-soft)",
                        color: activeSession.channel === "voice" ? "#be185d" : "#1d4ed8",
                      }}
                    >
                      {activeSession.channel === "voice" ? "Voice Call" : "Chat"}
                    </span>
                  </div>
                  <p style={S.modalSub}>
                    {formatWhen(activeSession.started_at)} • Agent: {activeSession.agent_name || "Assistant"} (
                    {activeSession.business_name || ws.businessName || "Business"})
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveSession(null)}
                  style={S.modalClose}
                  aria-label="Close modal"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Transcript Dialogue List */}
              <div style={S.modalBody}>
                {loadingTranscript ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "12px 4px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 14px", background: "var(--claude-bg)", borderRadius: 20, border: "1px solid var(--claude-border)", width: "fit-content", margin: "0 auto 8px", fontSize: 12, color: "var(--claude-muted)", fontWeight: 500 }}>
                      <RefreshCw size={13} className="animate-spin" style={{ color: "var(--claude-accent)" }} />
                      <span>Loading dialogue transcript from database…</span>
                    </div>

                    {/* Turn 1: Assistant Skeleton */}
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", maxWidth: "80%" }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--claude-accent-soft)", flexShrink: 0 }} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                        <div style={{ padding: "12px 16px", borderRadius: "4px 16px 16px 16px", background: "var(--claude-bg)", border: "1px solid var(--claude-surface-2)", display: "flex", flexDirection: "column", gap: 8, width: 240 }}>
                          <div style={{ width: "90%", height: 12, background: "var(--claude-border)", borderRadius: 4 }} />
                          <div style={{ width: "65%", height: 12, background: "var(--claude-border)", borderRadius: 4 }} />
                        </div>
                      </div>
                    </div>

                    {/* Turn 2: User Skeleton */}
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "flex-end", maxWidth: "80%", alignSelf: "flex-end" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", width: "100%" }}>
                        <div style={{ padding: "12px 16px", borderRadius: "16px 4px 16px 16px", background: "var(--claude-accent-soft)", border: "1px solid var(--claude-accent-soft)", display: "flex", flexDirection: "column", gap: 8, width: 190 }}>
                          <div style={{ width: "85%", height: 12, background: "var(--claude-border)", borderRadius: 4 }} />
                        </div>
                      </div>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--claude-accent-soft)", flexShrink: 0 }} />
                    </div>

                    {/* Turn 3: Assistant Skeleton */}
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", maxWidth: "80%" }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--claude-accent-soft)", flexShrink: 0 }} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                        <div style={{ padding: "12px 16px", borderRadius: "4px 16px 16px 16px", background: "var(--claude-bg)", border: "1px solid var(--claude-surface-2)", display: "flex", flexDirection: "column", gap: 8, width: 260 }}>
                          <div style={{ width: "95%", height: 12, background: "var(--claude-border)", borderRadius: 4 }} />
                          <div style={{ width: "70%", height: 12, background: "var(--claude-border)", borderRadius: 4 }} />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : transcriptTurns.length === 0 ? (
                  <div style={S.emptyTranscript}>
                    <p style={{ margin: 0, fontWeight: 600 }}>No recorded turns for this session</p>
                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--claude-muted)" }}>
                      The session connected but had no recorded speech turns.
                    </p>
                  </div>
                ) : (
                  <div style={S.dialogueContainer}>
                    {transcriptTurns.map((turn, i) => {
                      const isUser = turn.role === "user";
                      return (
                        <div
                          key={i}
                          style={{
                            ...S.turnRow,
                            justifyContent: isUser ? "flex-end" : "flex-start",
                          }}
                        >
                          <div
                            style={{
                              ...S.turnBubble,
background: isUser ? "var(--claude-accent)" : "var(--claude-surface)",
                              color: isUser ? "var(--claude-surface)" : "#1e293b",
                              border: isUser ? "none" : "1px solid var(--claude-border)",
                              boxShadow: isUser
                                ? "0 2px 8px rgba(79, 70, 229, 0.25)"
                                : "0 1px 3px rgba(0, 0, 0, 0.05)",
                            }}
                            >
                            <div
                              style={{
                                ...S.turnWho,
                                color: isUser ? "rgba(255,255,255,0.75)" : "var(--claude-accent)",
                              }}
                            >
                              {isUser ? activeSession.name || "Caller" : activeSession.agent_name || "AI Assistant"}
                            </div>
                            <p style={S.turnContent}>{turn.content}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </OwnerShell>
  );
}

/* ─────────────────────────── Styles ─────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: "60rem",
    paddingBottom: 48,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    margin: 0,
    color: "var(--claude-text)",
  },
  subtitle: {
    fontSize: 13,
    color: "var(--claude-muted)",
    marginTop: 4,
    margin: 0,
  },
  refreshBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--claude-border)",
    background: "var(--claude-surface)",
    color: "var(--claude-text)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    boxShadow: "var(--shadow-xs)",
  },
  previewBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    borderRadius: "var(--radius-md)",
    border: "none",
    background: "var(--claude-accent)",
    color: "var(--claude-surface)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    textDecoration: "none",
    boxShadow: "var(--shadow-sm)",
  },
  errorBanner: {
    padding: "12px 16px",
    borderRadius: 10,
    background: "var(--color-danger-soft)",
    border: "1px solid var(--color-danger-soft)",
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: 500,
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14,
  },
  statCard: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "18px 20px",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--claude-border)",
    boxShadow: "var(--shadow-sm)",
  },
  statTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statIconWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  statValue: {
    fontSize: 32,
    fontWeight: 800,
    letterSpacing: "-0.03em",
    fontVariantNumeric: "tabular-nums",
  },
  statLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--claude-text)",
    marginTop: 4,
  },
  statSub: {
    fontSize: 11,
    color: "var(--claude-muted)",
  },
  sectionCard: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: "20px 22px",
    borderRadius: "var(--radius-lg)",
    background: "var(--claude-surface)",
    border: "1px solid var(--claude-border)",
    boxShadow: "var(--shadow-sm)",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
    borderBottom: "1px solid var(--claude-border)",
    paddingBottom: 12,
  },
  sectionIconWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: "var(--radius-md)",
    background: "var(--claude-accent-soft)",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--claude-text)",
    margin: 0,
  },
  sectionDesc: {
    fontSize: 12,
    color: "var(--claude-muted)",
    margin: "2px 0 0",
  },
  seeAllLink: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--claude-accent)",
    textDecoration: "none",
  },
  loadingPlaceholder: {
    textAlign: "center",
    padding: "36px 0",
    color: "var(--claude-muted)",
    fontSize: 13,
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 16px",
    textAlign: "center",
    color: "var(--claude-text-2)",
    background: "var(--claude-surface-2)",
    borderRadius: "var(--radius-lg)",
    border: "1px dashed var(--claude-border-strong)",
  },
  sessionsList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  sessionRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 16px",
    borderRadius: "var(--radius-lg)",
    background: "var(--claude-surface)",
    border: "1px solid var(--claude-border)",
    transition: "all 0.15s ease",
  },
  avatar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    borderRadius: 9999,
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  },
  sessionInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  sessionName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--claude-text)",
  },
  channelPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 7px",
    borderRadius: 9999,
  },
  agentPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 500,
    padding: "2px 8px",
    borderRadius: "var(--radius-sm)",
    background: "var(--claude-surface-2)",
    color: "var(--claude-muted)",
  },
  sessionMeta: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--claude-muted)",
    flexWrap: "wrap",
  },
  transcriptBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--claude-border)",
    background: "var(--claude-surface-2)",
    color: "var(--claude-text)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    flexShrink: 0,
    transition: "all 0.12s",
  },
  paginationRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 12,
    borderTop: "1px solid var(--claude-border)",
    flexWrap: "wrap",
    gap: 10,
  },
  paginationText: {
    fontSize: 12,
    color: "var(--claude-muted)",
  },
  paginationBtns: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  pageBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 12px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--claude-border)",
    background: "var(--claude-surface)",
    color: "var(--claude-text)",
    fontSize: 12,
    fontWeight: 500,
  },
  pageIndicator: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--claude-text)",
  },
  /* Modal Transcript */
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.6)",
    backdropFilter: "blur(4px)",
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalContent: {
    width: "100%",
    maxWidth: "36rem",
    maxHeight: "85vh",
    display: "flex",
    flexDirection: "column",
    background: "var(--claude-surface)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-lg)",
    overflow: "hidden",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: "1px solid var(--claude-border)",
    background: "var(--claude-surface-2)",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--claude-text)",
  },
  modalSub: {
    fontSize: 12,
    color: "var(--claude-muted)",
    margin: "2px 0 0",
  },
  modalClose: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: "var(--radius-md)",
    border: "none",
    background: "var(--claude-border)",
    color: "var(--claude-text-2)",
    cursor: "pointer",
  },
  modalBody: {
    padding: 16,
    overflowY: "auto",
    flex: 1,
    background: "var(--claude-bg)",
  },
  emptyTranscript: {
    textAlign: "center",
    padding: "40px 16px",
    color: "var(--claude-muted)",
  },
  dialogueContainer: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  turnRow: {
    display: "flex",
    width: "100%",
  },
  turnBubble: {
    maxWidth: "80%",
    padding: "10px 14px",
    borderRadius: 14,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  turnWho: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  turnContent: {
    fontSize: 13,
    lineHeight: 1.5,
    margin: 0,
    whiteSpace: "pre-wrap",
  },
};
