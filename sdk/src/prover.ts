import type {
  PrivateInputs,
  Groth16Proof,
  PublicSignals,
  ProofBundle,
  Tier,
} from "./types";
import { TIER_THRESHOLDS } from "./types";

// Paths to circuit artifacts — bundler resolves these
const WASM_PATH = "/circuits/reputation_score_js/reputation_score.wasm";
const ZKEY_PATH = "/circuits/keys/reputation_score_final.zkey";

/**
 * Generate a random 32-byte salt as a BigInt-safe hex string.
 * Uses Web Crypto API — safe in browser and Node 18+.
 */
export function generateSalt(): string {
  const bytes = new Uint8Array(31); // 31 bytes to stay in BN254 scalar field
  crypto.getRandomValues(bytes);
  return BigInt("0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")).toString();
}

/**
 * Compute Poseidon commitment over private inputs.
 * This commitment is the public on-chain anchor — it ties the proof to the user
 * without revealing anything about the underlying data.
 */
async function computeCommitment(inputs: PrivateInputs): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { buildPoseidon } = await import("circomlibjs") as any;
  const poseidon = await buildPoseidon();
  const hash = poseidon([
    BigInt(inputs.txCount),
    BigInt(inputs.disputeCount),
    BigInt(inputs.avgBalance),
    BigInt(inputs.monthsActive),
    BigInt(inputs.salt),
  ]);
  return poseidon.F.toString(hash);
}

/**
 * Determine which tier threshold to prove against based on user's inputs.
 * We pick the highest tier the user can plausibly claim, then let the circuit confirm it.
 */
function selectThreshold(inputs: PrivateInputs): number {
  // Estimate score proxy: same formula as circuit (no division)
  const txCapped  = Math.min(inputs.txCount, 50);
  const ageCapped = Math.min(inputs.monthsActive, 12);
  const balCapped = Math.min(inputs.avgBalance, 10000);
  const cleanTxs  = inputs.txCount - inputs.disputeCount;
  // score_proxy = txCapped*480 + cleanTxs*480 + ageCapped*1000 + balCapped
  // threshold_scaled = threshold * 700
  const scoreProxy = txCapped * 480 + cleanTxs * 480 + ageCapped * 1000 + balCapped;

  if (scoreProxy >= TIER_THRESHOLDS.gold   * 700) return TIER_THRESHOLDS.gold;
  if (scoreProxy >= TIER_THRESHOLDS.silver * 700) return TIER_THRESHOLDS.silver;
  if (scoreProxy >= TIER_THRESHOLDS.bronze * 700) return TIER_THRESHOLDS.bronze;
  throw new Error("Score too low for any tier (minimum Bronze threshold is 40)");
}

/**
 * Generate a Groth16 proof that the user's financial reputation meets a threshold.
 *
 * All private inputs are processed entirely in the browser — they are never
 * sent to any server or written to any storage.
 *
 * @param inputs  Private financial data
 * @returns       ProofBundle ready to submit to the reputation registry contract
 *
 * NOTE on public signal ordering:
 *   snarkjs outputs signals as [<outputs>, <public inputs>] in declaration order:
 *     publicSignals[0] = meets_threshold  (circuit output)
 *     publicSignals[1] = threshold        (public input)
 *     publicSignals[2] = commitment       (public input)
 *
 *   The on-chain verifier / registry expects public_inputs in a different order:
 *     public_inputs[0] = threshold
 *     public_inputs[1] = commitment
 *     public_inputs[2] = meets_threshold
 *
 *   The ProofBundle.publicSignals struct stores values by name, not index, so
 *   the encoding helpers in contracts.ts always submit them in the correct
 *   on-chain order regardless of the snarkjs output order.
 */
export async function generateReputationProof(
  inputs: PrivateInputs
): Promise<ProofBundle> {
  // Input validation
  if (inputs.disputeCount > inputs.txCount) {
    throw new Error("dispute_count cannot exceed tx_count");
  }
  if (inputs.txCount < 0 || inputs.monthsActive < 0 || inputs.avgBalance < 0) {
    throw new Error("All inputs must be non-negative");
  }

  const threshold = selectThreshold(inputs);
  const commitment = await computeCommitment(inputs);

  const circuitInputs = {
    // Private
    tx_count: inputs.txCount.toString(),
    dispute_count: inputs.disputeCount.toString(),
    avg_balance: inputs.avgBalance.toString(),
    months_active: inputs.monthsActive.toString(),
    salt: inputs.salt,
    // Public
    threshold: threshold.toString(),
    commitment,
  };

  console.log("[Nullius] Generating Groth16 proof (this may take 5–15s)...");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snarkjs = await import("snarkjs") as any;
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInputs,
    WASM_PATH,
    ZKEY_PATH
  );

  if (publicSignals[0] !== "1") {
    throw new Error("Circuit output meets_threshold=0 — inputs do not satisfy the threshold");
  }

  const tier: Tier = threshold >= 85 ? 3 : threshold >= 70 ? 2 : 1;

  return {
    proof: proof as Groth16Proof,
    publicSignals: {
      meets_threshold: publicSignals[0],
      threshold: publicSignals[1],
      commitment: publicSignals[2],
    },
    tier,
    threshold,
  };
}

/**
 * Verify a proof locally using snarkjs before submitting on-chain.
 * Useful for fast client-side sanity check.
 */
export async function verifyProofLocally(bundle: ProofBundle): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snarkjs = await import("snarkjs") as any;
  const vkeyRes = await fetch("/circuits/keys/verification_key.json");
  const vkey = await vkeyRes.json();
  return snarkjs.groth16.verify(
    vkey,
    [
      bundle.publicSignals.meets_threshold,
      bundle.publicSignals.threshold,
      bundle.publicSignals.commitment,
    ],
    bundle.proof
  );
}
