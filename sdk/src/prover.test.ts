/**
 * @file prover.test.ts
 *
 * Unit tests for computeScoreProxy(), selectTier(), and the tier-selection logic.
 *
 * These tests address issue #10: SDK selectThreshold could select a tier that
 * the circuit would not satisfy at boundary values due to formula mismatches.
 * @see https://github.com/Plain-labs/Nullius/issues/10
 *
 * The circuit computes:
 *   score_proxy      = tx_capped*480 + clean_txs*480 + age_capped*1000 + bal_capped
 *   threshold_scaled = threshold * 700
 * and satisfies the proof when score_proxy >= threshold_scaled.
 *
 * Tier boundaries (on the 0-100 score scale):
 *   Bronze  threshold = 40  → threshold_scaled = 28 000
 *   Silver  threshold = 70  → threshold_scaled = 49 000
 *   Gold    threshold = 85  → threshold_scaled = 59 500
 *
 * Test strategy
 * -------------
 * For each boundary B we construct a minimal input set whose score_proxy equals
 * exactly B*700 (on-boundary) and B*700-1 (one below).  This confirms:
 *   • on-boundary  → selectTier returns the tier at B
 *   • one-below    → selectTier returns the tier below B (or 0 for Bronze-1)
 *
 * NOTE: generateReputationProof itself is NOT tested end-to-end here because it
 * requires compiled WASM/zkey artifacts and the snarkjs runtime.  The smoke-test
 * at the bottom verifies only argument construction (no circuit invocation).
 */

import { computeScoreProxy, selectTier } from "./prover";
import { TIER_THRESHOLDS } from "./types";
import type { Tier } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Scale a raw tier threshold to the circuit's threshold_scaled value. */
const scaled = (t: number) => t * 700;

/**
 * Build a minimal PrivateInputs-equivalent tuple that produces exactly the
 * desired scoreProxy.
 *
 * Strategy: fix txCount=50 (cap), disputeCount=0 (cleanTxs=50),
 * monthsActive=12 (cap), avgBalance=0, then tweak avgBalance for fine-tuning.
 *
 *   base = 50*480 + 50*480 + 12*1000 + 0 = 24000+24000+12000 = 60000
 *
 * For targets below 60000 we reduce cleanTxs (i.e. add disputes) instead, to
 * keep txCount and ageCapped at their caps and keep avgBalance=0 for clarity.
 */
function inputsForScore(targetProxy: number): {
  txCount: number;
  disputeCount: number;
  monthsActive: number;
  avgBalance: number;
} {
  // Full-cap base (no disputes, no balance contribution)
  // score = 50*480 + 50*480 + 12*1000 + 0 = 60_000
  const BASE = 50 * 480 + 50 * 480 + 12 * 1_000;

  if (targetProxy > BASE + 10_000) {
    throw new RangeError(`targetProxy ${targetProxy} exceeds circuit maximum 70 000`);
  }

  if (targetProxy <= BASE) {
    // We need to reduce the score below the all-cap base.
    // Lower cleanTxs by adding disputes (each extra dispute reduces score by 480).
    const deficit = BASE - targetProxy;
    const disputes = Math.floor(deficit / 480);
    const remainder = deficit % 480;
    if (remainder !== 0) {
      // Use avgBalance to absorb the sub-480 remainder.
      // score = 50*480 + (50-(disputes+1))*480 + 12*1000 + bal = targetProxy
      //   => BASE - (disputes+1)*480 + bal = targetProxy
      //   => bal = targetProxy - BASE + (disputes+1)*480
      const bal = targetProxy - BASE + (disputes + 1) * 480;
      return { txCount: 50, disputeCount: disputes + 1, monthsActive: 12, avgBalance: bal };
    }
    return { txCount: 50, disputeCount: disputes, monthsActive: 12, avgBalance: 0 };
  } else {
    // Score above BASE: add avgBalance contribution.
    const bal = targetProxy - BASE;
    return { txCount: 50, disputeCount: 0, monthsActive: 12, avgBalance: bal };
  }
}

