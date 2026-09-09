import { useEffect, useState, useCallback } from "react";
import { TIER_LABELS, TIER_COLORS, CONTRACT_IDS } from "@nullius/sdk";
import type { Tier } from "@nullius/sdk";
import { SorobanRpc, xdr, scValToNative } from "@stellar/stellar-sdk";

interface ProofRecord {
  timestamp: number;
  tier: Tier;
  threshold: number;
  commitment: string;
  source: "local" | "chain";
  txHash?: string;
}

interface ProofHistoryProps {
  walletAddress: string;
}

const STORAGE_KEY = "nullius_proof_history";
const RPC_URL = "https://soroban-testnet.stellar.org";

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
      source: "local",
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.slice(0, 20)));
  } catch {
    // localStorage may be unavailable in some environments
  }
}

/**
 * Fetch tier_set contract events from Soroban RPC for a given wallet address.
 */
async function fetchChainEvents(walletAddress: string): Promise<ProofRecord[]> {
  const server = new SorobanRpc.Server(RPC_URL);
  const records: ProofRecord[] = [];

  try {
    const latestLedger = await server.getLatestLedger();
    const startLedger = Math.max(1, latestLedger.sequence - 17280);

    const response = await server.getEvents({
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds: [CONTRACT_IDS.reputationRegistry],
          topics: [
            [xdr.ScVal.scvSymbol("tier_set").toXDR("base64")],
          ],
        },
      ],
      limit: 50,
    });

    for (const event of response.events) {
      try {
        const topicValues = event.topic.map((t) => {
          try {
            return scValToNative(t);
          } catch {
            return null;
          }
        });

        const valueData = event.value ? scValToNative(event.value) : null;

        const eventWallet = topicValues[1];
        if (typeof eventWallet === "string" && eventWallet === walletAddress) {
          const tier = (typeof valueData === "number" ? valueData : 0) as Tier;
          records.push({
            timestamp: new Date(event.ledgerClosedAt).getTime(),
            tier,
            threshold: tier === 3 ? 85 : tier === 2 ? 70 : tier === 1 ? 40 : 0,
            commitment: event.id.slice(0, 20) + "…",
            source: "chain",
            txHash: event.txHash,
          });
        }
      } catch {
        // Skip malformed events
      }
    }
  } catch {
    // Soroban RPC may not be available or contract not deployed
  }

  return records;
}

/**
 * Display a chronological list of ZK proof submissions for the current wallet.
 * Combines on-chain events from Soroban RPC with localStorage records as fallback.
 */
export function ProofHistory({ walletAddress }: ProofHistoryProps) {
  const [records, setRecords] = useState<ProofRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [chainError, setChainError] = useState(false);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setChainError(false);

    let localRecords: ProofRecord[] = [];
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      localRecords = stored.map((r: Omit<ProofRecord, "source">) => ({
        ...r,
        source: "local" as const,
      }));
    } catch {
      localRecords = [];
    }

    let chainRecords: ProofRecord[] = [];
    try {
      chainRecords = await fetchChainEvents(walletAddress);
    } catch {
      setChainError(true);
    }

    const combined = [...chainRecords, ...localRecords];
    const seen = new Set<string>();
    const deduplicated = combined.filter((r) => {
      const key = `${r.timestamp}-${r.tier}-${r.commitment}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    deduplicated.sort((a, b) => b.timestamp - a.timestamp);
    setRecords(deduplicated);
    setLoading(false);
  }, [walletAddress]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const clearHistory = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage may be unavailable
    }
    setRecords((prev) => prev.filter((r) => r.source === "chain"));
  };

  if (loading) {
    return (
      <div
        style={{
          padding: "24px",
          color: "var(--text2)",
          fontSize: 14,
          textAlign: "center",
        }}
      >
        <span className="wallet-spinner" aria-hidden="true" />
        Loading proof history…
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div
        style={{
          padding: "24px",
          color: "var(--text2)",
          fontSize: 14,
          textAlign: "center",
        }}
      >
        <p style={{ marginBottom: 8 }}>No proof submissions yet.</p>
        <p style={{ fontSize: 12, opacity: 0.8 }}>
          Generate a proof in the "Generate Proof" tab to see your history here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text2)", marginBottom: 4 }}>
            Proof history
          </h3>
          {chainError && (
            <span style={{ fontSize: 11, color: "var(--text2)", opacity: 0.7 }}>
              (showing local records only — chain unavailable)
            </span>
          )}
        </div>
        <button
          onClick={clearHistory}
          style={{
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text2)",
            fontSize: 12,
            padding: "3px 10px",
            cursor: "pointer",
          }}
          aria-label="Clear local proof history"
        >
          Clear local
        </button>
      </div>
      <ul
        style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}
        aria-label="Proof submission history"
      >
        {records.map((r, i) => (
          <li
            key={`${r.timestamp}-${i}`}
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
              <span style={{ color: "var(--text2)", fontFamily: "monospace", fontSize: 12 }}>
                {r.commitment}
              </span>
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: r.source === "chain" ? "var(--accent)" : "var(--bg2)",
                  color: r.source === "chain" ? "white" : "var(--text2)",
                  fontWeight: 500,
                }}
                title={r.source === "chain" ? "Verified on-chain" : "Stored locally"}
              >
                {r.source === "chain" ? "on-chain" : "local"}
              </span>
            </div>
            <span style={{ color: "var(--text2)", whiteSpace: "nowrap", marginLeft: 12, fontSize: 12 }}>
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
