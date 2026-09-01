"use client";
import { useEffect, useState } from "react";
import {
  Calendar,
  Clock,
  Plus,
  Bell,
  Trash2,
  Edit2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  BarChart3,
  Mic,
  MessageSquare,
  RefreshCw,
  Phone,
  X,
  Save,
} from "lucide-react";
import { OwnerShell } from "../components/owner/OwnerShell";
import { ownerFetch } from "../lib/ownerFetch";

interface ServiceItem {
  service_id: string;
  name: string;
  duration_mins: number;
  active?: boolean;
}

interface AvailabilityItem {
  weekday: number;
  start_time: string;
  end_time: string;
  is_closed: boolean;
}

interface BookingItem {
  booking_id: string;
  service_id?: string;
  contact_id?: string;
  title: string;
  start_ts?: string;
  end_ts?: string;
  status: string;
  source?: string;
  created_at?: string;
}

interface CalendarReports {
  total_bookings: number;
  confirmed_bookings: number;
  cancelled_bookings: number;
  cancellation_rate_pct: number;
  bookings_today: number;
  bookings_this_week: number;
  channel_breakdown: { voice: number; chat: number };
  service_breakdown: Record<string, number>;
}

interface NotificationItem {
  notification_id: string;
  type: string;
  title: string;
  body?: string;
  read: boolean;
  created_at?: string;
}

