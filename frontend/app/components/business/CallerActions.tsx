"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, CalendarCheck, Send, MessageSquare } from "lucide-react";
import "../../styles/business.css";

interface Booking { booking_id: string; title: string; start_ts: string; end_ts: string; status: string }

export function CallerActions({ callId, refreshKey = "" }: { callId?: string; refreshKey?: string }) {
  const id = useId();
  const requestId = useRef<string | null>(null);
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(true);
  const [zone, setZone] = useState("UTC");
  const [bookingError, setBookingError] = useState("");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoadingBookings(true);
    try {
      const response = await fetch("/api/v1/business/bookings/mine", { credentials: "include", signal: signal || AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error("Could not check your bookings. Please refresh.");
      const data = await response.json();
      setBookings(data.items); setZone(data.timezone); setBookingError("");
    } catch (err) {
      if (!signal?.aborted) setBookingError(err instanceof Error ? err.message : "Could not check bookings.");
    } finally {
      setLoadingBookings(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, refreshKey]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSending(true); setError("");
    requestId.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/v1/business/requests", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ request_id: requestId.current, message: message.trim(), reply_to: replyTo.trim(), call_id: callId || undefined }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "Please check your message and try again.");
      }
      setSent(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not send your request. Try again."); }
    finally { setSending(false); }
  }

  return <section className="caller-actions" aria-label="Bookings and business requests">
    <details className="business-disclosure">
      <summary><CalendarCheck size={18} aria-hidden="true" /> Your bookings {bookings.length > 0 && <span className="business-count">{bookings.length}</span>}</summary>
      <div className="business-disclosure-body">
        <p className="business-muted">Confirmed records from the business calendar. Times shown in {zone}.</p>
        {loadingBookings ? <p className="business-muted">Checking your bookings…</p> : bookingError ? <p role="alert" className="business-error">{bookingError}</p> : bookings.length === 0 ? <p>No bookings yet. Ask the voice assistant about availability.</p> :
          bookings.map(b => <article key={b.booking_id} className="booking-receipt">
            <div><strong>{b.title}</strong><span className={`business-status ${b.status === "cancelled" ? "" : "is-resolved"}`}>{b.status}</span></div>
            <p>{new Date(b.start_ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: zone })}</p>
            <small>Confirmation: {b.booking_id}</small>
          </article>)}
        <button className="business-button secondary" type="button" onClick={() => void refresh()}>Refresh bookings</button>
      </div>
    </details>
    <details className="business-disclosure">
      <summary><MessageSquare size={18} aria-hidden="true" /> Leave a message for the business</summary>
      <div className="business-disclosure-body">
        {sent ? <div role="status" className="request-success"><CheckCircle2 size={24} /><div><strong>Your request has been sent.</strong><p>The business can review it in their inbox and contact you at {replyTo}. A reply time is not guaranteed.</p></div></div> :
          <form onSubmit={submit} className="business-form">
            <p className="business-muted">Need a person to help? Send your question and let the team know how to reach you.</p>
            <label htmlFor={`${id}-message`}>What do you need help with?</label>
            <textarea id={`${id}-message`} value={message} onChange={e => setMessage(e.target.value)} required minLength={3} maxLength={2000} rows={3} disabled={sending} placeholder="Tell the business what you need…" />
            <label htmlFor={`${id}-reply`}>How should they contact you?</label>
            <input id={`${id}-reply`} value={replyTo} onChange={e => setReplyTo(e.target.value)} required minLength={3} maxLength={200} disabled={sending} placeholder="Your email or phone number and preferred time" autoComplete="off" />
            <p className="business-muted">These details are shared with this business to respond to your request.</p>
            {error && <p role="alert" className="business-error">{error}</p>}
            <button className="business-button" type="submit" disabled={sending || message.trim().length < 3 || replyTo.trim().length < 3}><Send size={16} />{sending ? "Sending…" : "Send request"}</button>
          </form>}
      </div>
    </details>
  </section>;
}
