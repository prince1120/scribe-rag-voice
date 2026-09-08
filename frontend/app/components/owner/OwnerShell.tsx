"use client";

// The frame every owner screen sits in.
//
// Modern, sleek console interface with persistent responsive navigation,
// dark glassmorphism sidebar, live agent indicators, and mobile drawer support.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Bot,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
  Radio,
  ExternalLink,
  Sparkles,
  Calendar,
  Layers,
  Inbox,
} from "lucide-react";
import { clearWorkspaceCache, useWorkspace } from "../../lib/workspaceCache";
import { NotificationBell } from "./NotificationBell";
import { ScribeMark } from "../../Logo";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const NAV: NavItem[] = [
  { href: "/inbox", label: "Inbox", icon: <Inbox size={18} /> },
  {
    href: "/dashboard",
    label: "Overview",
    icon: <LayoutDashboard size={18} />,
  },
  {
    href: "/agent",
    label: "Assistant",
    icon: <Bot size={18} />,
  },
  {
    href: "/agents",
    label: "My Agents",
    icon: <Layers size={18} />,
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: <Calendar size={18} />,
  },
  {
    href: "/links",
    label: "People & Calls",
    icon: <Users size={18} />,
  },
  {
    href: "/settings",
    label: "Account & Keys",
    icon: <Settings size={18} />,
  },
];

export function OwnerShell({
  children,
  businessName: propBusinessName,
  status: propStatus,
}: {
  children: React.ReactNode;
  businessName?: string | null;
  /** "deployed" | "draft" — shown in the rail so status is visible at a glance */
  status?: string;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const workspace = useWorkspace();

  const businessName = propBusinessName || workspace.businessName;
  const isLive = propStatus ? propStatus === "deployed" : workspace.isLive;

  return (
    <div className="owner-shell">
      {/* ── Left Navigation Rail ─────────────────────────────── */}
      <aside className={`owner-rail ${menuOpen ? "is-open" : ""}`}>
        {/* Brand Lockup */}
        <div className="owner-brand">
          <div className="owner-brand-mark" aria-hidden="true">
            <ScribeMark className="w-5 h-5" />
          </div>
          <div className="owner-brand-text">
            <span
              className="owner-brand-name"
              title={businessName || "Your business"}
              suppressHydrationWarning
            >
              {businessName || "Your business"}
            </span>
            <span className="owner-brand-sub">Scribe Voice Console</span>
          </div>
          {menuOpen && (
            <button
              type="button"
              className="owner-close-btn"
              onClick={() => setMenuOpen(false)}
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="owner-nav" aria-label="Console Navigation">
          <div className="owner-nav-section-label">MAIN MENU</div>
          {NAV.map((item) => {
            const isCurrent = pathname === item.href;
            const active = isCurrent;

            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                className={`owner-nav-item ${active ? "is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  setMenuOpen(false);
                }}
              >
                <span className="owner-nav-icon">{item.icon}</span>
                <span className="owner-nav-label">{item.label}</span>
                {active && <span className="owner-nav-indicator" />}
              </Link>
            );
          })}

          <div className="owner-nav-section-label" style={{ marginTop: "1rem" }}>
            LINKS & ACTIONS
          </div>

          <Link
            href="/directory"
            prefetch={true}
            className="owner-nav-item"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
          >
            <span className="owner-nav-icon">
              <ExternalLink size={17} />
            </span>
            <span className="owner-nav-label">Public Directory</span>
          </Link>

          <button
            type="button"
            className="owner-nav-item owner-nav-logout"
            onClick={async () => {
              try {
                await fetch("/api/v1/workspace/logout", { method: "POST", credentials: "include" });
              } catch {
                // proceed
              }
              // Before navigating, not after: the cache is persisted in
              // localStorage, so without this the next person to sign in on
              // this browser sees the previous account's business name, email,
              // and agent config until their own first fetch lands.
              clearWorkspaceCache();
              window.location.href = "/signin";
            }}
          >
            <span className="owner-nav-icon">
              <LogOut size={17} />
            </span>
            <span className="owner-nav-label">Sign out</span>
          </button>
        </nav>

        {/* Live Status Pill at Bottom of Rail */}
        <div className="owner-rail-bottom" suppressHydrationWarning>
          <div className={`owner-rail-status ${isLive ? "is-live" : ""}`}>
            <span className="owner-rail-dot-wrap">
              <span className={`owner-rail-dot ${isLive ? "is-live" : ""}`} />
              {isLive && <span className="owner-rail-pulse" />}
            </span>
            <div className="owner-rail-status-info">
              <span className="owner-rail-status-title" suppressHydrationWarning>
                {isLive ? "Assistant is Live" : "Draft Mode"}
              </span>
              <span className="owner-rail-status-desc" suppressHydrationWarning>
                {isLive ? "Accepting calls & chats" : "Not answering public calls"}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Backdrop Scrim */}
      {menuOpen && (
        <div
          className="owner-scrim"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Main Content Area ───────────────────────────────── */}
      <div className="owner-main">
        {/* Mobile Top Bar */}
        <header className="owner-topbar">
          <button
            type="button"
            className="owner-menu"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="owner-topbar-info">
            <span className="owner-topbar-name" suppressHydrationWarning>
              {businessName || "Your business"}
            </span>
            <span className="owner-topbar-sub">Scribe Console</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <div className={`owner-topbar-badge ${isLive ? "is-live" : ""}`} suppressHydrationWarning>
            <span className={`owner-rail-dot ${isLive ? "is-live" : ""}`} />
            <span>{isLive ? "Live" : "Draft"}</span>
          </div>
          </div>
        </header>

        {/* Scrollable Content Viewport */}
        <div className="owner-content"><div key={pathname} className="studio-page-enter">{children}</div></div>
      </div>
    </div>
  );
}
