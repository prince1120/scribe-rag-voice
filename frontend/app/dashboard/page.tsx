"use client";

import { ownerFetch } from "../lib/ownerFetch";

// The console's front page.
//
// An owner opens this daily to answer one question: is my assistant working,
// and what did people ask it? So the numbers are few and the questions list is
// long — knowing *what* was asked is worth more than knowing how many times,
// because it tells the owner what to add to their documents next.

import { useEffect, useState } from "react";

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

  return (
    <OwnerShell businessName={workspace?.business_name} status={agentStatus}>
      <main className="dash-page">
        <header className="dash-header">
          <h1 className="dash-title">Overview</h1>
          <p className="dash-sub">What your assistant has been doing.</p>
        </header>

        {error && (
          <p className="agent-error" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <div className="dash-stats">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="ds-skeleton dash-stat-skeleton" />
            ))}
          </div>
        ) : data ? (
          <>
            <div className="dash-stats">
              <Stat label="Conversations" value={data.totals.conversations} />
              <Stat
                label="This week"
                value={data.totals.conversations_this_week}
              />
              <Stat label="Voice calls" value={data.totals.voice_calls} />
              <Stat
                label="People"
                value={data.totals.active_people}
                hint={
                  data.totals.people !== data.totals.active_people
                    ? `${data.totals.people - data.totals.active_people} blocked or revoked`
                    : undefined
                }
              />
            </div>

            <section className="dash-section">
              <h2 className="dash-section-title">What people asked</h2>
              <p className="dash-hint">
                The clearest signal of what to add to your documents next.
              </p>
              {data.questions.length === 0 ? (
                <p className="dash-empty">
                  Nobody has asked anything yet. Share a link to get started.
                </p>
              ) : (
                <ul className="dash-questions">
                  {data.questions.map((question, i) => (
                    <li key={i} className="dash-question">
                      <span className="dash-question-text">
                        {question.text}
                      </span>
                      <span className="dash-question-when">
                        {formatWhen(question.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="dash-section">
              <h2 className="dash-section-title">Recent conversations</h2>
              {data.recent.length === 0 ? (
                <p className="dash-empty">No conversations yet.</p>
              ) : (
                <ul className="dash-recent">
                  {data.recent.map((item, i) => (
                    <li key={i} className="dash-recent-row">
                      <span className="dash-recent-name">{item.name}</span>
                      <span className="dash-recent-meta">
                        {item.channel} · {formatWhen(item.started_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <a href="/links" className="agent-link">
                See everyone →
              </a>
            </section>
          </>
        ) : null}
      </main>
    </OwnerShell>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="dash-stat">
      <span className="dash-stat-value">{value}</span>
      <span className="dash-stat-label">{label}</span>
      {hint && <span className="dash-stat-hint">{hint}</span>}
    </div>
  );
}
