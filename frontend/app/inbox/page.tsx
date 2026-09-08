"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Inbox,
  MessageSquare,
  Phone,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { OwnerShell } from "../components/owner/OwnerShell";
import { ownerFetch } from "../lib/ownerFetch";
import type { PostCallIntelligence } from "../components/voice/voiceEvents";
import "../styles/business.css";

interface RequestItem {
  request_id: string;
  contact_id: string;
  call_id?: string;
  name: string;
  message: string;
  reply_to: string;
  status: string;
  owner_note: string;
  created_at: string;
}

interface CallItem {
  call_id: string;
  name: string;
  created_at: string;
  duration_seconds: number;
  summary_status: string;
  intelligence: PostCallIntelligence | null;
  transcript_source: string;
}

interface Turn {
  role: string;
  content: string;
}

const dateLabel = (date: string) =>
  new Date(
    date.endsWith("Z") || /[+-]\d\d:\d\d$/.test(date) ? date : `${date}Z`
  ).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function InboxPage() {
  const [tab, setTab] = useState<"requests" | "calls">("requests");
  const [filter, setFilter] = useState("open");

  // Separate data caches so switching tabs is instant without reloading flicker
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [requestsTotal, setRequestsTotal] = useState(0);
  const [callsTotal, setCallsTotal] = useState(0);
  const [requestsOffset, setRequestsOffset] = useState(0);
  const [callsOffset, setCallsOffset] = useState(0);

  // Track initial load per tab: only show full skeleton on first visit
  const [hasLoaded, setHasLoaded] = useState<{ requests: boolean; calls: boolean }>({
    requests: false,
    calls: false,
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<RequestItem | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("open");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [transcript, setTranscript] = useState<{ id: string; turns: Turn[] } | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState<string | null>(null);

  const generation = useRef(0);

  const currentOffset = tab === "requests" ? requestsOffset : callsOffset;
  const currentTotal = tab === "requests" ? requestsTotal : callsTotal;
  const isCurrentTabLoading = !hasLoaded[tab];

  const load = useCallback(
    async (targetTab: "requests" | "calls", quiet = false) => {
      const sequence = ++generation.current;
      if (!quiet) setIsSyncing(true);

      try {
        const offsetToUse = targetTab === "requests" ? requestsOffset : callsOffset;
        const params = new URLSearchParams({ limit: "20", offset: String(offsetToUse) });
        if (targetTab === "requests" && filter !== "all") params.set("status", filter);

        const response = await ownerFetch(`/api/v1/business/${targetTab}?${params}`, {
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          throw new Error(
            response.status === 401 || response.status === 403
              ? "Sign in to your business account to open the inbox."
              : "Could not load your inbox. Try again."
          );
        }

        const data = await response.json();
        if (sequence !== generation.current) return;

        if (targetTab === "requests") {
          setRequests(data.items || []);
          setRequestsTotal(data.total || 0);
        } else {
          setCalls(data.items || []);
          setCallsTotal(data.total || 0);
        }

        setHasLoaded((prev) => ({ ...prev, [targetTab]: true }));
        setError("");
      } catch (err) {
        if (sequence === generation.current) {
          setError(err instanceof Error ? err.message : "Could not load inbox.");
        }
      } finally {
        if (sequence === generation.current) {
          setIsSyncing(false);
        }
      }
    },
    [filter, requestsOffset, callsOffset]
  );

  // Tab click: instantaneous if already cached, quiet revalidation
  const handleTabChange = (newTab: "requests" | "calls") => {
    if (newTab === tab) return;
    setTab(newTab);
    setSelected(null);
    setTranscript(null);
    void load(newTab, hasLoaded[newTab]);
  };

  useEffect(() => {
    void load(tab, hasLoaded[tab]);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void load(tab, true);
      }
    }, 20000);
    return () => {
      clearInterval(interval);
      generation.current++;
    };
  }, [tab, filter, requestsOffset, callsOffset, load]);

  async function save() {
    if (!selected || saving) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await ownerFetch(
        `/api/v1/business/requests/${selected.request_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({ status, owner_note: note }),
        }
      );
      if (!response.ok) {
        throw new Error("Could not save the request. Your notes are still here; please retry.");
      }
      setSelected(null);
      setNotice("Request updated.");
      void load("requests", true);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function showTranscript(callId: string) {
    setLoadingTranscript(callId);
    try {
      const response = await ownerFetch(`/api/v1/voice/calls/${callId}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Could not load this transcript.");
      const data = await response.json();
      setTranscript({ id: callId, turns: data.messages });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not load transcript.");
    } finally {
      setLoadingTranscript(null);
    }
  }

  return (
    <OwnerShell>
      <main className="business-page">
        <header className="business-page-header">
          <div>
            <p className="business-kicker">CUSTOMER OPERATIONS</p>
            <h1>
              Every conversation.
              <br />A clear next step.
            </h1>
            <p>Respond to customer requests and review what your assistant handled.</p>
          </div>
          <button
            type="button"
            className="business-button secondary"
            onClick={() => void load(tab, false)}
            disabled={isSyncing}
          >
            <RefreshCw size={15} className={isSyncing ? "animate-spin text-indigo-600" : ""} />
            {isSyncing ? "Syncing…" : "Refresh"}
          </button>
        </header>

        <div className="business-toolbar">
          <div className="business-tabs" role="group" aria-label="Inbox view">
            <button
              type="button"
              aria-pressed={tab === "requests"}
              onClick={() => handleTabChange("requests")}
            >
              <MessageSquare size={16} />
              Requests
              {hasLoaded.requests && requestsTotal > 0 && (
                <span className="business-count">{requestsTotal}</span>
              )}
            </button>
            <button
              type="button"
              aria-pressed={tab === "calls"}
              onClick={() => handleTabChange("calls")}
            >
              <Phone size={16} />
              Call summaries
              {hasLoaded.calls && callsTotal > 0 && (
                <span className="business-count">{callsTotal}</span>
              )}
            </button>
          </div>

          {tab === "requests" && (
            <label className="business-filter">
              Status
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setRequestsOffset(0);
                }}
              >
                <option value="open">Needs attention</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
                <option value="all">All requests</option>
              </select>
            </label>
          )}
        </div>

        {notice && (
          <p role="status" className="business-notice">
            {notice}
          </p>
        )}

        {error && (
          <div role="alert" className="business-error">
            {error} <Link href="/signin">Sign in</Link>
          </div>
        )}

        {/* Shimmering Skeleton Loader on initial tab visit */}
        {isCurrentTabLoading ? (
          <div className="business-skeleton-wrap" role="status" aria-label="Loading inbox">
            <div className="business-skeleton-header">
              <Loader2 size={14} className="animate-spin text-indigo-600" />
              <span>
                Loading {tab === "requests" ? "customer inquiries" : "call summaries"}…
              </span>
            </div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="business-skeleton-card">
                <div className="business-skeleton-top">
                  <div className="business-shimmer-bar business-shimmer-name" />
                  <div className="business-shimmer-bar business-shimmer-pill" />
                  <div className="business-shimmer-bar business-shimmer-time" />
                </div>
                <div className="business-shimmer-bar business-shimmer-line" />
                <div className="business-shimmer-bar business-shimmer-line short" />
                <div className="business-shimmer-bar business-shimmer-btn" />
              </div>
            ))}
          </div>
        ) : !error && currentTotal === 0 ? (
          <section className="business-empty">
            <Inbox size={36} strokeWidth={1.4} />
            <h2>
              {tab === "requests"
                ? "Nothing waiting here."
                : "Your next call starts the story."}
            </h2>
            <p>
              {tab === "requests"
                ? "Customer messages arrive here with their question and contact details. Keep track of each one until it is resolved."
                : "After a conversation, review its transcript, key topics and suggested follow-up here."}
            </p>
            <Link
              className="business-button secondary"
              href={tab === "calls" ? "/agent" : "/links"}
            >
              {tab === "calls" ? "Test your assistant" : "Share your assistant"}
              <ArrowRight size={16} />
            </Link>
          </section>
        ) : (
          <div className="business-worklist">
            {tab === "requests"
              ? requests.map((item) => (
                  <article className="business-request-row" key={item.request_id}>
                    <div className="business-row-heading">
                      <strong>{item.name}</strong>
                      <span className={`business-status is-${item.status}`}>
                        {item.status.replace("_", " ")}
                      </span>
                      <time>{dateLabel(item.created_at)}</time>
                    </div>
                    <p className="business-request-message">{item.message}</p>
                    <p className="business-muted">
                      Reply via:{" "}
                      <span className="business-contact-value">{item.reply_to}</span>
                    </p>
                    {selected?.request_id === item.request_id ? (
                      <div className="business-form request-editor">
                        <label htmlFor="request-status">Progress</label>
                        <select
                          id="request-status"
                          value={status}
                          onChange={(e) => setStatus(e.target.value)}
                          disabled={saving}
                        >
                          <option value="open">Open</option>
                          <option value="in_progress">In progress</option>
                          <option value="resolved">Resolved</option>
                        </select>
                        <label htmlFor="owner-note">Private team note</label>
                        <textarea
                          id="owner-note"
                          rows={3}
                          maxLength={2000}
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          disabled={saving}
                          placeholder="What happened, and what remains to do?"
                        />
                        <div className="business-inline">
                          <button
                            type="button"
                            className="business-button"
                            onClick={() => void save()}
                            disabled={saving}
                          >
                            {saving ? "Saving…" : "Save changes"}
                          </button>
                          <button
                            type="button"
                            className="business-button secondary"
                            onClick={() => setSelected(null)}
                            disabled={saving}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="business-inline">
                        <button
                          type="button"
                          className="business-button secondary"
                          onClick={() => {
                            setSelected(item);
                            setNote(item.owner_note);
                            setStatus(item.status);
                          }}
                        >
                          Review request
                          <ArrowRight size={15} />
                        </button>
                        {item.owner_note && (
                          <p className="business-muted">Note: {item.owner_note}</p>
                        )}
                      </div>
                    )}
                  </article>
                ))
              : calls.map((call) => (
                  <article key={call.call_id} className="business-request-row">
                    <div className="business-row-heading">
                      <strong>{call.name}</strong>
                      <time>{dateLabel(call.created_at)}</time>
                      <span className="business-muted">
                        {Math.floor(call.duration_seconds / 60)}m{" "}
                        {call.duration_seconds % 60}s
                      </span>
                    </div>
                    {call.intelligence ? (
                      <>
                        <p className="business-request-message">
                          {call.intelligence.summary}
                        </p>
                        {call.intelligence.needs_follow_up && (
                          <span className="business-status">
                            Review suggested follow-up
                          </span>
                        )}
                        {call.intelligence.key_points.length > 0 && (
                          <ul className="business-points">
                            {call.intelligence.key_points.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        )}
                        {call.intelligence.action_items.length > 0 && (
                          <div className="business-followup">
                            <strong>Suggested next steps</strong>
                            <ul>
                              {call.intelligence.action_items.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {!!call.intelligence.unanswered_questions?.length && (
                          <div className="business-followup">
                            <strong>Knowledge to improve</strong>
                            <ul>
                              {call.intelligence.unanswered_questions.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                            <Link href="/agent">
                              Update assistant knowledge <ArrowRight size={14} />
                            </Link>
                          </div>
                        )}
                        <p className="business-muted">
                          AI summary for review. Verify commitments against the transcript and
                          calendar.
                        </p>
                      </>
                    ) : (
                      <p className="business-muted">
                        {call.summary_status === "unavailable"
                          ? "Summary unavailable. Save your model, API key and endpoint in Account & Keys."
                          : call.summary_status === "failed"
                          ? "Summary could not be generated. The transcript is still available."
                          : call.summary_status === "waiting"
                          ? "No speech was recorded."
                          : "Preparing the call summary…"}
                      </p>
                    )}
                    <div className="business-inline">
                      <button
                        type="button"
                        className="business-button secondary"
                        onClick={() => void showTranscript(call.call_id)}
                        disabled={loadingTranscript === call.call_id}
                      >
                        {loadingTranscript === call.call_id
                          ? "Loading…"
                          : "Read transcript"}
                      </button>
                      <Link href="/calendar" className="business-text-link">
                        <CheckCircle2 size={15} />
                        Check bookings
                      </Link>
                    </div>
                    {transcript?.id === call.call_id && (
                      <div className="business-transcript" aria-label="Call transcript">
                        {transcript.turns.length ? (
                          transcript.turns.map((t, i) => (
                            <p key={i}>
                              <strong>
                                {t.role === "user" ? call.name : "Assistant"}
                              </strong>
                              <span>{t.content}</span>
                            </p>
                          ))
                        ) : (
                          <p>No transcript was recorded.</p>
                        )}
                        <button
                          className="business-button secondary"
                          type="button"
                          onClick={() => setTranscript(null)}
                        >
                          Close transcript
                        </button>
                      </div>
                    )}
                  </article>
                ))}
          </div>
        )}

        {currentTotal > 0 && (
          <footer className="business-pagination">
            <span>
              {currentOffset + 1}–{Math.min(currentOffset + 20, currentTotal)} of{" "}
              {currentTotal}
            </span>
            <div className="business-inline">
              <button
                className="business-button secondary"
                disabled={currentOffset === 0 || isSyncing}
                onClick={() => {
                  if (tab === "requests") {
                    setRequestsOffset((prev) => Math.max(0, prev - 20));
                  } else {
                    setCallsOffset((prev) => Math.max(0, prev - 20));
                  }
                }}
              >
                Previous
              </button>
              <button
                className="business-button secondary"
                disabled={currentOffset + 20 >= currentTotal || isSyncing}
                onClick={() => {
                  if (tab === "requests") {
                    setRequestsOffset((prev) => prev + 20);
                  } else {
                    setCallsOffset((prev) => prev + 20);
                  }
                }}
              >
                Next
              </button>
            </div>
          </footer>
        )}
      </main>
    </OwnerShell>
  );
}