export default function CalendarPage() {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [availability, setAvailability] = useState<AvailabilityItem[]>([]);
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [reports, setReports] = useState<CalendarReports | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [savingHours, setSavingHours] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Modal States
  const [showAddService, setShowAddService] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [newServiceDuration, setNewServiceDuration] = useState(30);

  const [reschedulingBooking, setReschedulingBooking] = useState<BookingItem | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [submittingAction, setSubmittingAction] = useState(false);

  const [cancellingBooking, setCancellingBooking] = useState<BookingItem | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [sRes, aRes, bRes, rRes, nRes] = await Promise.all([
        ownerFetch("/api/v1/calendar/services"),
        ownerFetch("/api/v1/calendar/availability"),
        ownerFetch("/api/v1/calendar/bookings"),
        ownerFetch("/api/v1/calendar/reports"),
        ownerFetch("/api/v1/calendar/notifications"),
      ]);
      if (sRes.ok) setServices(await sRes.json());
      if (aRes.ok) setAvailability(await aRes.json());
      if (bRes.ok) setBookings(await bRes.json());
      if (rRes.ok) setReports(await rRes.json());
      if (nRes.ok) setNotifications(await nRes.json());
    } catch {
      showToast("Could not load calendar data", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleSaveHours = async () => {
    setSavingHours(true);
    try {
      const res = await ownerFetch("/api/v1/calendar/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(availability),
      });
      if (res.ok) {
        showToast("Weekly working hours updated ✓");
      } else {
        showToast("Failed to save working hours", "error");
      }
    } catch {
      showToast("Error updating hours", "error");
    } finally {
      setSavingHours(false);
    }
  };

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServiceName.trim()) return;
    setSubmittingAction(true);
    try {
      const res = await ownerFetch("/api/v1/calendar/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newServiceName.trim(),
          duration_mins: Number(newServiceDuration),
          active: true,
        }),
      });
      if (res.ok) {
        showToast("New service added ✓");
        setShowAddService(false);
        setNewServiceName("");
        setNewServiceDuration(30);
        void loadData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Could not add service", "error");
      }
    } catch {
      showToast("Error creating service", "error");
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleReschedule = async () => {
    if (!reschedulingBooking || !rescheduleDate || !rescheduleTime) return;
    setSubmittingAction(true);
    try {
      const res = await ownerFetch(`/api/v1/calendar/bookings/${reschedulingBooking.booking_id}/reschedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: rescheduleDate, time: rescheduleTime }),
      });
      if (res.ok) {
        showToast("Appointment rescheduled successfully ✓");
        setReschedulingBooking(null);
        void loadData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Could not reschedule booking", "error");
      }
    } catch {
      showToast("Error rescheduling appointment", "error");
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleCancel = async () => {
    if (!cancellingBooking) return;
    setSubmittingAction(true);
    try {
      const res = await ownerFetch(`/api/v1/calendar/bookings/${cancellingBooking.booking_id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason }),
      });
      if (res.ok) {
        showToast("Appointment cancelled ✓");
        setCancellingBooking(null);
        setCancelReason("");
        void loadData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Could not cancel booking", "error");
      }
    } catch {
      showToast("Error cancelling appointment", "error");
    } finally {
      setSubmittingAction(false);
    }
  };

  const markNotifRead = async (nid: string) => {
    await ownerFetch(`/api/v1/calendar/notifications/${nid}/read`, { method: "POST" });
    setNotifications((prev) => prev.map((n) => (n.notification_id === nid ? { ...n, read: true } : n)));
  };

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <OwnerShell>
      <main className="flex flex-col gap-5 max-w-6xl w-full pb-20 px-3 sm:px-0">
        {/* Toast */}
        {toast && (
          <div
            className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl shadow-xl text-[13px] font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-bottom-3 ${
              toast.type === "error" ? "bg-red-600 text-white" : "bg-emerald-700 text-white"
            }`}
          >
            {toast.type === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            {toast.msg}
          </div>
        )}

        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--claude-border)" }}>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: "var(--claude-text)" }}>
              Calendar & Automated Bookings
            </h1>
            <p className="text-xs sm:text-sm mt-1 text-gray-500">
              Live collision-free booking calendar, real-time voice & chat appointment sync, and reports.
            </p>
          </div>
          <button
            onClick={() => void loadData()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold text-gray-600 hover:bg-gray-50 self-start sm:self-auto"
            style={{ borderColor: "var(--claude-border)" }}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </header>

        {/* Analytics / Performance Reporting Banner */}
        {reports && (
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 rounded-2xl border bg-white shadow-sm flex flex-col gap-1" style={{ borderColor: "var(--claude-border)" }}>
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Total Bookings</span>
              <span className="text-2xl font-extrabold text-indigo-600">{reports.total_bookings}</span>
              <span className="text-[11px] text-gray-400">{reports.bookings_this_week} this week</span>
            </div>
            <div className="p-4 rounded-2xl border bg-white shadow-sm flex flex-col gap-1" style={{ borderColor: "var(--claude-border)" }}>
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Confirmed / Active</span>
              <span className="text-2xl font-extrabold text-emerald-600">{reports.confirmed_bookings}</span>
              <span className="text-[11px] text-gray-400">{reports.bookings_today} scheduled today</span>
            </div>
            <div className="p-4 rounded-2xl border bg-white shadow-sm flex flex-col gap-1" style={{ borderColor: "var(--claude-border)" }}>
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Cancellations</span>
              <span className="text-2xl font-extrabold text-rose-600">{reports.cancelled_bookings}</span>
              <span className="text-[11px] text-gray-400">{reports.cancellation_rate_pct}% cancel rate</span>
            </div>
            <div className="p-4 rounded-2xl border bg-white shadow-sm flex flex-col gap-1" style={{ borderColor: "var(--claude-border)" }}>
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">AI Booking Sources</span>
              <div className="flex items-center gap-3 mt-1 text-xs font-semibold">
                <span className="flex items-center gap-1 text-red-600"><Mic size={12} /> {reports.channel_breakdown.voice} Voice</span>
                <span className="flex items-center gap-1 text-indigo-600"><MessageSquare size={12} /> {reports.channel_breakdown.chat} Chat</span>
              </div>
              <span className="text-[10px] text-gray-400 mt-0.5">Real-time sync</span>
            </div>
          </section>
        )}

        {/* Services Section */}
        <section className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3 bg-white border shadow-sm" style={{ borderColor: "var(--claude-border)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-indigo-600" />
              <h2 className="text-sm font-bold text-gray-800">Bookable Services</h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 font-medium text-gray-600">
                {services.length} configured
              </span>
            </div>
            <button
              onClick={() => setShowAddService(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 flex items-center gap-1 transition-all"
            >
              <Plus size={13} /> Add Service
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {services.map((s) => (
              <div key={s.service_id} className="rounded-xl border p-3 flex items-center justify-between gap-2 bg-gray-50/50" style={{ borderColor: "var(--claude-border)" }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-gray-800 truncate">{s.name}</div>
                  <div className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
                    <Clock size={11} /> {s.duration_mins} minutes duration
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Active
                </span>
              </div>
            ))}
            {services.length === 0 && (
              <div className="text-xs col-span-full py-4 text-center text-gray-400">
                No services configured yet.
              </div>
            )}
          </div>
        </section>

        {/* Weekly Hours */}
        <section className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3 bg-white border shadow-sm" style={{ borderColor: "var(--claude-border)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-800">Weekly Operating Hours</h2>
              <p className="text-[11px] text-gray-500">AI agents will only book during open hours and verify real free slots.</p>
            </div>
            <button
              onClick={handleSaveHours}
              disabled={savingHours}
              className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Save size={13} /> {savingHours ? "Saving…" : "Save Hours"}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
            {availability.map((a, i) => (
              <div
                key={i}
                className={`rounded-xl border p-3 flex flex-col gap-1.5 transition-all ${
                  a.is_closed ? "bg-gray-100 border-gray-200 opacity-60" : "bg-white border-indigo-200 shadow-xs"
                }`}
              >
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-700">
                  {dayNames[a.weekday]}
                </div>
                {a.is_closed ? (
                  <span className="text-xs font-medium text-gray-400">Closed</span>
                ) : (
                  <span className="text-xs font-mono font-semibold text-indigo-900">
                    {a.start_time} — {a.end_time}
                  </span>
                )}
                <label className="flex items-center gap-1.5 text-[11px] mt-1 text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!a.is_closed}
                    onChange={(e) =>
                      setAvailability((prev) =>
                        prev.map((x, idx) => (idx === i ? { ...x, is_closed: !e.target.checked } : x))
                      )
                    }
                  />
                  Open
                </label>
              </div>
            ))}
          </div>
        </section>

        {/* Live Bookings Table */}
        <section className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3 bg-white border shadow-sm" style={{ borderColor: "var(--claude-border)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-800">All Scheduled Bookings & Appointments</h2>
              <p className="text-[11px] text-gray-500">Live appointments booked by callers or staff with instant collision prevention.</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-left text-gray-400 border-b pb-2" style={{ borderColor: "var(--claude-border)" }}>
                  <th className="py-2.5">Date & Time</th>
                  <th>Appointment / Title</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--claude-border)" }}>
                {bookings.map((b) => (
                  <tr key={b.booking_id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 text-xs font-mono font-medium text-gray-800">
                      {b.start_ts ? new Date(b.start_ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                    </td>
                    <td className="text-xs font-semibold text-gray-900 truncate max-w-[240px]">
                      {b.title}
                      <span className="block text-[10px] text-gray-400 font-mono">ID: {b.booking_id}</span>
                    </td>
                    <td className="text-xs">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        b.source === "voice" ? "bg-red-50 text-red-700" : b.source === "chat" ? "bg-indigo-50 text-indigo-700" : "bg-gray-100 text-gray-700"
                      }`}>
                        {b.source === "voice" ? <Mic size={10} /> : b.source === "chat" ? <MessageSquare size={10} /> : null}
                        {b.source || "agent"}
                      </span>
                    </td>
                    <td className="text-xs">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        b.status === "confirmed" || b.status === "rescheduled"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-rose-50 text-rose-700 border border-rose-200"
                      }`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="text-right">
                      {b.status !== "cancelled" && (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setReschedulingBooking(b);
                              const d = b.start_ts ? new Date(b.start_ts) : new Date();
                              setRescheduleDate(d.toISOString().slice(0, 10));
                              setRescheduleTime(d.toTimeString().slice(0, 5));
                            }}
                            className="px-2 py-1 rounded text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50"
                          >
                            Reschedule
                          </button>
                          <button
                            onClick={() => setCancellingBooking(b)}
                            className="px-2 py-1 rounded text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {bookings.length === 0 && (
              <div className="text-xs py-8 text-center text-gray-400">
                No appointments booked yet. Voice and chat agents will create live entries here.
              </div>
            )}
          </div>
        </section>

        {/* Notifications Section */}
        <section className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3 bg-white border shadow-sm" style={{ borderColor: "var(--claude-border)" }}>
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-amber-600" />
            <h2 className="text-sm font-bold text-gray-800">Recent Booking Alerts & Notifications</h2>
          </div>
          <div className="flex flex-col gap-2">
            {notifications.map((n) => (
              <div
                key={n.notification_id}
                onClick={() => !n.read && void markNotifRead(n.notification_id)}
                className={`p-3 rounded-xl border flex items-start justify-between gap-3 text-xs transition-all cursor-pointer ${
                  n.read ? "bg-white border-gray-100 text-gray-500" : "bg-amber-50/60 border-amber-200 text-amber-950 font-medium"
                }`}
              >
                <div>
                  <div className="font-bold text-[13px]">{n.title}</div>
                  <div className="text-gray-600 mt-0.5">{n.body}</div>
                  {n.created_at && (
                    <div className="text-[10px] text-gray-400 mt-1">
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  )}
                </div>
                {!n.read && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 mt-1.5" />
                )}
              </div>
            ))}
            {notifications.length === 0 && (
              <div className="text-xs py-4 text-center text-gray-400">No alerts recorded.</div>
            )}
          </div>
        </section>

        {/* Modal: Add Service */}
        {showAddService && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-2xl w-full max-w-sm p-5 border shadow-2xl flex flex-col gap-4" style={{ borderColor: "var(--claude-border)" }}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-800">Add Bookable Service</h3>
                <button onClick={() => setShowAddService(false)} className="text-gray-400 hover:text-gray-600">
                  <X size={16} />
                </button>
              </div>
              <form onSubmit={handleCreateService} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700">
                  Service Name
                  <input
                    value={newServiceName}
                    onChange={(e) => setNewServiceName(e.target.value)}
                    placeholder="e.g. Tooth Extraction"
                    required
                    className="w-full rounded-lg border px-3 py-2 text-xs outline-none focus:ring-1 bg-white"
                    style={{ borderColor: "var(--claude-border)" }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700">
                  Duration (Minutes)
                  <input
                    type="number"
                    min={10}
                    max={180}
                    value={newServiceDuration}
                    onChange={(e) => setNewServiceDuration(Number(e.target.value))}
                    required
                    className="w-full rounded-lg border px-3 py-2 text-xs outline-none focus:ring-1 bg-white"
                    style={{ borderColor: "var(--claude-border)" }}
                  />
                </label>
                <button
                  type="submit"
                  disabled={submittingAction}
                  className="w-full h-9 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-all mt-2"
                >
                  {submittingAction ? "Adding…" : "Save Service"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Reschedule */}
        {reschedulingBooking && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-2xl w-full max-w-sm p-5 border shadow-2xl flex flex-col gap-4" style={{ borderColor: "var(--claude-border)" }}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-800">Reschedule Appointment</h3>
                <button onClick={() => setReschedulingBooking(null)} className="text-gray-400 hover:text-gray-600">
                  <X size={16} />
                </button>
              </div>
              <p className="text-xs text-gray-500 font-medium">
                Rescheduling: <span className="font-bold text-gray-800">{reschedulingBooking.title}</span>
              </p>
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700">
                  New Date (YYYY-MM-DD)
                  <input
                    type="date"
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-xs outline-none bg-white"
                    style={{ borderColor: "var(--claude-border)" }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700">
                  New Time (HH:MM)
                  <input
                    type="time"
                    value={rescheduleTime}
                    onChange={(e) => setRescheduleTime(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-xs outline-none bg-white"
                    style={{ borderColor: "var(--claude-border)" }}
                  />
                </label>
                <button
                  onClick={handleReschedule}
                  disabled={submittingAction || !rescheduleDate || !rescheduleTime}
                  className="w-full h-9 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-all mt-2"
                >
                  {submittingAction ? "Updating…" : "Confirm Reschedule"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Cancel */}
        {cancellingBooking && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-2xl w-full max-w-sm p-5 border shadow-2xl flex flex-col gap-4" style={{ borderColor: "var(--claude-border)" }}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-rose-700">Cancel Appointment</h3>
                <button onClick={() => setCancellingBooking(null)} className="text-gray-400 hover:text-gray-600">
                  <X size={16} />
                </button>
              </div>
              <p className="text-xs text-gray-600">
                Are you sure you want to cancel <span className="font-bold">{cancellingBooking.title}</span>?
              </p>
              <label className="flex flex-col gap-1 text-xs font-semibold text-gray-700">
                Cancellation Reason (optional)
                <input
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Caller requested cancellation"
                  className="w-full rounded-lg border px-3 py-2 text-xs outline-none bg-white"
                  style={{ borderColor: "var(--claude-border)" }}
                />
              </label>
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => setCancellingBooking(null)}
                  className="flex-1 h-9 rounded-xl border text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  style={{ borderColor: "var(--claude-border)" }}
                >
                  Keep
                </button>
                <button
                  onClick={handleCancel}
                  disabled={submittingAction}
                  className="flex-1 h-9 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition-all"
                >
                  {submittingAction ? "Cancelling…" : "Yes, Cancel"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </OwnerShell>
  );
}
