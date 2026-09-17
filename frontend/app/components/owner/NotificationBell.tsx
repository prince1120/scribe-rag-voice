"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
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
  const getDeepLink = (n: { title: string; body?: string }) => {
    const text = `${n.title} ${n.body || ""}`.toLowerCase();
    if (text.includes("product qr") || text.includes("support request") || text.includes("service request")) {
      const uuidMatch = (n.body || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      return uuidMatch ? `/inbox?tab=support&request_id=${uuidMatch[0]}` : "/inbox?tab=support";
    }
    return null;
  };
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
          {items.length === 0 ? <div className="p-4 text-xs text-center" style={{ color: "var(--claude-muted)" }}>No notifications yet</div> : items.map((n) => {
            const deepLink = getDeepLink(n);
            return (
              <div key={n.notification_id} className="px-3 py-2.5 border-b flex flex-col gap-1" style={{ borderColor: "var(--claude-border)", opacity: n.read ? 0.6 : 1 }}>
                <div className="text-xs font-semibold">{n.title}</div>
                {n.body && <div className="text-[11px]" style={{ color: "var(--claude-muted)" }}>{n.body}</div>}
                <div className="flex items-center justify-between pt-0.5">
                  <div className="text-[10px]" style={{ color: "var(--claude-muted)" }}>{n.created_at ? new Date(n.created_at).toLocaleString() : ""}</div>
                  <div className="flex items-center gap-2">
                    {deepLink && (
                      <Link
                        href={deepLink}
                        onClick={() => {
                          setOpen(false);
                          if (!n.read) void markRead(n.notification_id);
                        }}
                        className="text-[11px] font-medium hover:underline"
                        style={{ color: "var(--claude-accent)" }}
                      >
                        Open &rarr;
                      </Link>
                    )}
                    {!n.read && <button className="text-[11px]" style={{ color: "var(--claude-accent)" }} onClick={() => void markRead(n.notification_id)}>Mark as read</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
