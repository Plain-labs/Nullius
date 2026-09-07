import { useState } from "react";
import {
  generateReputationProof,
  verifyProofLocally,
  generateSalt,
  NulliusClient,
} from "@nullius/sdk";
import type { PrivateInputs, ProofBundle, Tier } from "@nullius/sdk";
import {
  TransactionBuilder,
  Networks,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";
import { recordProof } from "./ProofHistory";
import { HorizonFetcher } from "./HorizonFetcher";
import { useHorizonData } from "../hooks/useHorizonData";

interface Props {
  walletAddress: string;
  onProofVerified: (bundle: ProofBundle, tier: Tier) => void;
}

type Step = "input" | "generating" | "verifying" | "submitting" | "done" | "error";

const STEP_LABELS: Record<Step, string> = {
  input:      "Enter your details",
  generating: "Generating ZK proof in browser…",
  verifying:  "Verifying proof locally…",
  submitting: "Submitting to Stellar testnet…",
  done:       "Proof submitted!",
  error:      "Something went wrong",
};

export function ProofGenerator({ walletAddress, onProofVerified }: Props) {
  const [step, setStep]   = useState<Step>("input");
  const [error, setError] = useState<string | null>(null);
  const [salt]            = useState<string>(() => generateSalt());

  // Whether the inputs were sourced from Horizon (shows a badge in the UI)
  const [fromHorizon, setFromHorizon] = useState(false);

  const [inputs, setInputs] = useState<PrivateInputs>({
    txCount:      0,
    disputeCount: 0,
    avgBalance:   0,
    monthsActive: 0,
    salt,
  });

  // Horizon data hook
  const horizon = useHorizonData();

  // ----------------------------------------------------------------
  // Horizon integration handlers
  // ----------------------------------------------------------------

  const handleHorizonFetch = () => {
    horizon.fetch(walletAddress);
  };

  /** User clicks "Use this data" after reviewing Horizon results */
  const handleHorizonConfirm = () => {
    if (!horizon.data) return;
    const derived = horizon.toPrivateInputs(horizon.data, salt);
    setInputs(derived);
    setFromHorizon(true);
    horizon.reset(); // collapse the fetcher back to idle so the form is visible
  };

  /** User chooses to enter data manually — dismiss the fetcher */
  const handleHorizonDismiss = () => {
    setFromHorizon(false);
    horizon.reset();
  };

  // ----------------------------------------------------------------
  // Manual input handler
  // ----------------------------------------------------------------

  const handleChange = (field: keyof Omit<PrivateInputs, "salt">, value: string) => {
    setFromHorizon(false); // user is now editing manually
    setInputs((prev) => ({ ...prev, [field]: parseInt(value) || 0 }));
  };

  // ----------------------------------------------------------------
  // Proof generation
  // ----------------------------------------------------------------

  const handleGenerate = async () => {
    setError(null);
    try {
      setStep("generating");
      const bundle = await generateReputationProof(inputs);

      setStep("verifying");
      const valid = await verifyProofLocally(bundle);
      if (!valid) throw new Error("Local proof verification failed — this is a bug");

      setStep("submitting");
      const client = new NulliusClient();

      // Build the unsigned transaction via SDK, then sign with Freighter
      const unsignedXdr = await client.buildSubmitProofTransaction(walletAddress, bundle);
      const signResult  = await signTransaction(unsignedXdr, {
        networkPassphrase: Networks.TESTNET,
      });
      // freighter-api v2 returns string directly; v1 returned { signedTxXdr }
      const signedTxXdr =
        typeof signResult === "string"
          ? signResult
          : (signResult as Record<string, string>).signedTxXdr;

      const server = client.getServer();
      const result  = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET)
      );

      if (result.status !== "PENDING") {
        throw new Error(`Transaction rejected: ${result.status}`);
      }

      // Record to local history
      recordProof(bundle.tier, bundle.threshold, bundle.publicSignals.commitment);

      setStep("done");
      onProofVerified(bundle, bundle.tier);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An unknown error occurred");
      setStep("error");
    }
  };

  // ----------------------------------------------------------------
  // Score preview (mirrors circuit formula exactly)
  // ----------------------------------------------------------------

  const tierColors = ["#64748b", "#b45309", "#94a3b8", "#d97706"];
  const tierNames  = ["Unverified", "Bronze", "Silver", "Gold"];

  const txCapped      = Math.min(inputs.txCount, 50);
  const ageCapped     = Math.min(inputs.monthsActive, 12);
  const balCapped     = Math.min(inputs.avgBalance, 10000);
  const cleanTxs      = Math.max(0, inputs.txCount - inputs.disputeCount);
  const proxy         = txCapped * 480 + cleanTxs * 480 + ageCapped * 1000 + balCapped;
  const score         = Math.min(100, Math.round(proxy / 700));
  const estimatedTier = score >= 85 ? 3 : score >= 70 ? 2 : score >= 40 ? 1 : 0;

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------

  return (
    <div className="card">
      <h2 id="proof-form-heading">Generate Reputation Proof</h2>
      <p className="subtitle">
        Your inputs are processed entirely in your browser using zero-knowledge
        cryptography. None of this data is sent to any server.
      </p>

      {/* ---- Proof generation in progress ---- */}
      {step !== "input" && step !== "error" && (
        <div
          className="step-indicator"
          role="status"
          aria-live="polite"
          aria-label={STEP_LABELS[step]}
        >
          <div className="step-spinner" aria-hidden="true" />
          <span>{STEP_LABELS[step]}</span>
        </div>
      )}

      {/* ---- Input form (idle + error states) ---- */}
      {(step === "input" || step === "error") && (
        <>
          {/* Horizon fetcher — sits above the manual form */}
          <HorizonFetcher
            walletAddress={walletAddress}
            fetchState={horizon.state}
            data={horizon.data}
            error={horizon.error}
            onFetch={handleHorizonFetch}
            onConfirm={handleHorizonConfirm}
            onDismiss={handleHorizonDismiss}
          />

          {/* Show the form once Horizon is idle/dismissed (not while it's showing results) */}
          {horizon.state !== "done" && (
            <>
              {/* Source badge — shown when inputs came from Horizon */}
              {fromHorizon && (
                <div className="horizon-source-badge" aria-live="polite">
                  <span className="horizon-source-icon">⬡</span>
                  Inputs sourced from your real Stellar transaction history
                  <button
                    className="horizon-link-btn"
                    onClick={handleHorizonDismiss}
                    style={{ marginLeft: 8 }}
                    aria-label="Clear Horizon data and enter manually"
                  >
                    clear
                  </button>
                </div>
              )}

              <div
                className="form-grid"
                role="group"
                aria-labelledby="proof-form-heading"
              >
                <div className="field">
                  <label htmlFor="input-tx-count">Total transactions completed</label>
                  <input
                    id="input-tx-count"
                    type="number"
                    min="0"
                    value={inputs.txCount || ""}
                    onChange={(e) => handleChange("txCount", e.target.value)}
                    placeholder="e.g. 42"
                    aria-describedby="score-preview-hint"
                  />
                </div>
                <div className="field">
                  <label htmlFor="input-dispute-count">
                    Failed / disputed transactions
                  </label>
                  <input
                    id="input-dispute-count"
                    type="number"
                    min="0"
                    value={inputs.disputeCount || ""}
                    onChange={(e) => handleChange("disputeCount", e.target.value)}
                    placeholder="e.g. 1"
                    aria-describedby="score-preview-hint"
                  />
                </div>
                <div className="field">
                  <label htmlFor="input-avg-balance">
                    Average wallet balance (XLM)
                  </label>
                  <input
                    id="input-avg-balance"
                    type="number"
                    min="0"
                    value={
                      // Display in XLM regardless of internal unit scaling
                      inputs.avgBalance
                        ? Math.round(inputs.avgBalance / 10)
                        : ""
                    }
                    onChange={(e) => {
                      // Convert XLM → units (×10) to match circuit scaling
                      const xlm = parseFloat(e.target.value) || 0;
                      setFromHorizon(false);
                      setInputs((prev) => ({
                        ...prev,
                        avgBalance: Math.round(xlm * 10),
                      }));
                    }}
                    placeholder="e.g. 500"
                    aria-describedby="score-preview-hint"
                  />
                </div>
                <div className="field">
                  <label htmlFor="input-months-active">
                    Months wallet has been active
                  </label>
                  <input
                    id="input-months-active"
                    type="number"
                    min="0"
                    value={inputs.monthsActive || ""}
                    onChange={(e) => handleChange("monthsActive", e.target.value)}
                    placeholder="e.g. 8"
                    aria-describedby="score-preview-hint"
                  />
                </div>
              </div>

              {/* Live score preview */}
              <div
                className="score-preview"
                role="status"
                aria-live="polite"
                aria-label={`Estimated score: ${score} out of 100. Tier: ${tierNames[estimatedTier]}`}
              >
                <div
                  className="score-bar-wrap"
                  role="progressbar"
                  aria-valuenow={score}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Estimated reputation score"
                >
                  <div
                    className="score-bar"
                    style={{ width: `${score}%` }}
                  />
                </div>
                <div className="score-meta">
                  <span>
                    Estimated score: <strong>{score}/100</strong>
                  </span>
                  <span
                    className="tier-badge"
                    style={{ background: tierColors[estimatedTier] }}
                    aria-label={`Tier: ${tierNames[estimatedTier]}`}
                  >
                    {tierNames[estimatedTier]}
                  </span>
                </div>
                <p className="score-note" id="score-preview-hint">
                  {fromHorizon
                    ? "Score computed from your real Stellar wallet history. The ZK proof will confirm it without revealing your data."
                    : "This estimate is never sent anywhere. The ZK proof will confirm it mathematically."}
                </p>
              </div>

              {error && (
                <div
                  className="error-box"
                  role="alert"
                  aria-live="assertive"
                >
                  {error}
                </div>
              )}

              <button
                className="btn-primary btn-full"
                onClick={handleGenerate}
                disabled={estimatedTier === 0}
                aria-disabled={estimatedTier === 0}
              >
                {estimatedTier === 0
                  ? "Score too low — increase your inputs"
                  : `Generate ${tierNames[estimatedTier]} Proof${fromHorizon ? " (from real data)" : ""}`}
              </button>
            </>
          )}
        </>
      )}

      {step === "done" && (
        <div className="success-box" role="status" aria-live="polite">
          ✓ Proof submitted to Stellar testnet. Check "My Score" tab to see your
          tier.
        </div>
      )}
    </div>
  );
}
