import { useEffect, useState } from "react";
import { TIER_LABELS } from "@nullius/sdk";
import type { Tier } from "@nullius/sdk";

interface ProofRecord {
  timestamp: number;     // Unix ms
  tier: Tier;
  threshold: number;
  commitment: string;    // truncated for display
}

const STORAGE_KEY = "nullius_proof_history";

/**
 * Persist a proof submission to localStorage so users can review their history.
 * Call this from ProofGenerator after a successful on-chain submission.
 */
export function recordProof(tier: Tier, threshold: number, commitment: string): void {
  try {
    const existing: ProofRecord[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]"
    );
    existing.unshift({
      timestamp: Date.now(),
      tier,
      threshold,
      commitment: commitment.slice(0, 20) + "…",
    });
    // Keep last 20 records
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.slice(0, 20)));
  } catch {
    // localStorage may be unavailable in some environments
  }
}

const TIER_COLORS: Record<Tier, string> = {
  0: "#64748b",
  1: "#b45309",
  2: "#6b7280",
  3: "#d97706",
};

/**
 * Display a chronological list of ZK proof submissions for the current browser session.
 * History is stored in localStorage — it is client-side only and contains no sensitive data.
 */
export function ProofHistory() {
  const [records, setRecords] = useState<ProofRecord[]>([]);

  useEffect(() => {
    try {
      const stored: ProofRecord[] = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? "[]"
      );
      setRecords(stored);
    } catch {
      setRecords([]);
    }
  }, []);

  if (records.length === 0) {
    return (
      <div
        style={{
          padding: "16px",
          color: "var(--text2)",
          fontSize: 14,
          textAlign: "center",
        }}
      >
        No proof submissions yet in this browser.
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text2)", marginBottom: 12 }}>
        Proof history (this browser)
      </h3>
      <ul
        style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}
        aria-label="Proof submission history"
      >
        {records.map((r, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "var(--bg3)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  background: TIER_COLORS[r.tier],
                  color: "white",
                  fontWeight: 700,
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 99,
                }}
              >
                {TIER_LABELS[r.tier]}
              </span>
              <span style={{ color: "var(--text2)", fontFamily: "monospace" }}>
                {r.commitment}
              </span>
            </div>
            <span style={{ color: "var(--text2)", whiteSpace: "nowrap", marginLeft: 12 }}>
              {new Date(r.timestamp).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
