"use client";

// Today's spend, against the ceiling.
//
// Calls run on the owner's provider keys and on room minutes billed to the
// platform, so a workspace that is being abused costs real money before anyone
// notices.

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock, PhoneCall } from "lucide-react";

import { ownerFetch } from "../../lib/ownerFetch";

interface Usage {
  calls_today: number;
  minutes_today: number;
  call_budget: number | null;
  minute_budget: number | null;
  over_budget: boolean;
}

/** Fraction of a ceiling used, clamped. Null budget means no ceiling set. */
function ratio(used: number, budget: number | null): number | null {
  if (!budget || budget <= 0) return null;
  return Math.min(1, used / budget);
}

export function UsageCard() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await ownerFetch("/api/v1/workspace/usage");
        if (cancelled) return;
        if (!res.ok) throw new Error();
        setUsage(await res.json());
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || !usage) return null;

  const callPct = ratio(usage.calls_today, usage.call_budget);
  const minPct = ratio(usage.minutes_today, usage.minute_budget);

  return (
    <section
      style={{
        background: "var(--claude-surface)",
        border: "1px solid var(--claude-border)",
        borderRadius: 14,
        padding: "18px 22px",
        marginBottom: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "var(--claude-accent-soft)",
              color: "var(--claude-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Activity size={16} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--claude-text)" }}>
              Today&apos;s Voice & Usage Activity
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--claude-muted)" }}>
              Real-time daily call volume and minutes consumed
            </p>
          </div>
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            fontWeight: 500,
            color: "var(--claude-muted)",
            background: "var(--claude-surface-2)",
            padding: "4px 10px",
            borderRadius: 20,
            border: "1px solid var(--claude-border)",
          }}
        >
          <Clock size={12} />
          <span>Resets at midnight UTC</span>
        </div>
      </div>

      {/* Modern KPI Metric Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 14,
        }}
      >
        {/* Metric 1: Calls Today */}
        <div
          style={{
            background: "var(--claude-bg)",
            border: "1px solid var(--claude-border)",
            borderRadius: 10,
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--claude-text-2)" }}>
              Calls Received Today
            </span>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: "var(--claude-accent-soft)",
                color: "var(--claude-accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <PhoneCall size={13} />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: "var(--claude-text)", letterSpacing: "-0.5px" }}>
              {usage.calls_today.toLocaleString()}
            </span>
            <span style={{ fontSize: 12, color: "var(--claude-muted)", fontWeight: 500 }}>
              {usage.call_budget ? `/ ${usage.call_budget.toLocaleString()} calls limit` : "calls"}
            </span>
          </div>

          {usage.call_budget ? (
            <div>
              <div
                style={{
                  height: 5,
                  borderRadius: 99,
                  background: "var(--claude-surface-2)",
                  overflow: "hidden",
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    borderRadius: 99,
                    width: `${((callPct ?? 0) * 100).toFixed(1)}%`,
                    background: (callPct ?? 0) >= 1 ? "var(--color-danger)" : (callPct ?? 0) >= 0.75 ? "var(--color-warning)" : "var(--color-success)",
                  }}
                />
              </div>
              <span style={{ fontSize: 10, color: "var(--claude-muted)" }}>
                {((callPct ?? 0) * 100).toFixed(0)}% of daily ceiling used
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-success)" }}>
              <CheckCircle2 size={12} />
              <span>Standard quota active (no ceiling)</span>
            </div>
          )}
        </div>

        {/* Metric 2: Live Talk Time */}
        <div
          style={{
            background: "var(--claude-bg)",
            border: "1px solid var(--claude-border)",
            borderRadius: 10,
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--claude-text-2)" }}>
              Live Talk Duration
            </span>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: "var(--color-success-soft)",
                color: "var(--color-success)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Clock size={13} />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 24, fontWeight: 800, color: "var(--claude-text)", letterSpacing: "-0.5px" }}>
              {usage.minutes_today.toLocaleString()}
            </span>
            <span style={{ fontSize: 12, color: "var(--claude-muted)", fontWeight: 500 }}>
              {usage.minute_budget ? `/ ${usage.minute_budget.toLocaleString()} min limit` : "minutes"}
            </span>
          </div>

          {usage.minute_budget ? (
            <div>
              <div
                style={{
                  height: 5,
                  borderRadius: 99,
                  background: "var(--claude-surface-2)",
                  overflow: "hidden",
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    borderRadius: 99,
                    width: `${((minPct ?? 0) * 100).toFixed(1)}%`,
                    background: (minPct ?? 0) >= 1 ? "var(--color-danger)" : (minPct ?? 0) >= 0.75 ? "var(--color-warning)" : "var(--color-success)",
                  }}
                />
              </div>
              <span style={{ fontSize: 10, color: "var(--claude-muted)" }}>
                {((minPct ?? 0) * 100).toFixed(0)}% of daily talk quota used
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-success)" }}>
              <CheckCircle2 size={12} />
              <span>Unlimited voice talk time</span>
            </div>
          )}
        </div>
      </div>

      {usage.over_budget && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 14,
            padding: "10px 14px",
            borderRadius: 8,
            background: "var(--color-danger-soft)",
            border: "1px solid var(--color-danger)",
            color: "var(--color-danger)",
            fontSize: 12,
            fontWeight: 500,
          }}
          role="status"
        >
          <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          <span>
            Today&apos;s ceiling has been reached — new calls are being paused until midnight UTC. Existing conversations remain active.
          </span>
        </div>
      )}
    </section>
  );
}
