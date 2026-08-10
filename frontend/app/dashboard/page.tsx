"use client";

import { ownerFetch } from "../lib/ownerFetch";

// The console's front page — the owner's daily overview of assistant activity.
//
// Redesigned with premium card-based layout, responsive grid, icons,
// and clear visual hierarchy. Mobile-first.

import { useEffect, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  MessageCircleQuestion,
  Mic,
  Phone,
  Users,
} from "lucide-react";

import { OwnerShell } from "../components/owner/OwnerShell";

interface Overview {
  totals: {
    people: number;
    active_people: number;
    conversations: number;
    conversations_this_week: number;
    voice_calls: number;
  };
  recent: Array<{
    contact_id: string;
    name: string;
    channel: string;
    started_at?: string | null;
  }>;
  questions: Array<{ text: string; at?: string | null }>;
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

/* ─────────────────────────── Stat Card Colors ──────────────────────────── */
const STAT_THEMES = [
  { bg: "#f0f4ff", accent: "#4f5dca", icon: BarChart3, border: "#dce3f9" },
  { bg: "#f0fdf4", accent: "#16a34a", icon: CalendarDays, border: "#d1f5dc" },
  { bg: "#fdf4ff", accent: "#a855f7", icon: Phone, border: "#edd5f9" },
  { bg: "#fff7ed", accent: "#ea580c", icon: Users, border: "#fddcb5" },
];

/* ─────────────────────────── Component ─────────────────────────────────── */

export default function DashboardPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [workspace, setWorkspace] = useState<{ business_name?: string } | null>(
    null,
  );
  const [agentStatus, setAgentStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [overviewRes, wsRes, agentRes] = await Promise.all([
          ownerFetch("/api/v1/contacts/overview"),
          ownerFetch("/api/v1/workspace"),
          ownerFetch("/api/v1/workspace/agent"),
        ]);

        if (overviewRes.status === 403) {
          setError("Sign in as the owner to see this.");
          return;
        }
        if (overviewRes.ok) setData(await overviewRes.json());
        if (wsRes.ok) setWorkspace(await wsRes.json());
        if (agentRes.ok) setAgentStatus((await agentRes.json()).status);
      } catch {
        setError("Could not load your dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const statItems = data
    ? [
        { label: "Total Conversations", value: data.totals.conversations },
        { label: "This Week", value: data.totals.conversations_this_week },
        { label: "Voice Calls", value: data.totals.voice_calls },
        { label: "People", value: data.totals.active_people },
      ]
    : [];

  return (
    <OwnerShell businessName={workspace?.business_name} status={agentStatus}>
      <main style={S.page}>
        {/* ── Header ─────────────────────────────────────── */}
        <header style={S.header}>
          <div>
            <h1 style={S.title}>Overview</h1>
            <p style={S.subtitle}>What your assistant has been doing.</p>
          </div>
        </header>

        {error && (
          <div style={S.errorBanner} role="alert">
            {error}
          </div>
        )}

        {/* ── Stat Cards Grid ────────────────────────────── */}
        <div style={S.statsGrid}>
          {loading
            ? [0, 1, 2, 3].map((i) => (
                <div key={i} style={{ ...S.statCard, ...S.skeleton }} />
              ))
            : statItems.map((item, i) => {
                const theme = STAT_THEMES[i % STAT_THEMES.length];
                const Icon = theme.icon;
                return (
                  <div
                    key={item.label}
                    style={{
                      ...S.statCard,
                      background: theme.bg,
                      borderColor: theme.border,
                    }}
                  >
                    <div style={S.statTop}>
                      <div
                        style={{
                          ...S.statIconWrap,
                          background: theme.accent + "18",
                          color: theme.accent,
                        }}
                      >
                        <Icon size={16} />
                      </div>
                      <span style={{ ...S.statValue, color: theme.accent }}>
                        {item.value}
                      </span>
                    </div>
                    <span style={S.statLabel}>{item.label}</span>
                  </div>
                );
              })}
        </div>

        {data && (
          <>
            {/* ── What People Asked ─────────────────────── */}
            <section style={S.section}>
              <div style={S.sectionHeader}>
                <MessageCircleQuestion
                  size={18}
                  style={{ color: "var(--claude-accent, #4f5dca)" }}
                />
                <h2 style={S.sectionTitle}>What people asked</h2>
              </div>
              <p style={S.sectionHint}>
                The clearest signal of what to add to your documents next.
              </p>

              {data.questions.length === 0 ? (
                <div style={S.emptyState}>
                  <MessageCircleQuestion
                    size={28}
                    style={{ color: "#bbb", marginBottom: 8 }}
                  />
                  <p style={{ margin: 0 }}>
                    Nobody has asked anything yet. Share a link to get started.
                  </p>
                </div>
              ) : (
                <div style={S.questionsList}>
                  {data.questions.map((q, i) => (
                    <div key={i} style={S.questionRow}>
                      <span style={S.questionBubble}>{q.text}</span>
                      <span style={S.questionTime}>{relativeTime(q.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Recent Conversations ──────────────────── */}
            <section style={S.section}>
              <div style={S.sectionHeader}>
                <Users
                  size={18}
                  style={{ color: "var(--claude-accent, #4f5dca)" }}
                />
                <h2 style={S.sectionTitle}>Recent conversations</h2>
              </div>

              {data.recent.length === 0 ? (
                <div style={S.emptyState}>
                  <Users size={28} style={{ color: "#bbb", marginBottom: 8 }} />
                  <p style={{ margin: 0 }}>
                    No conversations yet. Share your assistant link to get
                    started.
                  </p>
                </div>
              ) : (
                <div style={S.recentList}>
                  {data.recent.map((item, i) => (
                    <div key={i} style={S.recentRow}>
                      <div
                        style={{
                          ...S.avatar,
                          background:
                            item.channel === "voice" ? "#ede9fe" : "#e0f2fe",
                          color:
                            item.channel === "voice" ? "#7c3aed" : "#0284c7",
                        }}
                      >
                        {initials(item.name)}
                      </div>

                      <div style={S.recentInfo}>
                        <span style={S.recentName}>{item.name}</span>
                        <span style={S.recentMeta}>
                          {formatWhen(item.started_at)}
                        </span>
                      </div>

                      <span
                        style={{
                          ...S.channelBadge,
                          background:
                            item.channel === "voice" ? "#f3e8ff" : "#e0f2fe",
                          color:
                            item.channel === "voice" ? "#7c3aed" : "#0284c7",
                        }}
                      >
                        {item.channel === "voice" ? (
                          <Mic size={11} />
                        ) : (
                          <MessageCircleQuestion size={11} />
                        )}
                        {item.channel}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <a href="/links" style={S.seeAll}>
                See everyone →
              </a>
            </section>
          </>
        )}
      </main>
    </OwnerShell>
  );
}

/* ─────────────────────────── Inline Styles ─────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: "52rem",
    padding: "0 0 40px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    margin: 0,
    color: "var(--claude-text, #1a1a1a)",
  },
  subtitle: {
    fontSize: 13,
    color: "var(--owner-muted, #888)",
    marginTop: 4,
  },
  errorBanner: {
    padding: "12px 16px",
    borderRadius: 10,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: 500,
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
  },
  statCard: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "16px 18px",
    borderRadius: 14,
    border: "1px solid transparent",
    transition: "transform 0.15s, box-shadow 0.15s",
    minHeight: 88,
  },
  skeleton: {
    background: "#f0f0ed",
    animation: "pulse 1.5s ease-in-out infinite",
    borderColor: "#e5e5e2",
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
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.02em",
  },
  statLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: "#777",
    letterSpacing: "0.01em",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    margin: 0,
    color: "var(--claude-text, #1a1a1a)",
  },
  sectionHint: {
    fontSize: 12,
    color: "var(--owner-muted, #888)",
    margin: 0,
    lineHeight: 1.5,
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 16px",
    border: "1px dashed #d5d5d0",
    borderRadius: 14,
    background: "#fafaf8",
    color: "#999",
    fontSize: 13,
    textAlign: "center",
  },
  questionsList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  questionRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 12,
    background: "var(--owner-surface, #fff)",
    border: "1px solid var(--owner-border, #e8e8e5)",
  },
  questionBubble: {
    flex: 1,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--claude-text, #1a1a1a)",
  },
  questionTime: {
    fontSize: 11,
    color: "#aaa",
    whiteSpace: "nowrap",
    flexShrink: 0,
    paddingTop: 2,
  },
  recentList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  recentRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 12,
    background: "var(--owner-surface, #fff)",
    border: "1px solid var(--owner-border, #e8e8e5)",
    transition: "background 0.12s",
  },
  avatar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    borderRadius: 9999,
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
    letterSpacing: "0.03em",
  },
  recentInfo: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  recentName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--claude-text, #1a1a1a)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  recentMeta: {
    fontSize: 11,
    color: "#aaa",
  },
  channelBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: 9999,
    textTransform: "capitalize",
    flexShrink: 0,
  } as React.CSSProperties,
  seeAll: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--claude-accent, #4f5dca)",
    textDecoration: "none",
    marginTop: 4,
  },
};
