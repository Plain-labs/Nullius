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
 * Mirror the circuit's score-proxy computation in pure integer arithmetic.
 *
 * The circuit avoids division by scaling everything by 600 (LCM of 50 and 12).
 * Concretely, the circuit computes:
 *
 *   score_proxy      = tx_capped*480 + clean_txs*480 + age_capped*1000 + bal_capped
 *   threshold_scaled = threshold * 700
 *
 * and checks `score_proxy >= threshold_scaled`.
 *
 * This function replicates that arithmetic exactly so callers can predict which
 * tier a set of inputs will satisfy before generating a (slow) proof.
 *
 * All parameters are non-negative integers, matching the circuit's field elements.
 *
 * @param txCount       - total completed transactions
 * @param disputeCount  - disputed/failed transactions (must be <= txCount)
 * @param monthsActive  - months the wallet has been active
 * @param avgBalance    - average balance in stroops (pre-scaled by caller: pass balance/1000)
 * @returns             - integer score proxy (maximum 70 000)
 */
export function computeScoreProxy(
  txCount: number,
  disputeCount: number,
  monthsActive: number,
  avgBalance: number,
): number {
  // Use Math.trunc to guard against any accidental float inputs.
  const txCapped  = Math.min(Math.trunc(txCount),      50);
  const ageCapped = Math.min(Math.trunc(monthsActive), 12);
  const balCapped = Math.min(Math.trunc(avgBalance),   10_000);
  // clean_txs mirrors the circuit signal: tx_count - dispute_count (both already integers)
  const cleanTxs  = Math.trunc(txCount) - Math.trunc(disputeCount);

  return txCapped * 480 + cleanTxs * 480 + ageCapped * 1_000 + balCapped;
}

/**
 * Determine which tier threshold to prove against based on user's inputs.
 * We pick the highest tier the user can plausibly claim, then let the circuit confirm it.
 *
 * @internal — Use selectTier() for the public API with a Tier return type.
 */
function selectThreshold(inputs: PrivateInputs): number {
  // Use the exported utility so the formula is in one place and independently testable.
  const scoreProxy = computeScoreProxy(
    inputs.txCount,
    inputs.disputeCount,
    inputs.monthsActive,
    inputs.avgBalance,
  );

  // threshold_scaled = threshold * 700  (mirrors circuit line: threshold_scaled <== threshold * 700)
  if (scoreProxy >= TIER_THRESHOLDS.gold   * 700) return TIER_THRESHOLDS.gold;
  if (scoreProxy >= TIER_THRESHOLDS.silver * 700) return TIER_THRESHOLDS.silver;
  if (scoreProxy >= TIER_THRESHOLDS.bronze * 700) return TIER_THRESHOLDS.bronze;
  throw new Error("Score too low for any tier (minimum Bronze threshold is 40)");
}

/**
 * Predict which tier a set of inputs will qualify for before proof generation.
 *
 * This function mirrors the exact integer arithmetic of the circuit, using
 * computeScoreProxy() to calculate the score and comparing against tier
 * thresholds with the same scaling factor (700) as the circuit.
 *
 * Tier boundaries (on the 0-100 score scale):
 *   - Bronze: threshold = 40 → threshold_scaled = 28,000
 *   - Silver: threshold = 70 → threshold_scaled = 49,000
 *   - Gold:   threshold = 85 → threshold_scaled = 59,500
 *
 * @param inputs - Private financial data (txCount, disputeCount, monthsActive, avgBalance)
 * @returns The highest tier the inputs qualify for, or 0 (Unverified) if below Bronze
 *
 * @example
 * ```typescript
 * const tier = selectTier({
 *   txCount: 50,
 *   disputeCount: 0,
 *   monthsActive: 12,
 *   avgBalance: 5000,
 *   salt: "12345"
 * });
 * console.log(tier); // 3 (Gold)
 * ```
 */
export function selectTier(inputs: Omit<PrivateInputs, "salt">): Tier {
  const scoreProxy = computeScoreProxy(
    inputs.txCount,
    inputs.disputeCount,
    inputs.monthsActive,
    inputs.avgBalance,
  );

  if (scoreProxy >= TIER_THRESHOLDS.gold   * 700) return 3;
  if (scoreProxy >= TIER_THRESHOLDS.silver * 700) return 2;
  if (scoreProxy >= TIER_THRESHOLDS.bronze * 700) return 1;
  return 0;
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
