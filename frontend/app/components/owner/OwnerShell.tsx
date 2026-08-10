"use client";

// The frame every owner screen sits in.
//
// Deliberately not the personal app's chrome. The personal product is a
// reading surface — wide margins, warm paper, one column, nothing competing
// with the answer. An owner panel is a working surface: someone checking on a
// deployed assistant, scanning who called, changing a prompt. It gets
// persistent navigation, tighter density, a cooler and flatter palette, and
// status that is visible without hunting for it.
//
// Same brand, different job.

import { usePathname } from "next/navigation";
import { useState } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const NAV: NavItem[] = [
  {
    href: "/dashboard",
    label: "Overview",
    icon: (
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
        <rect x="11" y="3" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
        <rect x="3" y="11" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
        <rect x="11" y="11" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    href: "/agent",
    label: "Assistant",
    icon: (
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 6.5v3.5l2.2 1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/links",
    label: "People",
    icon: (
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
        <circle cx="7.5" cy="7" r="2.8" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3 16c0-2.5 2-4.2 4.5-4.2S12 13.5 12 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M13.5 6.2a2.6 2.6 0 0 1 0 4.6M15 15.8c0-1.9-.7-3.2-1.8-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function OwnerShell({
  children,
  businessName,
  status,
}: {
  children: React.ReactNode;
  businessName?: string | null;
  /** "deployed" | "draft" — shown in the rail because whether an assistant is
   *  answering strangers is the fact an owner most needs at a glance. */
  status?: string;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="owner-shell">
      <aside className={`owner-rail ${menuOpen ? "is-open" : ""}`}>
        <div className="owner-brand">
          <span className="owner-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
              <path d="M7 4h7l4 4v12H7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M14 4v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="owner-brand-text">
            <span className="owner-brand-name">{businessName || "Your business"}</span>
            <span className="owner-brand-sub">Scribe console</span>
          </span>
        </div>

        <nav className="owner-nav" aria-label="Console">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`owner-nav-item ${pathname === item.href ? "is-active" : ""}`}
              aria-current={pathname === item.href ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {item.icon}
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        {status && (
          <div className={`owner-rail-status ${status === "deployed" ? "is-live" : ""}`}>
            <span className="owner-rail-dot" aria-hidden="true" />
            {status === "deployed" ? "Assistant is live" : "Draft — not answering"}
          </div>
        )}
      </aside>

      {menuOpen && (
        <div
          className="owner-scrim"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="owner-main">
        <header className="owner-topbar">
          <button
            type="button"
            className="owner-menu ds-pressable ds-tap"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={menuOpen}
          >
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
              <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
          <span className="owner-topbar-name">{businessName || "Your business"}</span>
        </header>

        <div className="owner-content ds-scroll">{children}</div>
      </div>
    </div>
  );
}
