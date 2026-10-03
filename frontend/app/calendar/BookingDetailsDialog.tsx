"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { ModalPortal } from "../components/ModalPortal";
import { ownerFetch } from "../lib/ownerFetch";
import { extractApiErrorMessage, formatClientError } from "../lib/apiErrors";

interface BookingDetails {
  booking_id: string; title: string; contact_name?: string; service_name?: string;
  customer_phone?: string;
  business_name?: string; start_ts: string; end_ts: string; created_at?: string;
  status: string; source?: string;
}

export function BookingDetailsDialog({ bookingId, timeZone, onClose }: {
  bookingId: string; timeZone: string; onClose: () => void;
}) {
  const [details, setDetails] = useState<BookingDetails | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await ownerFetch(`/api/v1/calendar/bookings/${encodeURIComponent(bookingId)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(await extractApiErrorMessage(response, "Could not load booking details."));
        const result = await response.json();
        if (!controller.signal.aborted) setDetails(result);
      } catch (reason) {
        if (!controller.signal.aborted) setError(formatClientError(reason, "Could not load booking details."));
      }
    })();
    return () => controller.abort();
  }, [bookingId]);
  const formatDate = (value?: string) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone }) : "Not recorded";
  const fields = details ? [
    ["Caller", details.contact_name || (details.source === "manual" ? "Owner / staff" : "Caller name not recorded")],
    ["Phone", details.customer_phone || "Not recorded"],
    ["Appointment / request", details.title],
    ["Service", details.service_name || "General appointment"],
    ["Business / team", details.business_name || "Business team"],
    ["Starts", formatDate(details.start_ts)], ["Ends", formatDate(details.end_ts)],
    ["Booked on", formatDate(details.created_at)], ["Booked through", details.source || "Not recorded"],
    ["Status", details.status], ["Time zone", timeZone],
  ] : [];
  return <ModalPortal label="Booking details" onClose={onClose}>
    <div className="fixed inset-0 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border bg-[var(--claude-surface)] p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between gap-4 mb-5">
          <h2 className="text-lg font-semibold">Booking details</h2>
          <button type="button" aria-label="Close booking details" onClick={onClose}><X size={20} /></button>
        </header>
        {error ? <p role="alert">{error}</p> : !details ? <p role="status">Loading booking details…</p> : <>
          <dl className="grid grid-cols-[minmax(110px,1fr)_2fr] gap-x-4 gap-y-3 text-sm">
            {fields.map(([label, value]) => <div key={label} className="contents"><dt className="text-[var(--claude-muted)]">{label}</dt><dd className="break-words">{value}</dd></div>)}
          </dl>
          <p className="mt-5 text-xs text-[var(--claude-muted)] break-all">Booking ID: {details.booking_id}</p>
        </>}
        <button type="button" className="mt-6 rounded-xl border px-4 py-2 text-sm" onClick={onClose}>Close</button>
      </div>
    </div>
  </ModalPortal>;
}