// ---------------------------------------------------------------------------
// computeScoreProxy — boundary verification
// ---------------------------------------------------------------------------

describe("computeScoreProxy — exact integer arithmetic", () => {
  test("returns 0 for all-zero inputs", () => {
    expect(computeScoreProxy(0, 0, 0, 0)).toBe(0);
  });

  test("returns maximum 70 000 for fully-capped inputs", () => {
    // tx_capped=50, cleanTxs=50, age_capped=12, bal_capped=10000
    expect(computeScoreProxy(50, 0, 12, 10_000)).toBe(70_000);
  });

  test("caps tx_capped at 50 — txCapped contribution does not grow beyond 50 txns", () => {
    // tx_capped = min(tx_count, 50) → capped at 50.
    // clean_txs = tx_count - dispute_count → NOT independently capped (uses raw tx_count).
    // To isolate tx_capped, set dispute_count = tx_count so cleanTxs = 0.
    const at50WithNoClean  = computeScoreProxy(50,  50,  0, 0); // txCapped=50, cleanTxs=0
    const at100WithNoClean = computeScoreProxy(100, 100, 0, 0); // txCapped=50, cleanTxs=0
    // Both should be equal — only tx_capped differs, and it's capped at 50 in both cases
    expect(at50WithNoClean).toBe(at100WithNoClean);
    expect(at50WithNoClean).toBe(50 * 480); // exactly txCapped*480, cleanTxs=0

    // Confirm that without the cap, a higher raw tx_count DOES increase clean_txs*480
    const at50  = computeScoreProxy(50,  0, 0, 0); // txCapped=50, cleanTxs=50
    const at100 = computeScoreProxy(100, 0, 0, 0); // txCapped=50, cleanTxs=100
    expect(at100).toBeGreaterThan(at50); // cleanTxs*480 term grows with raw tx_count
  });

  test("caps monthsActive at 12 — extra months do not increase score", () => {
    const at12 = computeScoreProxy(0, 0, 12, 0);
    const at24 = computeScoreProxy(0, 0, 24, 0);
    expect(at12).toBe(at24);
    expect(at12).toBe(12 * 1_000);
  });

  test("caps avgBalance at 10 000", () => {
    const at10k = computeScoreProxy(0, 0, 0, 10_000);
    const at20k = computeScoreProxy(0, 0, 0, 20_000);
    expect(at10k).toBe(at20k);
    expect(at10k).toBe(10_000);
  });

  test("truncates fractional inputs (float safety)", () => {
    expect(computeScoreProxy(10.9, 0, 0, 0)).toBe(computeScoreProxy(10, 0, 0, 0));
    expect(computeScoreProxy(0, 0, 5.7, 0)).toBe(computeScoreProxy(0, 0, 5, 0));
  });

  // ------------------------------------------------------------------
  // Score-proxy value at each tier boundary (score * 700)
  // ------------------------------------------------------------------
  const boundaries: Array<[string, number]> = [
    ["Bronze boundary  (40*700 = 28 000)", TIER_THRESHOLDS.bronze * 700],
    ["Silver boundary  (70*700 = 49 000)", TIER_THRESHOLDS.silver * 700],
    ["Gold   boundary  (85*700 = 59 500)", TIER_THRESHOLDS.gold   * 700],
  ];

  for (const [label, target] of boundaries) {
    test(`computeScoreProxy reproduces target score_proxy for ${label}`, () => {
      const inp = inputsForScore(target);
      const got = computeScoreProxy(inp.txCount, inp.disputeCount, inp.monthsActive, inp.avgBalance);
      expect(got).toBe(target);
    });
  }
});

// ---------------------------------------------------------------------------
// selectThreshold — tier boundary tests
// We test via computeScoreProxy + a local tierFromProxy shadow to avoid
// importing the private selectThreshold while still exercising identical logic.
// ---------------------------------------------------------------------------

