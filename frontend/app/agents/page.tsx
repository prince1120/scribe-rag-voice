"use client";
import Link from "next/link";
import { Plus, Sparkles, Bot, Globe, FileText } from "lucide-react";
import { OwnerShell } from "../components/owner/OwnerShell";
import { AgentSwitcher } from "../agent/AgentSwitcher";
import { useWorkspace } from "../lib/workspaceCache";

export default function AgentsGalleryPage() {
  const ws = useWorkspace();
  return (
    <OwnerShell businessName={ws.businessName}>
      <main className="flex flex-col gap-5 max-w-4xl w-full pb-20 px-3 sm:px-0">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--claude-border)" }}>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: "var(--claude-text)" }}>
              My Agents & Versions
            </h1>
            <p className="text-xs sm:text-sm mt-1 text-gray-500">
              Manage your created AI assistants, switch your active live agent, clone configurations, or edit scripts.
            </p>
          </div>
          <Link
            href="/agent"
            className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 flex items-center gap-1.5 transition-all shadow-xs self-start sm:self-auto"
          >
            <Plus size={14} /> Create New Agent
          </Link>
        </header>

        {/* Agent Switcher & List Container */}
        <section className="rounded-2xl p-4 sm:p-6 bg-white border shadow-sm" style={{ borderColor: "var(--claude-border)" }}>
          <AgentSwitcher />
        </section>

        {/* Quick Tips */}
        <footer className="p-4 rounded-xl border bg-gray-50/70 text-xs text-gray-600 flex items-start gap-2.5" style={{ borderColor: "var(--claude-border)" }}>
          <Sparkles size={16} className="text-indigo-600 flex-shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold text-gray-800">Pro Tip: </span>
            You can create multiple agents tailored for different business needs (e.g. Inbound Support vs Appointments). Use <strong>Make Live</strong> to switch which version answers customer calls and chats instantly.
          </div>
        </footer>
      </main>
    </OwnerShell>
  );
}
