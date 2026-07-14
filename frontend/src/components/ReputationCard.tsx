import { useEffect, useState } from "react";
import { ProofPayClient, TIER_LABELS } from "@proofpay/sdk";
import type { ProofBundle, Tier } from "@proofpay/sdk";

interface Props {
  walletAddress: string;
  latestProof: ProofBundle | null;
  tier: Tier;
}

const TIER_COLORS: Record<Tier, string> = {
  0: "#64748b",
  1: "#b45309",
  2: "#6b7280",
  3: "#d97706",
};

const TIER_BENEFITS: Record<Tier, string[]> = {
  0: ["Basic access only", "5.0% transaction fee", "Max 1,000 XLM/tx"],
  1: ["Bronze tier verified", "2.0% transaction fee", "Max 10,000 XLM/tx"],
  2: ["Silver tier verified", "1.0% transaction fee", "Max 100,000 XLM/tx"],
  3: ["Gold tier verified", "0.3% transaction fee", "Max 1,000,000 XLM/tx", "Undercollateralised credit access"],
};

export function ReputationCard({ walletAddress, latestProof, tier }: Props) {
  const [onChainTier, setOnChainTier] = useState<Tier | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = new ProofPayClient();
    client.getTier(walletAddress)
      .then((t) => { setOnChainTier(t); setLoading(false); })
      .catch(() => { setOnChainTier(0); setLoading(false); });
  }, [walletAddress, tier]);

  const displayTier = onChainTier ?? tier;
  const color = TIER_COLORS[displayTier];

  return (
    <div className="card">
      <h2>My Reputation Score</h2>

      {loading ? (
        <div className="step-indicator"><div className="step-spinner" /><span>Fetching on-chain tier…</span></div>
      ) : (
        <>
          <div className="tier-display" style={{ borderColor: color }}>
            <div className="tier-ring" style={{ background: color }}>
              <span className="tier-label">{TIER_LABELS[displayTier]}</span>
            </div>
            <p className="tier-addr">
              {walletAddress.slice(0, 8)}…{walletAddress.slice(-6)}
            </p>
          </div>

          <ul className="benefits-list">
            {TIER_BENEFITS[displayTier].map((b) => (
              <li key={b}><span className="benefit-check">✓</span> {b}</li>
            ))}
          </ul>

          {latestProof && (
            <div className="proof-meta">
              <h3>Latest proof</h3>
              <div className="proof-row">
                <span>Commitment</span>
                <code>{latestProof.publicSignals.commitment.slice(0, 20)}…</code>
              </div>
              <div className="proof-row">
                <span>Threshold claimed</span>
                <code>{latestProof.threshold}</code>
              </div>
              <div className="proof-row">
                <span>meets_threshold</span>
                <code style={{ color: "#22c55e" }}>{latestProof.publicSignals.meets_threshold}</code>
              </div>
              <p className="proof-note">
                Zero knowledge: none of your tx history, balances, or identity was revealed to generate or verify this proof.
              </p>
            </div>
          )}

          {displayTier === 0 && (
            <p className="no-proof-hint">
              No verified reputation yet. Go to "Generate Proof" to submit your first ZK proof.
            </p>
          )}
        </>
      )}
    </div>
  );
}
