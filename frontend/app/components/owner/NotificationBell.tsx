"use client";
import { useEffect, useState, useRef } from "react";
import { Bell } from "lucide-react";
import { ownerFetch } from "../../lib/ownerFetch";

export function NotificationBell() {
  const [items, setItems] = useState<{ notification_id: string; title: string; body?: string; read: boolean; created_at?: string }[]>([]);
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const load = async () => {
    try {
      const r = await ownerFetch("/api/v1/calendar/notifications");
      if (!r.ok) throw new Error();
      setItems(await r.json()); setError("");
    } catch { setError("Could not load notifications."); }
  };
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const first = setTimeout(refresh, 0);
    const id = setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearTimeout(first); clearInterval(id); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  async function markRead(id: string) {
    try {
      const r = await ownerFetch(`/api/v1/calendar/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
      if (!r.ok) throw new Error();
      setItems(current => current.map(n => n.notification_id === id ? { ...n, read: true } : n));
    } catch { setError("Could not mark notification as read."); }
  }
  const unread = items.filter((x) => !x.read).length;
  return (
    <div className="relative" ref={panel}>
      <button aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={() => { setOpen((v) => !v); if (!open) void load(); }} className="relative w-9 h-9 rounded-full flex items-center justify-center border" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}>
        <Bell size={16} />
        {unread > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1" style={{ background: "var(--color-danger)" }}>{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-xl shadow-xl border max-h-80 overflow-y-auto z-50" style={{ background: "var(--claude-surface)", borderColor: "var(--claude-border)" }}>
          <div className="p-4 border-b text-sm font-semibold" style={{ borderColor: "var(--claude-border)" }}>Notifications</div>
          {error && <div className="p-3 text-xs" role="alert">{error} <button onClick={() => void load()} className="underline">Try again</button></div>}
          {items.length === 0 ? <div className="p-4 text-xs text-center" style={{ color: "var(--claude-muted)" }}>No notifications yet</div> : items.map((n) => (
            <div key={n.notification_id} className="px-3 py-2.5 border-b flex flex-col gap-0.5" style={{ borderColor: "var(--claude-border)", opacity: n.read ? 0.6 : 1 }}>
              <div className="text-xs font-semibold">{n.title}</div>
              {!n.read && <button className="text-left text-[11px] py-1" style={{ color: "var(--claude-accent)" }} onClick={() => void markRead(n.notification_id)}>Mark as read</button>}
              {n.body && <div className="text-[11px]" style={{ color: "var(--claude-muted)" }}>{n.body}</div>}
              <div className="text-[10px]" style={{ color: "var(--claude-muted)" }}>{n.created_at ? new Date(n.created_at).toLocaleString() : ""}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
