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
  BASE_FEE,
  Networks,
  Contract,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";
import { CONTRACT_IDS } from "@nullius/sdk";
import { recordProof } from "./ProofHistory";

interface Props {
  walletAddress: string;
  onProofVerified: (bundle: ProofBundle, tier: Tier) => void;
}

// ----------------------------------------------------------------
// Proof encoding helpers (mirror sdk/src/contracts.ts)
// ----------------------------------------------------------------
function fieldToBytes32(dec: string): Uint8Array {
  let val = BigInt(dec);
  const buf = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(val & 0xffn);
    val >>= 8n;
  }
  return buf;
}

function encodeG1Bytes(point: [string, string, string]): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set(fieldToBytes32(point[0]), 0);
  buf.set(fieldToBytes32(point[1]), 32);
  return buf;
}

function encodeG2Bytes(point: [[string, string], [string, string], [string, string]]): Uint8Array {
  const buf = new Uint8Array(128);
  buf.set(fieldToBytes32(point[0][1]), 0);
  buf.set(fieldToBytes32(point[0][0]), 32);
  buf.set(fieldToBytes32(point[1][1]), 64);
  buf.set(fieldToBytes32(point[1][0]), 96);
  return buf;
}

function encodeScalarBytes(dec: string): Uint8Array {
  return fieldToBytes32(dec);
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
  const [inputs, setInputs] = useState<PrivateInputs>({
    txCount:      0,
    disputeCount: 0,
    avgBalance:   0,
    monthsActive: 0,
    salt:         generateSalt(),
  });

  const handleChange = (field: keyof Omit<PrivateInputs, "salt">, value: string) => {
    setInputs((prev) => ({ ...prev, [field]: parseInt(value) || 0 }));
  };

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

      // Build the unsigned transaction, then sign via Freighter
      const server = client.getServer();
      const account = await server.getAccount(walletAddress);

      const encodeBytes = (hex: string, len: number): Uint8Array => {
        const val = BigInt(hex);
        const buf = new Uint8Array(len);
        for (let i = len - 1; i >= 0; i--) {
          buf[i] = Number(val & 0xffn);
          // val >>= 8n — rewritten to avoid BigInt assignment in strict mode
        }
        return buf;
      };

      const contract = new Contract(CONTRACT_IDS.reputationRegistry);
      const proofABytes = encodeG1Bytes(bundle.proof.pi_a);
      const proofBBytes = encodeG2Bytes(bundle.proof.pi_b);
      const proofCBytes = encodeG1Bytes(bundle.proof.pi_c);
      const commitmentBytes = encodeScalarBytes(bundle.publicSignals.commitment);

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          contract.call(
            "submit_proof",
            nativeToScVal(walletAddress,        { type: "address" }),
            nativeToScVal(bundle.threshold,     { type: "u32" }),
            xdr.ScVal.scvBytes(proofABytes as unknown as Buffer),
            xdr.ScVal.scvBytes(proofBBytes as unknown as Buffer),
            xdr.ScVal.scvBytes(proofCBytes as unknown as Buffer),
            xdr.ScVal.scvBytes(commitmentBytes as unknown as Buffer),
          )
        )
        .setTimeout(30)
        .build();

      const prepared  = await server.prepareTransaction(tx);
      const signResult = await signTransaction(prepared.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });
      // freighter-api v2 returns string directly; v1 returned { signedTxXdr }
      const signedTxXdr = typeof signResult === "string" ? signResult : (signResult as any).signedTxXdr;
      const result = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET)
      );

      if (result.status !== "PENDING") {
        throw new Error(`Transaction rejected: ${result.status}`);
      }

      // Record to local history
      recordProof(bundle.tier, bundle.threshold, bundle.publicSignals.commitment);

      setStep("done");
      onProofVerified(bundle, bundle.tier);
    } catch (e: any) {
      setError(e.message);
      setStep("error");
    }
  };

  const tierColors = ["#94a3b8", "#cd7f32", "#9ca3af", "#f59e0b"];
  const tierNames  = ["Unverified", "Bronze", "Silver", "Gold"];

  // Score estimate for live preview
  const txCapped  = Math.min(inputs.txCount, 50);
  const ageCapped = Math.min(inputs.monthsActive, 12);
  const cleanTxs  = Math.max(0, inputs.txCount - inputs.disputeCount);
  const proxy     = txCapped * 480 + cleanTxs * 480 + ageCapped * 1000;
  const score     = Math.min(100, Math.round(proxy / 600));
  const estimatedTier = score >= 85 ? 3 : score >= 70 ? 2 : score >= 40 ? 1 : 0;

  return (
    <div className="card">
      <h2>Generate Reputation Proof</h2>
      <p className="subtitle">
        Your inputs are processed entirely in your browser using zero-knowledge cryptography.
        None of this data is sent to any server.
      </p>

      {step !== "input" && step !== "error" && (
        <div className="step-indicator">
          <div className="step-spinner" />
          <span>{STEP_LABELS[step]}</span>
        </div>
      )}

      {(step === "input" || step === "error") && (
        <>
          <div className="form-grid">
            <div className="field">
              <label>Total transactions completed</label>
              <input
                type="number"
                min="0"
                value={inputs.txCount || ""}
                onChange={(e) => handleChange("txCount", e.target.value)}
                placeholder="e.g. 42"
              />
            </div>
            <div className="field">
              <label>Disputed / failed transactions</label>
              <input
                type="number"
                min="0"
                value={inputs.disputeCount || ""}
                onChange={(e) => handleChange("disputeCount", e.target.value)}
                placeholder="e.g. 1"
              />
            </div>
            <div className="field">
              <label>Average wallet balance (XLM)</label>
              <input
                type="number"
                min="0"
                value={inputs.avgBalance || ""}
                onChange={(e) => handleChange("avgBalance", e.target.value)}
                placeholder="e.g. 500"
              />
            </div>
            <div className="field">
              <label>Months wallet has been active</label>
              <input
                type="number"
                min="0"
                value={inputs.monthsActive || ""}
                onChange={(e) => handleChange("monthsActive", e.target.value)}
                placeholder="e.g. 8"
              />
            </div>
          </div>

          {/* Live score preview */}
          <div className="score-preview">
            <div className="score-bar-wrap">
              <div className="score-bar" style={{ width: `${score}%` }} />
            </div>
            <div className="score-meta">
              <span>Estimated score: <strong>{score}/100</strong></span>
              <span
                className="tier-badge"
                style={{ background: tierColors[estimatedTier] }}
              >
                {tierNames[estimatedTier]}
              </span>
            </div>
            <p className="score-note">
              This estimate is never sent anywhere. The ZK proof will confirm it mathematically.
            </p>
          </div>

          {error && <div className="error-box">{error}</div>}

          <button
            className="btn-primary btn-full"
            onClick={handleGenerate}
            disabled={estimatedTier === 0}
          >
            {estimatedTier === 0
              ? "Score too low — increase your inputs"
              : `Generate ${tierNames[estimatedTier]} Proof`}
          </button>
        </>
      )}

      {step === "done" && (
        <div className="success-box">
          ✓ Proof submitted to Stellar testnet. Check "My Score" tab to see your tier.
        </div>
      )}
    </div>
  );
}
