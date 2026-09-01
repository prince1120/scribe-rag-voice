"use client";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { ownerFetch } from "../../lib/ownerFetch";

export function NotificationBell() {
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const load = async () => {
    try {
      const r = await ownerFetch("/api/v1/calendar/notifications");
      if (r.ok) setItems(await r.json());
    } catch {}
  };
  useEffect(() => {
    void load();
    const id = setInterval(load, 120000);
    return () => clearInterval(id);
  }, []);
  const unread = items.filter((x) => !x.read).length;
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="relative w-9 h-9 rounded-full flex items-center justify-center border" style={{ borderColor: "var(--claude-border)", background: "var(--claude-surface)" }}>
        <Bell size={16} />
        {unread > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1" style={{ background: "var(--color-danger)" }}>{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-xl shadow-xl border max-h-80 overflow-y-auto z-50" style={{ background: "var(--claude-surface)", borderColor: "var(--claude-border)" }}>
          <div className="p-3 border-b text-xs font-bold" style={{ borderColor: "var(--claude-border)" }}>Notifications (owner only)</div>
          {items.length === 0 ? <div className="p-4 text-xs text-center" style={{ color: "var(--claude-muted)" }}>No notifications yet</div> : items.map((n) => (
            <div key={n.notification_id} className="px-3 py-2.5 border-b flex flex-col gap-0.5" style={{ borderColor: "var(--claude-border)", opacity: n.read ? 0.6 : 1 }}>
              <div className="text-xs font-semibold">{n.title}</div>
              {n.body && <div className="text-[11px]" style={{ color: "var(--claude-muted)" }}>{n.body}</div>}
              <div className="text-[10px]" style={{ color: "var(--claude-muted)" }}>{n.created_at ? new Date(n.created_at).toLocaleString() : ""}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
