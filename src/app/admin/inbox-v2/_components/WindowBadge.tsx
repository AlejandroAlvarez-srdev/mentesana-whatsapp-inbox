"use client";

import { useEffect, useState } from "react";
import { parseUtc, fmtMadridDateTime } from "./_time";

export type WindowInfo = {
  conversation_id?: string;
  last_inbound_at: string | null;
  expires_at: string | null;
  minutes_left: number | null;
  window_status: "open" | "expiring_soon" | "expired" | "never_inbound" | string;
};

export function fmtMinutesLeft(min: number | null): string {
  if (min == null) return "—";
  if (min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function colorFor(status: string): { bg: string; fg: string; border: string; label: string } {
  switch (status) {
    case "open": return { bg: "rgba(16,185,129,0.1)", fg: "#065f46", border: "rgba(16,185,129,0.3)", label: "🟢 abierta" };
    case "expiring_soon": return { bg: "rgba(245,158,11,0.12)", fg: "#92400e", border: "rgba(245,158,11,0.4)", label: "🟡 expira" };
    case "expired": return { bg: "rgba(239,68,68,0.1)", fg: "#991b1b", border: "rgba(239,68,68,0.3)", label: "🔴 cerrada" };
    case "never_inbound": return { bg: "rgba(148,163,184,0.12)", fg: "#475569", border: "rgba(148,163,184,0.3)", label: "⚪ sin inbound" };
    default: return { bg: "rgba(0,0,0,0.04)", fg: "#666", border: "rgba(0,0,0,0.08)", label: status };
  }
}

export default function WindowBadge({ info, compact, withCountdown }: { info: WindowInfo; compact?: boolean; withCountdown?: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (info.window_status === "open" || info.window_status === "expiring_soon") {
      const iv = setInterval(() => setTick((t) => t + 1), 30000);
      return () => clearInterval(iv);
    }
  }, [info.window_status]);

  const live = (() => {
    if (!info.expires_at) return info.minutes_left;
    const diff = parseUtc(info.expires_at).getTime() - Date.now();
    return Math.max(0, Math.floor(diff / 60000));
  })();
  const c = colorFor(info.window_status);

  if (compact) {
    return (
      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: c.bg, color: c.fg, fontWeight: 700, whiteSpace: "nowrap" }} title={info.expires_at ? `expira ${fmtMadridDateTime(info.expires_at)}` : ""}>
        {c.label} {withCountdown && live != null && info.window_status !== "expired" && info.window_status !== "never_inbound" ? `· ${fmtMinutesLeft(live)}` : ""}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, padding: "3px 9px", borderRadius: 6, background: c.bg, color: c.fg, fontWeight: 700, border: `1px solid ${c.border}` }} title={info.expires_at ? `expira ${fmtMadridDateTime(info.expires_at)}` : ""}>
      <span>{c.label}</span>
      {withCountdown && live != null && info.window_status !== "expired" && info.window_status !== "never_inbound" && <span style={{ opacity: 0.8 }}>· {fmtMinutesLeft(live)}</span>}
    </span>
  );
}
