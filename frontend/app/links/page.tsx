"use client";

// People & Call History: Unique callers list, session history,
// invite link management, custom delete modal, and full turn-by-turn dialogue transcript viewer.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Bot,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  History,
  Link2,
  Lock,
  MessageCircle,
  MessageSquare,
  Mic,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Smartphone,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";

import { ownerFetch } from "../lib/ownerFetch";
import { OwnerShell } from "../components/owner/OwnerShell";
import { getWorkspaceCache, setWorkspaceCache } from "../lib/workspaceCache";

interface Contact {
  contact_id: string;
  name: string;
  note?: string | null;
  mode: string;
  has_pin: boolean;
  device_bound: boolean;
  revoked: boolean;
  blocked: boolean;
  last_seen_at?: string | null;
  created_at?: string | null;
  session_count?: number;
}

interface Session {
  session_id: string;
  channel: string;
  started_at?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  message_count: number;
  agent_name?: string;
  business_name?: string;
}

interface Turn {
  role: string;
  content: string;
  at?: string | null;
}

function linkFor(token: string): string {
  return `${window.location.origin}/t/${token}`;
}

function formatWhen(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeTime(value?: string | null): string {
  if (!value) return "";
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const ITEMS_PER_PAGE = 8;

export default function LinksPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"voice" | "chat" | "both">("both");
  const [pin, setPin] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Custom in-app Delete Confirmation Modal
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Fresh generated link banner
  const [freshLink, setFreshLink] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Open sessions mapped per contact_id so multiple drawers can be open at once
  const [openSessionsMap, setOpenSessionsMap] = useState<Record<string, Session[]>>({});
  const [loadingSessionsMap, setLoadingSessionsMap] = useState<Record<string, boolean>>({});

  // Full transcript modal
  const [transcriptModal, setTranscriptModal] = useState<{
    callerName: string;
    sessionId: string;
    turns: Turn[];
    channel: string;
    date: string;
  } | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  // Search & Filter
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "blocked" | "revoked">("all");
  const [busy, setBusy] = useState<Record<string, string>>({});

  const loadContacts = useCallback(async () => {
    try {
      const response = await ownerFetch("/api/v1/contacts");
      if (response.status === 403 || response.status === 401) {
        setError("Sign in as the owner to view people & call links.");
        return;
      }
      if (!response.ok) throw new Error();
      const list: Contact[] = await response.json();
      setContacts(list);
      setWorkspaceCache({ contactsData: list });
      setError("");
    } catch {
      if (contacts.length === 0) setError("Could not load contact links.");
    } finally {
      setLoading(false);
    }
  }, [contacts.length]);

  useEffect(() => {
    const cached = getWorkspaceCache();
    if (cached.contactsData && cached.contactsData.length > 0) {
      setContacts(cached.contactsData);
      setLoading(false);
    }
    void loadContacts();
  }, [loadContacts]);

  // In-memory cache so subsequent toggles are 0.00ms instantaneous
  const sessionsCache = useRef<Record<string, Session[]>>({});

  const toggleSessions = async (contactId: string) => {
    if (openSessionsMap[contactId] !== undefined) {
      // Toggle close this specific contact
      setOpenSessionsMap((prev) => {
        const next = { ...prev };
        delete next[contactId];
        return next;
      });
      return;
    }

    // If cached in memory, open immediately with all 10 talk cards at 0ms!
    if (sessionsCache.current[contactId]) {
      setOpenSessionsMap((prev) => ({ ...prev, [contactId]: sessionsCache.current[contactId] }));
      return;
    }

    // Instant 0ms open: Open drawer immediately showing the live database sync spinner
    setOpenSessionsMap((prev) => ({ ...prev, [contactId]: [] }));
    setLoadingSessionsMap((prev) => ({ ...prev, [contactId]: true }));
    try {
      const res = await ownerFetch(`/api/v1/contacts/${contactId}/sessions`);
      if (res.ok) {
        const data = await res.json();
        const list = (data.sessions || []).filter(
          (s: Session) => s.channel === "voice" || s.message_count > 0
        );
        sessionsCache.current[contactId] = list;
        setOpenSessionsMap((prev) => ({ ...prev, [contactId]: list }));
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingSessionsMap((prev) => ({ ...prev, [contactId]: false }));
    }
  };

  const createLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    try {
      const response = await ownerFetch("/api/v1/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          mode,
          pin: pin.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.detail || "Could not generate access link.");
      }

      const data = await response.json();
      setFreshLink({ name: data.name, url: linkFor(data.token) });
      setName("");
      setPin("");
      setShowCreateModal(false);
      await loadContacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create link.");
    } finally {
      setCreating(false);
    }
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* ignore */
    }
  };


  const viewTranscript = async (contact: Contact, session: Session) => {
    setTranscriptModal({
      callerName: contact.name,
      sessionId: session.session_id,
      turns: [],
      channel: session.channel,
      date: formatWhen(session.started_at),
    });
    setLoadingTranscript(true);

    try {
      const res = await ownerFetch(
        `/api/v1/contacts/${contact.contact_id}/transcript?session_id=${session.session_id}`
      );
      if (res.ok) {
        const data = await res.json();
        setTranscriptModal((prev) =>
          prev ? { ...prev, turns: data.messages || [] } : null
        );
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingTranscript(false);
    }
  };

  const rotateToken = async (contactId: string, contactName: string) => {
    setBusy((b) => ({ ...b, [contactId]: "rotate" }));
    try {
      const res = await ownerFetch(`/api/v1/contacts/${contactId}/rotate`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setFreshLink({ name: contactName, url: linkFor(data.token) });
        await loadContacts();
      }
    } finally {
      setBusy((b) => ({ ...b, [contactId]: "" }));
    }
  };

  const toggleBlock = async (contactId: string, blocked: boolean) => {
    setBusy((b) => ({ ...b, [contactId]: "block" }));
    try {
      await ownerFetch(`/api/v1/contacts/${contactId}/${blocked ? "block" : "unblock"}`, {
        method: "POST",
        credentials: "include",
      });
      await loadContacts();
    } finally {
      setBusy((b) => ({ ...b, [contactId]: "" }));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await ownerFetch(`/api/v1/contacts/${deleteTarget.contact_id}`, {
        method: "DELETE",
        credentials: "include",
      });
      setDeleteTarget(null);
      await loadContacts();
    } finally {
      setDeleting(false);
    }
  };

  // Filter contacts
  const filteredContacts = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (q && !c.name.toLowerCase().includes(q) && !(c.note || "").toLowerCase().includes(q)) {
      return false;
    }
    if (filter === "active") return !c.blocked && !c.revoked;
    if (filter === "blocked") return c.blocked;
    if (filter === "revoked") return c.revoked;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / ITEMS_PER_PAGE));
  const paginatedContacts = filteredContacts.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE
  );

  return (
    <OwnerShell>
      <main style={S.page}>
        {/* ── Header ─────────────────────────────────────────── */}
        <header style={S.header}>
          <div>
            <h1 style={S.title}>People & Call Management</h1>
            <p style={S.subtitle}>
              Manage customer access links, review unique callers, and inspect full conversation transcripts.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            style={S.createBtn}
          >
            <Plus size={16} />
            <span>Create Access Link</span>
          </button>
        </header>

        {error && <div style={S.errorBanner}>{error}</div>}

        {/* Fresh Link Success Card */}
        {freshLink && (
          <div style={S.freshCard}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Check size={18} style={{ color: "#16a34a" }} />
              <div>
                <span style={{ fontWeight: 700, fontSize: 13, color: "#14532d" }}>
                  Access Link for {freshLink.name} Ready
                </span>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#166534" }}>
                  Copy this link now. It can be shared directly with {freshLink.name} to talk with your AI assistant.
                </p>
              </div>
            </div>

            <div style={S.freshRow}>
              <input readOnly value={freshLink.url} style={S.freshInput} />
              <button
                type="button"
                onClick={() => copyUrl(freshLink.url)}
                style={S.copyBtn}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? "Copied" : "Copy Link"}</span>
              </button>
              <button
                type="button"
                onClick={() => setFreshLink(null)}
                style={S.dismissBtn}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* ── Tabs & Filter Bar ──────────────────────────────── */}
        <div style={S.toolbar}>
          {/* Search Box */}
          <div style={S.searchBox}>
            <Search size={16} style={{ color: "#94a3b8" }} />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by caller name…"
              style={S.searchInput}
            />
          </div>

          {/* Filter Pills */}
          <div style={S.filterPills}>
            {(["all", "active", "blocked", "revoked"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFilter(f);
                  setPage(1);
                }}
                style={{
                  ...S.filterPill,
                  background: filter === f ? "#0f172a" : "#f1f5f9",
                  color: filter === f ? "#ffffff" : "#475569",
                }}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* ── Callers List ───────────────────────────────────── */}
        {loading && contacts.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", color: "#64748b", fontSize: 13 }}>
              <RefreshCw size={14} className="animate-spin" style={{ color: "#3b82f6" }} />
              <span>Fetching callers and access links from database…</span>
            </div>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  ...S.contactCard,
                  opacity: 0.75,
                }}
              >
                <div style={S.contactTop}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ ...S.avatar, background: "#e2e8f0" }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ width: 140, height: 16, background: "#e2e8f0", borderRadius: 4 }} />
                      <div style={{ width: 80, height: 12, background: "#f1f5f9", borderRadius: 4 }} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ width: 90, height: 28, background: "#f1f5f9", borderRadius: 8 }} />
                    <div style={{ width: 70, height: 28, background: "#f1f5f9", borderRadius: 8 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredContacts.length === 0 ? (
          <div style={S.emptyState}>
            <Users size={32} style={{ color: "#cbd5e1", marginBottom: 8 }} />
            <p style={{ margin: 0, fontWeight: 600 }}>No callers found</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#94a3b8" }}>
              {search
                ? "No one matches your search query."
                : "Create your first invite link above or share your assistant from directory."}
            </p>
          </div>
        ) : (
          <>
            <div style={S.contactsList}>
              {paginatedContacts.map((contact) => {
                const isSessionsOpen = openSessionsMap[contact.contact_id] !== undefined;
                const contactSessions = openSessionsMap[contact.contact_id] || [];
                const isLoadingSessions = Boolean(loadingSessionsMap[contact.contact_id]);
                const talksCount = typeof contact.session_count === "number" ? contact.session_count : 0;

                return (
                  <div key={contact.contact_id} style={S.contactCard}>
                    <div style={S.contactTop}>
                      {/* Caller Avatar & Name */}
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={S.avatar}>{initials(contact.name)}</div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={S.contactName}>{contact.name}</span>

                            {/* Prominent Session Count Badge */}
                            <span
                              style={{
                                ...S.sessionCountBadge,
                                background: talksCount > 0 ? "#ede9fe" : "#f1f5f9",
                                color: talksCount > 0 ? "#6d28d9" : "#64748b",
                                border: talksCount > 0 ? "1px solid #ddd6fe" : "1px solid #e2e8f0",
                              }}
                            >
                              <History size={11} />
                              <span>{talksCount} Completed Talk{talksCount === 1 ? "" : "s"}</span>
                            </span>

                            {contact.device_bound && (
                              <span style={{ ...S.tag, background: "#f0fdf4", color: "#15803d" }}>
                                Device Bound
                              </span>
                            )}
                            {contact.has_pin && (
                              <span style={{ ...S.tag, background: "#fef3c7", color: "#b45309" }}>
                                PIN Protected
                              </span>
                            )}
                            {contact.blocked && (
                              <span style={{ ...S.tag, background: "#fee2e2", color: "#b91c1c" }}>
                                Blocked
                              </span>
                            )}
                            {contact.revoked && (
                              <span style={{ ...S.tag, background: "#f1f5f9", color: "#64748b" }}>
                                Revoked
                              </span>
                            )}
                          </div>

                          <p style={S.contactMeta}>
                            {contact.mode === "voice"
                              ? "Voice Calls Only"
                              : contact.mode === "chat"
                              ? "Chat Only"
                              : "Voice & Chat"}{" "}
                            • Last active {formatWhen(contact.last_seen_at)}
                          </p>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div style={S.actionsRow}>
                        <button
                          type="button"
                          onClick={() => toggleSessions(contact.contact_id)}
                          style={{
                            ...S.actionBtn,
                            background: isSessionsOpen ? "#4f46e5" : "#f8fafc",
                            color: isSessionsOpen ? "#ffffff" : "#334155",
                            borderColor: isSessionsOpen ? "#4f46e5" : "#e2e8f0",
                          }}
                        >
                          <History size={14} />
                          <span>{isSessionsOpen ? "Hide Sessions" : `View Sessions (${talksCount})`}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => rotateToken(contact.contact_id, contact.name)}
                          disabled={Boolean(busy[contact.contact_id])}
                          style={S.actionBtn}
                          title="Generate a new fresh link for this caller"
                        >
                          <Link2 size={14} />
                          <span>New Link</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleBlock(contact.contact_id, !contact.blocked)}
                          disabled={Boolean(busy[contact.contact_id])}
                          style={{
                            ...S.actionBtn,
                            color: contact.blocked ? "#16a34a" : "#d97706",
                          }}
                        >
                          <Ban size={14} />
                          <span>{contact.blocked ? "Unblock" : "Block"}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setDeleteTarget(contact)}
                          disabled={Boolean(busy[contact.contact_id])}
                          style={{ ...S.actionBtn, color: "#dc2626" }}
                          title="Delete contact and all call transcripts"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Sessions Drawer for this Contact */}
                    {isSessionsOpen && (
                      <div style={S.sessionsDrawer}>
                        <div style={S.drawerHeader}>
                          <span style={S.drawerTitle}>
                            Recorded Conversations for {contact.name}
                          </span>
                          <span style={{ fontSize: 12, color: "#64748b" }}>
                            {contactSessions.length} talk{contactSessions.length === 1 ? "" : "s"}
                          </span>
                        </div>

                        {isLoadingSessions ? (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "24px 0", color: "#64748b", fontSize: 13 }}>
                            <RefreshCw size={15} className="animate-spin" style={{ color: "#4f46e5" }} />
                            <span>Fetching conversation history from database…</span>
                          </div>
                        ) : contactSessions.length === 0 ? (
                          <p style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: "16px 0" }}>
                            No completed call or chat conversations recorded yet for this person.
                          </p>
                        ) : (
                          <div style={S.sessionListGrid}>
                            {contactSessions.map((session) => (
                              <div key={session.session_id} style={S.sessionCardItem}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span
                                    style={{
                                      ...S.channelBadge,
                                      background: session.channel === "voice" ? "#fce7f3" : "#dbeafe",
                                      color: session.channel === "voice" ? "#db2777" : "#2563eb",
                                    }}
                                  >
                                    {session.channel === "voice" ? (
                                      <Mic size={12} />
                                    ) : (
                                      <MessageSquare size={12} />
                                    )}
                                    <span>{session.channel === "voice" ? "Voice Call" : "Chat"}</span>
                                  </span>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>
                                    {formatWhen(session.started_at)}
                                  </span>
                                </div>

                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                                  <span style={{ fontSize: 11, color: "#64748b" }}>
                                    {session.message_count ? `${session.message_count} dialogue turns` : "Live Talk"}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => viewTranscript(contact, session)}
                                    style={S.viewTranscriptBtn}
                                  >
                                    <MessageCircle size={13} />
                                    <span>View Transcript</span>
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={S.paginationRow}>
                <span style={S.paginationText}>
                  Showing {(page - 1) * ITEMS_PER_PAGE + 1}–
                  {Math.min(page * ITEMS_PER_PAGE, filteredContacts.length)} of {filteredContacts.length} callers
                </span>

                <div style={S.paginationBtns}>
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    style={{
                      ...S.pageBtn,
                      opacity: page <= 1 ? 0.4 : 1,
                      cursor: page <= 1 ? "not-allowed" : "pointer",
                    }}
                  >
                    <ChevronLeft size={16} />
                    <span>Previous</span>
                  </button>

                  <span style={S.pageIndicator}>
                    Page {page} of {totalPages}
                  </span>

                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    style={{
                      ...S.pageBtn,
                      opacity: page >= totalPages ? 0.4 : 1,
                      cursor: page >= totalPages ? "not-allowed" : "pointer",
                    }}
                  >
                    <span>Next</span>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Create Link Modal ───────────────────────────────── */}
        {showCreateModal && (
          <div style={S.modalBackdrop} onClick={() => setShowCreateModal(false)}>
            <div style={S.modalCard} onClick={(e) => e.stopPropagation()}>
              <div style={S.modalCardHeader}>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#0f172a" }}>
                  Create Customer Access Link
                </h2>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={S.modalClose}
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={createLink} style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={S.label}>Caller / Customer Name</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Ramesh, Priya Sharma"
                    required
                    autoFocus
                    style={S.modalInput}
                  />
                </div>

                <div>
                  <label style={S.label}>Allowed Interaction Mode</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as "voice" | "chat" | "both")}
                    style={S.modalInput}
                  >
                    <option value="voice">Voice Call Only 📞</option>
                    <option value="chat">Chat Only 💬</option>
                    <option value="both">Both Voice & Chat</option>
                  </select>
                </div>

                <div>
                  <label style={S.label}>
                    Security PIN <span style={{ color: "#94a3b8", fontWeight: 400 }}>(Optional)</span>
                  </label>
                  <input
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="4-digit PIN for access"
                    maxLength={12}
                    style={S.modalInput}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    style={S.cancelBtn}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!name.trim() || creating}
                    style={S.submitBtn}
                  >
                    {creating ? "Generating…" : "Generate Link"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Custom In-App Delete Confirmation Modal ─────────── */}
        {deleteTarget && (
          <div style={S.modalBackdrop} onClick={() => !deleting && setDeleteTarget(null)}>
            <div style={S.confirmCard} onClick={(e) => e.stopPropagation()}>
              <div style={S.confirmIconWrap}>
                <AlertTriangle size={24} style={{ color: "#dc2626" }} />
              </div>

              <h2 style={S.confirmTitle}>Delete {deleteTarget.name}?</h2>
              <p style={S.confirmDesc}>
                This will permanently delete <strong>{deleteTarget.name}</strong>, revoke their access link, and erase all associated conversation session transcripts. This action cannot be undone.
              </p>

              <div style={S.confirmActions}>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteTarget(null)}
                  style={S.cancelBtn}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={confirmDelete}
                  style={S.deleteBtn}
                >
                  {deleting ? "Deleting…" : "Delete Contact"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Conversation Transcript Viewer Modal ────────────── */}
        {transcriptModal && (
          <div style={S.modalBackdrop} onClick={() => setTranscriptModal(null)}>
            <div style={S.transcriptModalContent} onClick={(e) => e.stopPropagation()}>
              <div style={S.modalHeader}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={S.modalTitle}>{transcriptModal.callerName}'s Conversation</span>
                    <span
                      style={{
                        ...S.channelBadge,
                        background: transcriptModal.channel === "voice" ? "#fce7f3" : "#dbeafe",
                        color: transcriptModal.channel === "voice" ? "#db2777" : "#2563eb",
                      }}
                    >
                      {transcriptModal.channel === "voice" ? "Voice Call" : "Chat"}
                    </span>
                  </div>
                  <p style={S.modalSub}>{transcriptModal.date}</p>
                </div>

                <button
                  type="button"
                  onClick={() => setTranscriptModal(null)}
                  style={S.modalClose}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={S.modalBody}>
                {loadingTranscript ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "12px 4px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 14px", background: "#f8fafc", borderRadius: 20, border: "1px solid #e2e8f0", width: "fit-content", margin: "0 auto 8px", fontSize: 12, color: "#64748b", fontWeight: 500 }}>
                      <RefreshCw size={13} className="animate-spin" style={{ color: "#4f46e5" }} />
                      <span>Loading dialogue transcript from database…</span>
                    </div>

                    {/* Turn 1: Assistant Skeleton */}
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", maxWidth: "80%" }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#ede9fe", flexShrink: 0 }} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                        <div style={{ padding: "12px 16px", borderRadius: "4px 16px 16px 16px", background: "#f8fafc", border: "1px solid #f1f5f9", display: "flex", flexDirection: "column", gap: 8, width: 240 }}>
                          <div style={{ width: "90%", height: 12, background: "#e2e8f0", borderRadius: 4 }} />
                          <div style={{ width: "65%", height: 12, background: "#e2e8f0", borderRadius: 4 }} />
                        </div>
                      </div>
                    </div>

                    {/* Turn 2: User Skeleton */}
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "flex-end", maxWidth: "80%", alignSelf: "flex-end" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", width: "100%" }}>
                        <div style={{ padding: "12px 16px", borderRadius: "16px 4px 16px 16px", background: "#eff6ff", border: "1px solid #dbeafe", display: "flex", flexDirection: "column", gap: 8, width: 190 }}>
                          <div style={{ width: "85%", height: 12, background: "#bfdbfe", borderRadius: 4 }} />
                        </div>
                      </div>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#dbeafe", flexShrink: 0 }} />
                    </div>

                    {/* Turn 3: Assistant Skeleton */}
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", maxWidth: "80%" }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#ede9fe", flexShrink: 0 }} />
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                        <div style={{ padding: "12px 16px", borderRadius: "4px 16px 16px 16px", background: "#f8fafc", border: "1px solid #f1f5f9", display: "flex", flexDirection: "column", gap: 8, width: 260 }}>
                          <div style={{ width: "95%", height: 12, background: "#e2e8f0", borderRadius: 4 }} />
                          <div style={{ width: "70%", height: 12, background: "#e2e8f0", borderRadius: 4 }} />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : transcriptModal.turns.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px 16px", color: "#64748b" }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>No dialogue turns recorded in this session</p>
                  </div>
                ) : (
                  <div style={S.dialogueContainer}>
                    {transcriptModal.turns.map((turn, i) => {
                      const isUser = turn.role === "user";
                      return (
                        <div
                          key={i}
                          style={{
                            ...S.turnRow,
                            justifyContent: isUser ? "flex-end" : "flex-start",
                          }}
                        >
                          <div
                            style={{
                              ...S.turnBubble,
                              background: isUser ? "#4f46e5" : "#ffffff",
                              color: isUser ? "#ffffff" : "#0f172a",
                              border: isUser ? "none" : "1px solid #e2e8f0",
                              boxShadow: isUser
                                ? "0 2px 8px rgba(79, 70, 229, 0.25)"
                                : "0 1px 3px rgba(0, 0, 0, 0.05)",
                            }}
                          >
                            <span
                              style={{
                                ...S.turnWho,
                                color: isUser ? "rgba(255,255,255,0.75)" : "#6366f1",
                              }}
                            >
                              {isUser ? transcriptModal.callerName || "Caller" : "AI Assistant"}
                            </span>
                            <p style={S.turnContent}>{turn.content}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </OwnerShell>
  );
}

/* ─────────────────────────── Styles ─────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    maxWidth: "60rem",
    paddingBottom: 48,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    margin: 0,
    color: "#0f172a",
  },
  subtitle: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 4,
    margin: 0,
  },
  createBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "9px 16px",
    borderRadius: 9999,
    border: "none",
    background: "#4f46e5",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(79, 70, 229, 0.3)",
  },
  errorBanner: {
    padding: "12px 16px",
    borderRadius: 10,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: 500,
  },
  freshCard: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "16px 18px",
    borderRadius: 14,
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
  },
  freshRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  freshInput: {
    flex: 1,
    minWidth: 200,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #86efac",
    background: "#ffffff",
    fontSize: 13,
    color: "#0f172a",
    fontFamily: "monospace",
  },
  copyBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    borderRadius: 8,
    border: "none",
    background: "#16a34a",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  dismissBtn: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #bbf7d0",
    background: "transparent",
    color: "#166534",
    fontSize: 13,
    cursor: "pointer",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 12px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    flex: 1,
    minWidth: 220,
    maxWidth: 360,
  },
  searchInput: {
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: 13,
    color: "#0f172a",
    width: "100%",
  },
  filterPills: {
    display: "flex",
    gap: 4,
    background: "#f1f5f9",
    padding: 3,
    borderRadius: 8,
  },
  filterPill: {
    border: "none",
    padding: "5px 12px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.12s",
  },
  loadingState: {
    textAlign: "center",
    padding: "48px 0",
    color: "#64748b",
    fontSize: 13,
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 16px",
    textAlign: "center",
    color: "#475569",
    background: "#ffffff",
    borderRadius: 16,
    border: "1px dashed #cbd5e1",
  },
  contactsList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  contactCard: {
    display: "flex",
    flexDirection: "column",
    borderRadius: 14,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
    overflow: "hidden",
  },
  contactTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 18px",
    flexWrap: "wrap",
    gap: 12,
  },
  avatar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    borderRadius: 9999,
    background: "#eef2ff",
    color: "#4f46e5",
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  },
  contactName: {
    fontSize: 15,
    fontWeight: 700,
    color: "#0f172a",
  },
  contactMeta: {
    fontSize: 12,
    color: "#64748b",
    margin: "3px 0 0",
  },
  tag: {
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 7px",
    borderRadius: 9999,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  sessionCountBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 9999,
  },
  actionsRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  actionBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "7px 12px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    color: "#334155",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.12s",
  },
  sessionsDrawer: {
    padding: "14px 18px 18px",
    background: "#f8fafc",
    borderTop: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  drawerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  drawerTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#1e293b",
  },
  sessionListGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 10,
  },
  sessionCardItem: {
    padding: "12px 14px",
    borderRadius: 10,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    display: "flex",
    flexDirection: "column",
  },
  channelBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 6px",
    borderRadius: 9999,
  },
  viewTranscriptBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    background: "#f8fafc",
    color: "#4f46e5",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  },
  paginationRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 12,
    flexWrap: "wrap",
    gap: 10,
  },
  paginationText: {
    fontSize: 12,
    color: "#64748b",
  },
  paginationBtns: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  pageBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    color: "#334155",
    fontSize: 12,
    fontWeight: 500,
  },
  pageIndicator: {
    fontSize: 12,
    fontWeight: 600,
    color: "#0f172a",
  },
  /* Modal */
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.6)",
    backdropFilter: "blur(4px)",
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: "28rem",
    background: "#ffffff",
    borderRadius: 16,
    boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
    overflow: "hidden",
  },
  modalCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#334155",
    marginBottom: 5,
  },
  modalInput: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    fontSize: 13,
    color: "#0f172a",
    boxSizing: "border-box",
  },
  cancelBtn: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#475569",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  submitBtn: {
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    background: "#4f46e5",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  /* Delete Confirmation Modal Card */
  confirmCard: {
    width: "100%",
    maxWidth: "24rem",
    padding: 24,
    borderRadius: 18,
    background: "#ffffff",
    boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: 12,
  },
  confirmIconWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    borderRadius: 9999,
    background: "#fee2e2",
    marginBottom: 4,
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: 700,
    color: "#0f172a",
    margin: 0,
  },
  confirmDesc: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 1.5,
    margin: 0,
  },
  confirmActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 8,
    width: "100%",
  },
  deleteBtn: {
    padding: "8px 18px",
    borderRadius: 8,
    border: "none",
    background: "#dc2626",
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 2px 6px rgba(220, 38, 38, 0.3)",
  },
  /* Modal Transcript */
  transcriptModalContent: {
    width: "100%",
    maxWidth: "36rem",
    maxHeight: "85vh",
    display: "flex",
    flexDirection: "column",
    background: "#ffffff",
    borderRadius: 18,
    boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
    overflow: "hidden",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "#0f172a",
  },
  modalSub: {
    fontSize: 12,
    color: "#64748b",
    margin: "2px 0 0",
  },
  modalClose: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 8,
    border: "none",
    background: "#e2e8f0",
    color: "#475569",
    cursor: "pointer",
  },
  modalBody: {
    padding: 16,
    overflowY: "auto",
    flex: 1,
    background: "#f8fafc",
  },
  dialogueContainer: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  turnRow: {
    display: "flex",
    width: "100%",
  },
  turnBubble: {
    maxWidth: "80%",
    padding: "10px 14px",
    borderRadius: 14,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  turnWho: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  turnContent: {
    fontSize: 13,
    lineHeight: 1.5,
    margin: 0,
    whiteSpace: "pre-wrap",
  },
};