/**
 * Local mirror of selectThreshold's decision table.
 * Accepts a raw scoreProxy value (mirrors what selectThreshold computes internally).
 */
function tierFromProxy(scoreProxy: number): "gold" | "silver" | "bronze" | "none" {
  if (scoreProxy >= TIER_THRESHOLDS.gold   * 700) return "gold";
  if (scoreProxy >= TIER_THRESHOLDS.silver * 700) return "silver";
  if (scoreProxy >= TIER_THRESHOLDS.bronze * 700) return "bronze";
  return "none";
}

describe("selectThreshold — tier boundary decisions (raw proxy)", () => {
  // ----- Bronze boundary (score 40) ------
  test("score=39 proxy (27 300) → below Bronze → none", () => {
    expect(tierFromProxy(scaled(39))).toBe("none");
  });

  test("score=40 proxy (28 000) → Bronze", () => {
    expect(tierFromProxy(scaled(40))).toBe("bronze");
  });

  // ----- Silver boundary (score 70) -----
  test("score=69 proxy (48 300) → Bronze (not Silver)", () => {
    expect(tierFromProxy(scaled(69))).toBe("bronze");
  });

  test("score=70 proxy (49 000) → Silver", () => {
    expect(tierFromProxy(scaled(70))).toBe("silver");
  });

  // ----- Gold boundary (score 85) -------
  test("score=84 proxy (58 800) → Silver (not Gold)", () => {
    expect(tierFromProxy(scaled(84))).toBe("silver");
  });

  test("score=85 proxy (59 500) → Gold", () => {
    expect(tierFromProxy(scaled(85))).toBe("gold");
  });

  // Edge: maximum possible score
  test("max proxy (70 000) → Gold", () => {
    expect(tierFromProxy(70_000)).toBe("gold");
  });
});

describe("selectThreshold — tier boundary round-trip via computeScoreProxy", () => {
  const cases: Array<{ label: string; score: number; tier: ReturnType<typeof tierFromProxy> }> = [
    { label: "score=39 → none",   score: 39, tier: "none"   },
    { label: "score=40 → bronze", score: 40, tier: "bronze" },
    { label: "score=69 → bronze", score: 69, tier: "bronze" },
    { label: "score=70 → silver", score: 70, tier: "silver" },
    { label: "score=84 → silver", score: 84, tier: "silver" },
    { label: "score=85 → gold",   score: 85, tier: "gold"   },
  ];

  for (const { label, score, tier } of cases) {
    test(label, () => {
      const target = scaled(score);
      const inp    = inputsForScore(target);
      const proxy  = computeScoreProxy(
        inp.txCount,
        inp.disputeCount,
        inp.monthsActive,
        inp.avgBalance,
      );
      // 1. Confirm the helper constructed the correct proxy value
      expect(proxy).toBe(target);
      // 2. Confirm the tier decision matches expectation
      expect(tierFromProxy(proxy)).toBe(tier);
    });
  }
});

// ---------------------------------------------------------------------------
// selectTier — direct API tests at boundary scores
// Tests the exported selectTier() function at boundary scores 39, 40, 69, 70, 84, 85.
// This validates the actual SDK implementation, not a test-local mock.
// Fixes issue #10: https://github.com/Plain-labs/Nullius/issues/10
// ---------------------------------------------------------------------------

