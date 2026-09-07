/**
 * HorizonFetcher
 *
 * Fetches real on-chain wallet data from Stellar Horizon and displays it
 * for user review before it's fed into the ZK proof generator.
 *
 * The user can:
 *   - Click "Load from my wallet" to auto-populate inputs from Horizon
 *   - Review the fetched data in a clear summary card
 *   - Confirm to proceed with real data, or dismiss to enter data manually
 *
 * Privacy note shown inline: data is fetched directly by the browser from
 * the public Horizon API and is never sent to any Nullius server.
 */

import type { HorizonData } from "../hooks/useHorizonData";

interface Props {
  walletAddress: string;
  fetchState: "idle" | "fetching" | "done" | "error";
  data: HorizonData | null;
  error: string | null;
  onFetch: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
}

function DataRow({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="horizon-row">
      <div className="horizon-row-left">
        <span className="horizon-row-label">{label}</span>
        {note && <span className="horizon-row-note">{note}</span>}
      </div>
      <strong className="horizon-row-value">{value}</strong>
    </div>
  );
}

export function HorizonFetcher({
  walletAddress,
  fetchState,
  data,
  error,
  onFetch,
  onConfirm,
  onDismiss,
}: Props) {
  // --- Idle state: prompt to load ---
  if (fetchState === "idle") {
    return (
      <div className="horizon-banner">
        <div className="horizon-banner-icon" aria-hidden="true">⬡</div>
        <div className="horizon-banner-body">
          <p className="horizon-banner-title">Load real wallet data</p>
          <p className="horizon-banner-sub">
            Fetch your actual Stellar transaction history from Horizon. Your data
            is read directly by your browser — nothing is sent to any Nullius server.
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={onFetch}
          aria-label="Load wallet data from Stellar Horizon"
        >
          Load from wallet
        </button>
      </div>
    );
  }

  // --- Loading state ---
  if (fetchState === "fetching") {
    return (
      <div className="step-indicator" role="status" aria-live="polite">
        <div className="step-spinner" aria-hidden="true" />
        <span>
          Fetching transaction history from Horizon…{" "}
          <span style={{ color: "var(--text2)", fontSize: 13 }}>
            (up to 1,000 transactions)
          </span>
        </span>
      </div>
    );
  }

  // --- Error state ---
  if (fetchState === "error") {
    return (
      <div className="horizon-error-block">
        <div
          className="error-box"
          role="alert"
          style={{ marginBottom: 12 }}
        >
          {error}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-primary" onClick={onFetch}>
            Retry
          </button>
          <button
            className="btn-secondary"
            onClick={onDismiss}
            aria-label="Enter data manually instead"
          >
            Enter manually
          </button>
        </div>
      </div>
    );
  }

  // --- Done state: show fetched data for review ---
  if (fetchState === "done" && data) {
    const scoreProxy =
      Math.min(data.txCount, 50) * 480 +
      Math.max(0, data.txCount - data.failedTxCount) * 480 +
      Math.min(data.monthsActive, 12) * 1000 +
      Math.min(Math.round(data.avgBalanceXlm * 10), 10000);
    const estimatedScore = Math.min(100, Math.round(scoreProxy / 700));
    const estimatedTier  =
      estimatedScore >= 85
        ? "Gold"
        : estimatedScore >= 70
        ? "Silver"
        : estimatedScore >= 40
        ? "Bronze"
        : "Below minimum";

    const tierColors: Record<string, string> = {
      Gold: "#d97706",
      Silver: "#94a3b8",
      Bronze: "#b45309",
      "Below minimum": "#64748b",
    };

    return (
      <div className="horizon-result">
        {/* Header */}
        <div className="horizon-result-header">
          <span className="horizon-result-title">
            ✓ Wallet data loaded from Stellar Horizon
          </span>
          <button
            className="horizon-dismiss-btn"
            onClick={onDismiss}
            aria-label="Dismiss and enter data manually"
            title="Enter data manually"
          >
            ✕
          </button>
        </div>

        {/* Data rows */}
        <div className="horizon-data-grid">
          <DataRow
            label="Successful transactions"
            value={data.txCount.toLocaleString()}
            note="All-time completed txs on this wallet"
          />
          <DataRow
            label="Failed / disputed transactions"
            value={data.failedTxCount.toLocaleString()}
            note="Transactions that did not complete"
          />
          <DataRow
            label="Average XLM balance"
            value={`${data.avgBalanceXlm.toLocaleString()} XLM`}
            note="Sampled from recent balance history"
          />
          <DataRow
            label="Wallet age"
            value={
              data.monthsActive === 0
                ? "< 1 month"
                : `${data.monthsActive} month${data.monthsActive !== 1 ? "s" : ""}`
            }
            note="Based on earliest recorded transaction"
          />
          <DataRow
            label="Current balance"
            value={`${data.currentBalanceXlm.toLocaleString()} XLM`}
          />
        </div>

        {/* Score estimate */}
        <div className="horizon-score-preview">
          <span style={{ fontSize: 13, color: "var(--text2)" }}>
            Estimated reputation score:
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <div
              className="score-bar-wrap"
              style={{ flex: 1 }}
              role="progressbar"
              aria-valuenow={estimatedScore}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Estimated score: ${estimatedScore} out of 100`}
            >
              <div
                className="score-bar"
                style={{ width: `${estimatedScore}%` }}
              />
            </div>
            <strong style={{ minWidth: 36, textAlign: "right" }}>
              {estimatedScore}/100
            </strong>
            <span
              className="tier-badge"
              style={{ background: tierColors[estimatedTier] }}
              aria-label={`Estimated tier: ${estimatedTier}`}
            >
              {estimatedTier}
            </span>
          </div>
        </div>

        {/* Privacy reassurance */}
        <p className="horizon-privacy-note">
          🔒 This data was fetched directly from the public Stellar Horizon API by
          your browser. It is never sent to any Nullius server. Only a
          zero-knowledge proof of your score will be submitted on-chain — not
          the data itself.
        </p>

        {/* CTA */}
        {estimatedTier === "Below minimum" ? (
          <div className="tier-warning" style={{ marginTop: 12 }}>
            Your wallet's current activity is below the Bronze threshold (score ≥ 40).
            Build up more transaction history and try again, or{" "}
            <button
              className="horizon-link-btn"
              onClick={onDismiss}
            >
              enter data manually
            </button>{" "}
            to simulate a higher score.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              className="btn-primary"
              style={{ flex: 1 }}
              onClick={onConfirm}
              aria-label={`Use real wallet data to generate ${estimatedTier} proof`}
            >
              Use this data → Generate {estimatedTier} Proof
            </button>
            <button
              className="btn-secondary"
              onClick={onDismiss}
              aria-label="Dismiss and enter data manually instead"
            >
              Enter manually
            </button>
          </div>
        )}
      </div>
    );
  }

  return null;
}
