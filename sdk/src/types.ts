// ----------------------------------------------------------------
// Nullius SDK — shared types
// ----------------------------------------------------------------

export type Tier = 0 | 1 | 2 | 3;

export const TIER_LABELS: Record<Tier, string> = {
  0: "Unverified",
  1: "Bronze",
  2: "Silver",
  3: "Gold",
};

export const TIER_THRESHOLDS: Record<string, number> = {
  bronze: 40,
  silver: 70,
  gold: 85,
};

/** Raw financial inputs the user provides — never leave the browser */
export interface PrivateInputs {
  txCount: number;        // total completed transactions
  disputeCount: number;   // disputed/failed transactions
  avgBalance: number;     // average balance in stroops
  monthsActive: number;   // months wallet has been active
  salt: string;           // random 32-byte hex salt (generated client-side)
}

/** Groth16 proof returned by snarkjs */
export interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: "groth16";
  curve: "bn128";
}

/** Public signals output from the circuit */
export interface PublicSignals {
  meets_threshold: string; // "1" or "0"
  threshold: string;
  commitment: string;
}

/** Full proof bundle ready to submit on-chain */
export interface ProofBundle {
  proof: Groth16Proof;
  publicSignals: PublicSignals;
  tier: Tier;
  threshold: number;
}

/** Result from the payment gate quote() call */
export interface PaymentQuote {
  fee: bigint;
  net: bigint;
  tier: Tier;
  tierLabel: string;
  feePercent: string;
}