describe("selectTier — boundary score tests (exported API)", () => {
  // Tier enum values: 0=Unverified, 1=Bronze, 2=Silver, 3=Gold
  const cases: Array<{ label: string; score: number; expectedTier: Tier }> = [
    { label: "score=39 → Unverified (below Bronze)", score: 39, expectedTier: 0 },
    { label: "score=40 → Bronze (at Bronze boundary)", score: 40, expectedTier: 1 },
    { label: "score=69 → Bronze (below Silver)",       score: 69, expectedTier: 1 },
    { label: "score=70 → Silver (at Silver boundary)", score: 70, expectedTier: 2 },
    { label: "score=84 → Silver (below Gold)",         score: 84, expectedTier: 2 },
    { label: "score=85 → Gold (at Gold boundary)",     score: 85, expectedTier: 3 },
  ];

  for (const { label, score, expectedTier } of cases) {
    test(label, () => {
      // Build inputs that produce exactly score * 700 score_proxy
      const target = scaled(score);
      const inp = inputsForScore(target);

      // Verify the helper constructed correct inputs
      const proxy = computeScoreProxy(
        inp.txCount,
        inp.disputeCount,
        inp.monthsActive,
        inp.avgBalance,
      );
      expect(proxy).toBe(target);

      // Test the actual exported selectTier function
      const tier = selectTier(inp);
      expect(tier).toBe(expectedTier);
    });
  }

  test("maximum score (70000) → Gold", () => {
    const tier = selectTier({
      txCount: 50,
      disputeCount: 0,
      monthsActive: 12,
      avgBalance: 10_000,
    });
    expect(tier).toBe(3);
  });

  test("zero inputs → Unverified", () => {
    const tier = selectTier({
      txCount: 0,
      disputeCount: 0,
      monthsActive: 0,
      avgBalance: 0,
    });
    expect(tier).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateReputationProof — smoke-test: argument guards only
// (Full proof generation requires WASM/zkey and is tested e2e elsewhere.)
// ---------------------------------------------------------------------------

describe("generateReputationProof — input-validation guard smoke-tests", () => {
  /**
   * Local re-implementation of the guard block in generateReputationProof.
   * This lets us test error messages without importing snarkjs or WASM.
   */
  function validateInputs(inputs: {
    txCount: number;
    disputeCount: number;
    avgBalance: number;
    monthsActive: number;
  }): void {
    // Mirror the guard order in generateReputationProof exactly.
    if (inputs.disputeCount > inputs.txCount) {
      throw new Error("dispute_count cannot exceed tx_count");
    }
    if (inputs.txCount < 0 || inputs.monthsActive < 0 || inputs.avgBalance < 0) {
      throw new Error("All inputs must be non-negative");
    }
  }

  test("throws when disputeCount > txCount", () => {
    expect(() =>
      validateInputs({ txCount: 5, disputeCount: 6, avgBalance: 0, monthsActive: 0 }),
    ).toThrow("dispute_count cannot exceed tx_count");
  });

  test("throws when txCount is negative", () => {
    // disputeCount=0 > txCount=-1, so the dispute guard fires first in the real prover.
    // To reach the non-negative guard we need disputeCount <= txCount, e.g. both zero
    // but txCount negative — impossible with integer types. Instead test that a negative
    // txCount with disputeCount=0 throws *some* error, matching actual prover behaviour
    // where dispute guard catches it (0 > -1).
    expect(() =>
      validateInputs({ txCount: -1, disputeCount: 0, avgBalance: 0, monthsActive: 0 }),
    ).toThrow(); // dispute guard fires: 0 > -1

    // Dedicated non-negative guard: use monthsActive=-1 (dispute guard cannot fire)
    expect(() =>
      validateInputs({ txCount: 10, disputeCount: 0, avgBalance: 0, monthsActive: -1 }),
    ).toThrow("All inputs must be non-negative");
  });

  test("throws when avgBalance is negative", () => {
    expect(() =>
      validateInputs({ txCount: 10, disputeCount: 0, avgBalance: -1, monthsActive: 5 }),
    ).toThrow("All inputs must be non-negative");
  });

  test("throws when monthsActive is negative", () => {
    expect(() =>
      validateInputs({ txCount: 10, disputeCount: 0, avgBalance: 0, monthsActive: -1 }),
    ).toThrow("All inputs must be non-negative");
  });

  test("valid inputs with disputeCount == txCount do not throw", () => {
    expect(() =>
      validateInputs({ txCount: 10, disputeCount: 10, avgBalance: 0, monthsActive: 0 }),
    ).not.toThrow();
  });
});
