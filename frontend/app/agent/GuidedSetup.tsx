"use client";

import { Sparkles } from "lucide-react";
import { templateForCategory } from "./templates";

interface GuidedSetupProps {
  onApply: (patch: Record<string, string | number>) => void;
}

const CATEGORIES = [
  { id: "dental", label: "Dental" },
  { id: "salon", label: "Salon" },
  { id: "clinic", label: "Clinic" },
  { id: "coaching", label: "Coaching" },
  { id: "retail", label: "Retail" },
  { id: "restaurant", label: "Restaurant" },
  { id: "real_estate", label: "Real estate" },
];

const TONES = [
  { id: "warm", label: "Warm & friendly", temp: 0.3 },
  { id: "pro", label: "Professional", temp: 0.2 },
  { id: "concise", label: "Concise", temp: 0.15 },
];

export function GuidedSetup({ onApply }: GuidedSetupProps) {
  return (
    <div
      style={{
        border: "1px solid var(--claude-border)",
        background: "var(--claude-surface)",
        borderRadius: "var(--radius-lg)",
        padding: 18,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--claude-accent-soft)",
            color: "var(--claude-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Sparkles size={18} />
        </div>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--claude-text)", margin: 0 }}>Quick setup — 30 seconds</h3>
          <p style={{ fontSize: 12, color: "var(--claude-muted)", margin: "2px 0 0" }}>
            Pick a template and tone → we compile a human-sounding, token-efficient prompt.
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              const t = templateForCategory(c.id);
              if (!t) return;
              onApply({
                greeting: t.greeting,
                voice_script: t.voice_script,
                chat_script: t.chat_script,
                ...(t.language ? { language: t.language } : {}),
                ...(t.voice_id ? { voice_id: t.voice_id } : {}),
              });
            }}
            className="ds-pressable"
            style={{
              padding: "6px 12px",
              borderRadius: 9999,
              border: "1px solid var(--claude-border)",
              background: "var(--claude-bg)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        {TONES.map((tone) => (
          <button
            key={tone.id}
            type="button"
            onClick={() => onApply({ voice_temperature: tone.temp, chat_temperature: Math.min(0.5, tone.temp + 0.15) })}
            className="ds-pressable"
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--claude-border-strong)",
              background: "var(--claude-surface-2)",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {tone.label}
          </button>
        ))}
        <span style={{ fontSize: 11, color: "var(--claude-muted)" }}>→ Low thinking, saves tokens</span>
      </div>
    </div>
  );
}
