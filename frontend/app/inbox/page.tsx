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
  LifeBuoy,
} from "lucide-react";
import { OwnerShell } from "../components/owner/OwnerShell";
import { ownerFetch } from "../lib/ownerFetch";
import type { PostCallIntelligence } from "../components/voice/voiceEvents";
import { extractApiErrorMessage, formatClientError } from "../lib/apiErrors";
import "../styles/business.css";

type InboxTab = "requests" | "calls" | "support";

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

interface SupportRequestItem {
  request_id: string;
  product_name: string;
  customer_name: string;
  reply_to: string;
  preferred_time?: string | null;
  message: string;
  trigger: "manual" | "abstention" | "safety";
  status: "open" | "contacted" | "resolved";
  created_at: string;
  owner_note?: string;
}

interface CallItem {
  call_id: string;
  name: string;
  created_at: string;
  duration_seconds: number;
  summary_status: string;
  intelligence: PostCallIntelligence | null;
  transcript_source: string;
  context_label?: string | null;
  voice_consent_recorded?: boolean;
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
  const [tab, setTab] = useState<InboxTab>("requests");
  const [filter, setFilter] = useState("open");

  // Separate data caches so switching tabs is instant without reloading flicker
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [supportRequests, setSupportRequests] = useState<SupportRequestItem[]>([]);
  const [requestsTotal, setRequestsTotal] = useState(0);
  const [callsTotal, setCallsTotal] = useState(0);
  const [supportTotal, setSupportTotal] = useState(0);
  const [requestsOffset, setRequestsOffset] = useState(0);
  const [callsOffset, setCallsOffset] = useState(0);
  const [supportOffset, setSupportOffset] = useState(0);
  const [supportFilter, setSupportFilter] = useState("all");

  // Track initial load per tab: only show full skeleton on first visit
  const [hasLoaded, setHasLoaded] = useState<{
    requests: boolean;
    calls: boolean;
    support: boolean;
  }>({
    requests: false,
    calls: false,
    support: false,
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState("");
  const [supportError, setSupportError] = useState("");

  const [selected, setSelected] = useState<RequestItem | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("open");
  const [saving, setSaving] = useState(false);

  // Support request editing
  const [selectedSupport, setSelectedSupport] = useState<SupportRequestItem | null>(null);
  const [supportNote, setSupportNote] = useState("");
  const [supportStatus, setSupportStatus] = useState<"open" | "contacted" | "resolved">("open");
  const [supportSaving, setSupportSaving] = useState(false);

  const [notice, setNotice] = useState("");
  const [transcript, setTranscript] = useState<{ id: string; turns: Turn[] } | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState<string | null>(null);

  const generation = useRef(0);
  const pendingRequestIdRef = useRef<string | null>(null);

  const currentOffset =
    tab === "requests" ? requestsOffset : tab === "calls" ? callsOffset : supportOffset;
  const currentTotal =
    tab === "requests" ? requestsTotal : tab === "calls" ? callsTotal : supportTotal;
  const isCurrentTabLoading = !hasLoaded[tab];

  // Read deep link params on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const searchParams = new URLSearchParams(window.location.search);
    const queryTab = searchParams.get("tab");
    const queryReqId = searchParams.get("request_id");

    if (queryTab === "support") {
      setTab("support");
      if (queryReqId) {
        pendingRequestIdRef.current = queryReqId;
      }
    } else if (queryTab === "calls") {
      setTab("calls");
    } else if (queryTab === "requests") {
      setTab("requests");
    }
  }, []);

