"use client";
import { useEffect, useState } from "react";
import { ownerFetch } from "../../lib/ownerFetch";
import "../../styles/business.css";

export function CalendarTimezone({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void ownerFetch("/api/v1/calendar/settings", { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error();
      const data = await r.json(); setDraft(data.timezone); onChange(data.timezone);
    }).catch(() => { if (!controller.signal.aborted) setError("Could not load the business time zone. Refresh before making bookings."); });
    return () => controller.abort();
  }, [onChange]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const res = await ownerFetch("/api/v1/calendar/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timezone: draft }), signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error("Could not save the time zone. Enter a valid IANA name, such as Asia/Kolkata.");
      onChange(draft);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save."); }
    finally { setSaving(false); }
  }
  return <form className="business-form" onSubmit={save}><label htmlFor="business-timezone">Business time zone</label><div className="business-inline"><input id="business-timezone" value={draft} onChange={e => setDraft(e.target.value)} list="business-timezones" required maxLength={64} /><datalist id="business-timezones">{["Asia/Kolkata", "UTC", "Europe/London", "America/New_York", "Asia/Dubai", "Asia/Singapore"].map(z => <option key={z} value={z} />)}</datalist><button className="business-button secondary" disabled={saving || draft === value}>{saving ? "Saving…" : "Save time zone"}</button></div><p className="business-muted">Hours and appointment times use {value}. Changing the time zone keeps existing bookings at the same instant.</p>{error && <p role="alert" className="business-error">{error}</p>}</form>;
}
