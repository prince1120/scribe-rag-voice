"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  Clock,
  Globe,
  FileText,
  Play,
  Trash2,
  Pencil,
  Check,
  X,
  Copy,
  ExternalLink,
  Mic,
  MessageSquare,
  Search,
  Filter,
  Sparkles,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Plus,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { ownerFetch } from "../lib/ownerFetch";

export interface SnapshotItem {
  snapshot_id: string;
  name: string;
  source: string;
  source_url: string | null;
  created_at: string | null;
  script: string;
  voice_script: string;
  chat_script: string;
  greeting: string | null;
  language: string;
  voice_id: string;
  is_active?: boolean;
}

export function AgentSwitcher({ onSwitch }: { onSwitch?: () => void }) {
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [activeAgent, setActiveAgent] = useState<{ name: string; status: string } | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "active" | "voice" | "chat">("all");
  const [sortBy, setSortBy] = useState<"newest" | "name">("newest");
  
  // Expanded prompt preview tracking
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Editing state
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editVoice, setEditVoice] = useState("");
  const [editChat, setEditChat] = useState("");
  const [editGreeting, setEditGreeting] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Actions state
  const [activating, setActivating] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await ownerFetch("/api/v1/workspace/agents");
      if (r.ok) {
        const j = await r.json();
        setSnapshots(j.snapshots || []);
        if (j.active_agent) setActiveAgent(j.active_agent);
      }
    } catch {
      showToast("Could not load agents", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const activate = async (id: string, name: string) => {
    setActivating(id);
    try {
      const res = await ownerFetch(`/api/v1/workspace/agents/${id}/activate`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail || `Failed to activate`);
      }
      showToast(`✓ "${name}" is now live!`, "success");
      onSwitch?.();
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to make live", "error");
    } finally {
      setActivating(null);
    }
  };

  const duplicate = async (id: string) => {
    setDuplicating(id);
    try {
      const res = await ownerFetch(`/api/v1/workspace/agents/${id}/duplicate`, { method: "POST" });
      if (!res.ok) {
        throw new Error("Could not duplicate agent");
      }
      showToast("Agent cloned successfully ✓", "success");
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to duplicate", "error");
    } finally {
      setDuplicating(null);
    }
  };

  const confirmRemove = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await ownerFetch(`/api/v1/workspace/agents/${deleteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not delete agent");
      showToast("Agent snapshot removed", "success");
      setDeleteId(null);
      void load();
    } catch (e) {
      showToast("Delete failed", "error");
    } finally {
      setDeleting(false);
    }
  };

  const startEdit = (s: SnapshotItem) => {
    setEditing(s.snapshot_id);
    setEditName(s.name);
    setEditVoice(s.voice_script || s.script || "");
    setEditChat(s.chat_script || s.script || "");
    setEditGreeting(s.greeting || "");
  };

  const saveEdit = async (id: string) => {
    setSavingEdit(true);
    try {
      const res = await ownerFetch(`/api/v1/workspace/agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          voice_script: editVoice,
          chat_script: editChat,
          greeting: editGreeting,
        }),
      });
      if (res.ok) {
        showToast("Agent prompt & details updated ✓");
        setEditing(null);
        void load();
      } else {
        showToast("Update failed", "error");
      }
    } catch {
      showToast("Error updating agent", "error");
    } finally {
      setSavingEdit(false);
    }
  };

  // Filtered and Sorted list
  const filteredSnapshots = useMemo(() => {
    return snapshots
      .filter((s) => {
        // Search
        const q = searchQuery.toLowerCase();
        const matchesQuery = !q || s.name.toLowerCase().includes(q) || (s.source_url || "").toLowerCase().includes(q);
        if (!matchesQuery) return false;

        // Filter
        if (filterType === "active") return Boolean(s.is_active);
        if (filterType === "voice") return Boolean(s.voice_script || s.script);
        if (filterType === "chat") return Boolean(s.chat_script || s.script);
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });
  }, [snapshots, searchQuery, filterType, sortBy]);

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Toast Alert */}
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

      {/* Control Toolbar: Search, Filters, Sort, Refresh */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-2 border-b" style={{ borderColor: "var(--claude-border)" }}>
        {/* Search Bar */}
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents by name or URL…"
            className="w-full pl-9 pr-3 py-1.5 rounded-xl border text-xs outline-none bg-white focus:ring-1 focus:ring-indigo-500"
            style={{ borderColor: "var(--claude-border)" }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Filter Pills & Refresh */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center p-0.5 rounded-lg border bg-gray-50 text-xs" style={{ borderColor: "var(--claude-border)" }}>
            <button
              onClick={() => setFilterType("all")}
              className={`px-2.5 py-1 rounded-md font-semibold text-[11px] transition-all ${
                filterType === "all" ? "bg-white text-indigo-700 shadow-xs" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              All ({snapshots.length})
            </button>
            <button
              onClick={() => setFilterType("active")}
              className={`px-2.5 py-1 rounded-md font-semibold text-[11px] transition-all ${
                filterType === "active" ? "bg-white text-emerald-700 shadow-xs" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Active Live
            </button>
            <button
              onClick={() => setFilterType("voice")}
              className={`px-2.5 py-1 rounded-md font-semibold text-[11px] transition-all ${
                filterType === "voice" ? "bg-white text-red-700 shadow-xs" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Voice
            </button>
            <button
              onClick={() => setFilterType("chat")}
              className={`px-2.5 py-1 rounded-md font-semibold text-[11px] transition-all ${
                filterType === "chat" ? "bg-white text-indigo-700 shadow-xs" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Chat
            </button>
          </div>

          <button
            onClick={() => void load()}
            title="Refresh agents"
            className="p-1.5 rounded-lg border text-gray-600 hover:bg-gray-50"
            style={{ borderColor: "var(--claude-border)" }}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Agents List */}
      {loading && snapshots.length === 0 ? (
        <div className="py-12 text-center text-xs text-gray-400 flex flex-col items-center gap-2">
          <RefreshCw size={16} className="animate-spin text-indigo-600" />
          <span>Loading your agents…</span>
        </div>
      ) : filteredSnapshots.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed text-center flex flex-col items-center justify-center gap-3 bg-gray-50/50" style={{ borderColor: "var(--claude-border)" }}>
          <Sparkles size={28} className="text-gray-300" />
          <div>
            <p className="text-xs font-bold text-gray-700">No agents match your criteria</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {searchQuery ? "Try a different search query or clear filters." : "Create your first AI assistant in the Agent Studio."}
            </p>
          </div>
          <Link
            href="/agent"
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-all flex items-center gap-1.5"
          >
            <Plus size={13} /> Create New Agent in Studio
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredSnapshots.map((s) => {
            const isExpanded = expandedId === s.snapshot_id;
            const isLive = Boolean(s.is_active);

            return (
              <div
                key={s.snapshot_id}
                className={`rounded-2xl border p-4 transition-all ${
                  isLive
                    ? "bg-white border-emerald-300 shadow-sm ring-1 ring-emerald-400/20"
                    : "bg-white border-gray-200 hover:border-gray-300 shadow-xs"
                }`}
              >
                {/* Card Top Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-gray-900">{s.name}</span>
                      
                      {/* Active Live Badge */}
                      {isLive ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                          <CheckCircle2 size={11} /> Active Live Agent
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500">
                          Standby Version
                        </span>
                      )}

                      {/* Source Tag */}
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600 flex items-center gap-1">
                        {s.source === "site" ? <Globe size={10} /> : s.source === "upload" ? <FileText size={10} /> : <Clock size={10} />}
                        {s.source}
                      </span>

                      {/* Channel Capability Pills */}
                      {s.voice_script && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 flex items-center gap-1">
                          <Mic size={10} /> Voice
                        </span>
                      )}
                      {s.chat_script && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 flex items-center gap-1">
                          <MessageSquare size={10} /> Chat
                        </span>
                      )}
                    </div>

                    {/* Metadata Subtitle */}
                    <div className="text-[11px] text-gray-500 flex items-center gap-2 mt-1 flex-wrap">
                      {s.source_url && (
                        <span className="truncate max-w-[200px] text-indigo-600 font-mono">{s.source_url}</span>
                      )}
                      <span>• Voice: {s.voice_id} ({s.language})</span>
                      {s.created_at && (
                        <span>• Created {new Date(s.created_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions Header */}
                  <div className="flex items-center gap-1.5 flex-shrink-0 self-end sm:self-center">
                    {!isLive ? (
                      <button
                        onClick={() => void activate(s.snapshot_id, s.name)}
                        disabled={activating === s.snapshot_id}
                        title="Make this agent the live active version"
                        className="h-8 px-3.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 flex items-center gap-1.5 disabled:opacity-50 transition-all shadow-xs"
                      >
                        <Play size={12} className={activating === s.snapshot_id ? "animate-spin" : ""} />
                        {activating === s.snapshot_id ? "Activating…" : "Make Live"}
                      </button>
                    ) : (
                      <Link
                        href="/agent"
                        className="h-8 px-3.5 rounded-xl text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 flex items-center gap-1.5 transition-all"
                      >
                        <ExternalLink size={12} /> Open in Studio
                      </Link>
                    )}

                    <button
                      onClick={() => void duplicate(s.snapshot_id)}
                      disabled={duplicating === s.snapshot_id}
                      title="Clone / Duplicate this agent"
                      className="h-8 w-8 rounded-xl border flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      style={{ borderColor: "var(--claude-border)" }}
                    >
                      <Copy size={13} className={duplicating === s.snapshot_id ? "animate-spin" : ""} />
                    </button>

                    <button
                      onClick={() => startEdit(s)}
                      title="Quick Edit Prompts"
                      className="h-8 w-8 rounded-xl border flex items-center justify-center text-gray-600 hover:bg-gray-50"
                      style={{ borderColor: "var(--claude-border)" }}
                    >
                      <Pencil size={13} />
                    </button>

                    <button
                      onClick={() => setDeleteId(s.snapshot_id)}
                      title="Delete Agent"
                      className="h-8 w-8 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 flex items-center justify-center"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Inline Editing Form */}
                {editing === s.snapshot_id ? (
                  <div className="mt-3 pt-3 border-t flex flex-col gap-3" style={{ borderColor: "var(--claude-border)" }}>
                    <label className="flex flex-col gap-1 text-xs font-bold text-gray-700">
                      Agent Name
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full rounded-lg border px-3 py-1.5 text-xs outline-none bg-white"
                        style={{ borderColor: "var(--claude-border)" }}
                      />
                    </label>

                    <label className="flex flex-col gap-1 text-xs font-bold text-gray-700">
                      Voice Script (Spoken dialogue, 1-2 sentences per turn)
                      <textarea
                        value={editVoice}
                        onChange={(e) => setEditVoice(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border p-2 text-xs outline-none bg-gray-50 font-mono"
                        style={{ borderColor: "var(--claude-border)" }}
                      />
                    </label>

                    <label className="flex flex-col gap-1 text-xs font-bold text-gray-700">
                      Chat Script (Detailed Markdown)
                      <textarea
                        value={editChat}
                        onChange={(e) => setEditChat(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border p-2 text-xs outline-none bg-gray-50 font-mono"
                        style={{ borderColor: "var(--claude-border)" }}
                      />
                    </label>

                    <label className="flex flex-col gap-1 text-xs font-bold text-gray-700">
                      Greeting Message
                      <input
                        value={editGreeting}
                        onChange={(e) => setEditGreeting(e.target.value)}
                        className="w-full rounded-lg border px-3 py-1.5 text-xs outline-none bg-white"
                        style={{ borderColor: "var(--claude-border)" }}
                      />
                    </label>

                    <div className="flex items-center justify-end gap-2 mt-1">
                      <button
                        onClick={() => setEditing(null)}
                        className="h-8 px-3 rounded-lg border text-xs font-semibold text-gray-600 hover:bg-gray-50"
                        style={{ borderColor: "var(--claude-border)" }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void saveEdit(s.snapshot_id)}
                        disabled={savingEdit}
                        className="h-8 px-4 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1"
                      >
                        <Check size={13} /> {savingEdit ? "Saving…" : "Save Changes"}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Collapsible Prompt Preview */
                  <div className="mt-3 pt-2 border-t" style={{ borderColor: "var(--claude-border)" }}>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : s.snapshot_id)}
                      className="text-[11px] font-semibold text-gray-500 hover:text-gray-800 flex items-center gap-1 cursor-pointer"
                    >
                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      {isExpanded ? "Hide Prompts & Details" : "View Prompts & Scripts"}
                    </button>

                    {isExpanded && (
                      <div className="mt-2 grid sm:grid-cols-2 gap-2 text-xs">
                        <div className="p-2.5 rounded-xl border bg-gray-50/70" style={{ borderColor: "var(--claude-border)" }}>
                          <span className="font-bold text-[10px] uppercase text-red-600 block mb-1">Voice Script</span>
                          <p className="text-[11px] leading-4 text-gray-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                            {s.voice_script || s.script || "No voice script configured"}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-xl border bg-gray-50/70" style={{ borderColor: "var(--claude-border)" }}>
                          <span className="font-bold text-[10px] uppercase text-indigo-600 block mb-1">Chat Script</span>
                          <p className="text-[11px] leading-4 text-gray-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                            {s.chat_script || s.script || "No chat script configured"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 border shadow-2xl flex flex-col gap-3" style={{ borderColor: "var(--claude-border)" }}>
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2 rounded-full bg-rose-50">
                <Trash2 size={18} />
              </div>
              <h3 className="text-sm font-bold text-gray-900">Delete Agent Snapshot?</h3>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              This will remove this agent version and its fallback knowledge. If this agent is currently active, the active copy will remain until you switch.
            </p>
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                onClick={() => setDeleteId(null)}
                disabled={deleting}
                className="h-9 px-4 rounded-xl border text-xs font-semibold text-gray-700 hover:bg-gray-50"
                style={{ borderColor: "var(--claude-border)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmRemove()}
                disabled={deleting}
                className="h-9 px-4 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