  const load = useCallback(
    async (targetTab: InboxTab, quiet = false) => {
      const sequence = ++generation.current;
      if (!quiet) setIsSyncing(true);

      if (targetTab === "support") {
        try {
          const params = new URLSearchParams({
            limit: "20",
            offset: String(supportOffset),
          });
          if (supportFilter !== "all") params.set("status", supportFilter);

          const response = await ownerFetch(
            `/api/v1/product-qr/service-requests?${params}`,
            {
              signal: AbortSignal.timeout(15000),
            }
          );

          if (!response.ok) {
            const detail = await extractApiErrorMessage(
              response,
              response.status === 401 || response.status === 403
                ? "Sign in to your business account to open Product QR support requests."
                : "Could not load Product QR support requests."
            );
            throw new Error(detail);
          }

          const data = await response.json();
          if (sequence !== generation.current) return;

          const items: SupportRequestItem[] = data.items || [];
          setSupportRequests(items);
          setSupportTotal(data.total ?? items.length);
          setHasLoaded((prev) => ({ ...prev, support: true }));
          setSupportError("");

          // Handle pending deep link selection
          if (pendingRequestIdRef.current) {
            const match = items.find((i) => i.request_id === pendingRequestIdRef.current);
            if (match) {
              setSelectedSupport(match);
              setSupportStatus(match.status);
              setSupportNote(match.owner_note || "");
              pendingRequestIdRef.current = null;
            }
          }
        } catch (err: any) {
          if (sequence === generation.current) {
            setSupportError(
              formatClientError(err, "Could not load Product QR support requests.")
            );
            setHasLoaded((prev) => ({ ...prev, support: true }));
          }
        } finally {
          if (sequence === generation.current) {
            setIsSyncing(false);
          }
        }
        return;
      }

      try {
        const offsetToUse = targetTab === "requests" ? requestsOffset : callsOffset;
        const params = new URLSearchParams({ limit: "20", offset: String(offsetToUse) });
        if (targetTab === "requests" && filter !== "all") params.set("status", filter);

        const response = await ownerFetch(`/api/v1/business/${targetTab}?${params}`, {
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          const detail = await extractApiErrorMessage(
            response,
            response.status === 401 || response.status === 403
              ? "Sign in to your business account to open the inbox."
              : "Could not load your inbox. Try again."
          );
          throw new Error(detail);
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
      } catch (err: any) {
        if (sequence === generation.current) {
          setError(formatClientError(err, "Could not load inbox."));
          setHasLoaded((prev) => ({ ...prev, [targetTab]: true }));
        }
      } finally {
        if (sequence === generation.current) {
          setIsSyncing(false);
        }
      }
    },
    [filter, requestsOffset, callsOffset, supportFilter, supportOffset]
  );

  // Tab click: instantaneous if already cached, quiet revalidation
  const handleTabChange = (newTab: InboxTab) => {
    if (newTab === tab) return;
    setTab(newTab);
    setSelected(null);
    setSelectedSupport(null);
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
  }, [tab, filter, requestsOffset, callsOffset, supportFilter, supportOffset, load]);

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
        const detail = await extractApiErrorMessage(response, "Could not save the request. Your notes are still here; please retry.");
        throw new Error(detail);
      }
      setSelected(null);
      setNotice("Request updated.");
      void load("requests", true);
    } catch (err: any) {
      setNotice(formatClientError(err, "Could not save. Your notes are still here; please retry."));
    } finally {
      setSaving(false);
    }
  }

  // Optimistic update and rollback for Product QR Support requests
  async function saveSupport() {
    if (!selectedSupport || supportSaving) return;
    setSupportSaving(true);
    setNotice("");

    const prevItems = [...supportRequests];
    const prevSelected = selectedSupport;
    const targetId = selectedSupport.request_id;
    const updatedItem: SupportRequestItem = {
      ...selectedSupport,
      status: supportStatus,
      owner_note: supportNote,
    };

    // Optimistically update list and close editor
    setSupportRequests((curr) =>
      curr.map((item) => (item.request_id === targetId ? updatedItem : item))
    );
    setSelectedSupport(null);

    try {
      const response = await ownerFetch(
        `/api/v1/product-qr/service-requests/${encodeURIComponent(targetId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            status: supportStatus,
            owner_note: supportNote,
          }),
        }
      );

      if (!response.ok) {
        const detail = await extractApiErrorMessage(
          response,
          "Could not update support request. Please retry."
        );
        throw new Error(detail);
      }

      const updated = await response.json();
      setNotice("Product QR support request updated.");
      if (updated?.request_id) {
        setSupportRequests((curr) =>
          curr.map((item) => (item.request_id === targetId ? { ...item, ...updated } : item))
        );
      }
    } catch (err: any) {
      // Rollback on failure!
      setSupportRequests(prevItems);
      setSelectedSupport(prevSelected);
      setNotice(
        formatClientError(
          err,
          "Failed to save support request. Your changes have been restored; please retry."
        )
      );
    } finally {
      setSupportSaving(false);
    }
  }

  async function showTranscript(callId: string) {
    setLoadingTranscript(callId);
    try {
      const response = await ownerFetch(`/api/v1/voice/calls/${callId}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const detail = await extractApiErrorMessage(response, "Could not load this transcript.");
        throw new Error(detail);
      }
      const data = await response.json();
      setTranscript({ id: callId, turns: data.messages });
    } catch (err: any) {
      setNotice(formatClientError(err, "Could not load transcript."));
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
            <button
              type="button"
              aria-pressed={tab === "support"}
              onClick={() => handleTabChange("support")}
            >
              <LifeBuoy size={16} />
              Product QR Support
              {hasLoaded.support && supportTotal > 0 && (
                <span className="business-count">{supportTotal}</span>
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

          {tab === "support" && (
            <label className="business-filter">
              Status
              <select
                value={supportFilter}
                onChange={(e) => {
                  setSupportFilter(e.target.value);
                  setSupportOffset(0);
                }}
              >
                <option value="all">All requests</option>
                <option value="open">Open (Needs attention)</option>
                <option value="contacted">Contacted</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
          )}
        </div>

        {notice && (
          <p role="status" className="business-notice">
            {notice}
          </p>
        )}

        {tab === "support" && supportError && (
          <div role="alert" className="business-error">
            {supportError}
          </div>
        )}

        {tab !== "support" && error && (
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
                Loading {tab === "support" ? "Product QR support requests" : tab === "requests" ? "customer inquiries" : "call summaries"}…
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
        ) : (!error && !supportError) && currentTotal === 0 ? (
          <section className="business-empty">
            <Inbox size={36} strokeWidth={1.4} />
            <h2>
              {tab === "support"
                ? "No Product QR support requests waiting."
                : tab === "requests"
                ? "Nothing waiting here."
                : "Your next call starts the story."}
            </h2>
            <p>
              {tab === "support"
                ? "Customer help requests submitted through scanned product QR pages arrive here with product context, contact info, and escalation reason."
                : tab === "requests"
                ? "Customer messages arrive here with their question and contact details. Keep track of each one until it is resolved."
                : "After a conversation, review its transcript, key topics and suggested follow-up here."}
            </p>
            <Link
              className="business-button secondary"
              href={tab === "support" ? "/products" : tab === "calls" ? "/agent" : "/links"}
            >
              {tab === "support" ? "Manage Products & QR" : tab === "calls" ? "Test your assistant" : "Share your assistant"}
              <ArrowRight size={16} />
            </Link>
          </section>
        ) : (
          <div className="business-worklist">
            {tab === "support"
              ? supportRequests.map((item) => (
                  <article className="business-request-row" key={item.request_id}>
                    <div className="business-row-heading">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="business-badge-qr">
                          <LifeBuoy size={12} />
                          Product QR
                        </span>
                        <strong>{item.customer_name}</strong>
                        <span className="business-muted font-normal text-xs">
                          for <strong>{item.product_name}</strong>
                        </span>
                        <span
                          className={`business-trigger-badge is-${item.trigger}`}
                          title={`Trigger reason: ${item.trigger}`}
                        >
                          {item.trigger === "safety"
                            ? "Safety Alert"
                            : item.trigger === "abstention"
                            ? "Manual Gap"
                            : "Direct Help"}
                        </span>
                        <span className={`business-status is-${item.status}`}>
                          {item.status.replace("_", " ")}
                        </span>
                      </div>
                      <time>{dateLabel(item.created_at)}</time>
                    </div>

                    <p className="business-request-message">{item.message}</p>

                    <div className="flex items-center gap-4 flex-wrap text-xs my-2">
                      <p className="business-muted m-0">
                        Reply via:{" "}
                        <span className="business-contact-value">
                          {item.reply_to}
                        </span>
                      </p>
                      {item.preferred_time && (
                        <p className="business-muted m-0">
                          Preferred time:{" "}
                          <span className="business-contact-value">{item.preferred_time}</span>
                        </p>
                      )}
                    </div>

                    {selectedSupport?.request_id === item.request_id ? (
                      <div className="business-form request-editor">
                        <label htmlFor="support-status-select">Progress</label>
                        <select
                          id="support-status-select"
                          value={supportStatus}
                          onChange={(e) =>
                            setSupportStatus(e.target.value as "open" | "contacted" | "resolved")
                          }
                          disabled={supportSaving}
                        >
                          <option value="open">Open</option>
                          <option value="contacted">Contacted</option>
                          <option value="resolved">Resolved</option>
                        </select>
                        <label htmlFor="support-owner-note">Private team note</label>
                        <textarea
                          id="support-owner-note"
                          rows={3}
                          maxLength={2000}
                          value={supportNote}
                          onChange={(e) => setSupportNote(e.target.value)}
                          disabled={supportSaving}
                          placeholder="What happened, and what remains to do?"
                        />
                        <div className="business-inline">
                          <button
                            type="button"
                            className="business-button"
                            onClick={() => void saveSupport()}
                            disabled={supportSaving}
                          >
                            {supportSaving ? "Saving…" : "Save changes"}
                          </button>
                          <button
                            type="button"
                            className="business-button secondary"
                            onClick={() => setSelectedSupport(null)}
                            disabled={supportSaving}
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
                            setSelectedSupport(item);
                            setSupportNote(item.owner_note || "");
                            setSupportStatus(item.status);
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
              : tab === "requests"
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
                      {call.context_label && <span className="business-badge-qr">Product QR</span>}
                      {call.voice_consent_recorded && <span className="business-muted">Consent recorded</span>}
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
                  if (tab === "support") {
                    setSupportOffset((prev) => Math.max(0, prev - 20));
                  } else if (tab === "requests") {
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
                  if (tab === "support") {
                    setSupportOffset((prev) => prev + 20);
                  } else if (tab === "requests") {
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
