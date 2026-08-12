"use client";

// Today's spend, against the ceiling.
//
// Calls run on the owner's provider keys and on room minutes billed to the
// platform, so a workspace that is being abused costs real money before anyone
// notices. Until this existed the only symptoms were a provider bill at the end
// of the month, or callers suddenly hitting "this assistant has reached its
// limit for today" — neither of which says what happened or when it started.

import { useEffect, useState } from "react";
import { Activity, AlertTriangle } from "lucide-react";

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

function Meter({
  label,
  used,
  budget,
  unit,
}: {
  label: string;
  used: number;
  budget: number | null;
  unit: string;
}) {
  const pct = ratio(used, budget);
  // Amber well before the wall. An owner needs time to react, and the first
  // useful moment is not the one where their callers start being turned away.
  const tone = pct === null ? "ok" : pct >= 1 ? "bad" : pct >= 0.75 ? "warn" : "ok";

  return (
    <div className="usage-meter">
      <div className="usage-meter-head">
        <span className="usage-meter-label">{label}</span>
        <span className={`usage-meter-value usage-${tone}`}>
          {used.toLocaleString()}
          {budget ? <span className="usage-meter-budget"> / {budget.toLocaleString()}</span> : null}
          <span className="usage-meter-unit"> {unit}</span>
        </span>
      </div>
      <div className="usage-meter-track" role="presentation">
        <span
          className={`usage-meter-fill usage-fill-${tone}`}
          style={{ width: `${((pct ?? 0) * 100).toFixed(1)}%` }}
        />
      </div>
    </div>
  );
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

  // Silent when it cannot load. A broken panel on the overview screen would
  // imply something is wrong with the workspace, when the only thing wrong is
  // this panel.
  if (failed || !usage) return null;

  return (
    <section className="usage-card">
      <div className="usage-card-head">
        <span className="usage-card-icon" aria-hidden="true">
          <Activity size={16} />
        </span>
        <div>
          <h2 className="usage-card-title">Today&apos;s usage</h2>
          <p className="usage-card-sub">Resets at midnight UTC</p>
        </div>
      </div>

      <div className="usage-meters">
        <Meter label="Calls" used={usage.calls_today} budget={usage.call_budget} unit="calls" />
        <Meter label="Talk time" used={usage.minutes_today} budget={usage.minute_budget} unit="min" />
      </div>

      {usage.over_budget && (
        <p className="usage-alert" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>
            Today&apos;s limit is reached — new calls are being turned away until
            midnight. Existing conversations are unaffected.
          </span>
        </p>
      )}
    </section>
  );
}
