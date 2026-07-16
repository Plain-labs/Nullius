pragma circom 2.0.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

/*
 * ReputationScore circuit
 *
 * Proves that a user's computed reputation score meets a minimum threshold
 * WITHOUT revealing the underlying financial data.
 *
 * Private inputs (never on-chain):
 *   - tx_count:        number of completed transactions
 *   - dispute_count:   number of disputed transactions
 *   - avg_balance:     average wallet balance (scaled integer, e.g. stroops)
 *   - months_active:   how many months the wallet has been active
 *   - salt:            random salt to prevent brute-force of inputs
 *
 * Public inputs (go on-chain with the proof):
 *   - threshold:       minimum score the user claims to meet (e.g. 70 = Silver)
 *   - commitment:      Poseidon hash of private inputs (binds proof to this user)
 *
 * Output:
 *   - meets_threshold: 1 if score >= threshold, 0 otherwise
 *     (verifier contract checks this must be 1)
 */
template ReputationScore() {
    // --- Private inputs ---
    signal input tx_count;
    signal input dispute_count;
    signal input avg_balance;
    signal input months_active;
    signal input salt;

    // --- Public inputs ---
    signal input threshold;
    signal input commitment;

    // --- Output ---
    signal output meets_threshold;

    // -------------------------------------------------------
    // 1. Verify the commitment binds to the private inputs
    //    commitment = Poseidon(tx_count, dispute_count, avg_balance, months_active, salt)
    // -------------------------------------------------------
    component hasher = Poseidon(5);
    hasher.inputs[0] <== tx_count;
    hasher.inputs[1] <== dispute_count;
    hasher.inputs[2] <== avg_balance;
    hasher.inputs[3] <== months_active;
    hasher.inputs[4] <== salt;

    commitment === hasher.out;

    // -------------------------------------------------------
    // 2. Compute reputation score (0–100 scale)
    //
    //    Score components:
    //      - tx_score (0–40):  min(tx_count, 50) * 40 / 50
    //      - clean_score (0–40): (1 - dispute_rate) * 40
    //        where dispute_rate = dispute_count / tx_count
    //      - age_score (0–20): min(months_active, 12) * 20 / 12
    //
    //    All arithmetic is integer-only (no division in constraints).
    //    We rearrange to avoid division: prove relationships as inequalities.
    // -------------------------------------------------------

    // tx_score: capped at 50 txs → full 40 points
    // We encode: tx_score = min(tx_count, 50) * 40 / 50
    // Simplified: tx_score_50 = min(tx_count, 50)  (value 0-50)
    signal tx_capped;
    component tx_lt = LessThan(16);
    tx_lt.in[0] <== tx_count;
    tx_lt.in[1] <== 50;
    // If tx_count < 50, tx_capped = tx_count, else tx_capped = 50
    tx_capped <== tx_lt.out * tx_count + (1 - tx_lt.out) * 50;

    // age_score: capped at 12 months → full 20 points
    signal age_capped;
    component age_lt = LessThan(8);
    age_lt.in[0] <== months_active;
    age_lt.in[1] <== 12;
    age_capped <== age_lt.out * months_active + (1 - age_lt.out) * 12;

    // Combined score proxy (avoids division):
    // score_proxy = tx_capped * 12 * 40 + age_capped * 50 * 20
    //             + (tx_count - dispute_count) * 12 * 40
    // threshold check done on same scale
    // Scale everything by 600 (LCM of 50 and 12) to stay integer:
    //   tx contribution:   tx_capped * 480          (max 50*480=24000)
    //   clean contribution:(tx_count-disputes)*480   (max 24000)
    //   age contribution:  age_capped * 1000         (max 12000)
    //   total max = 60000 → 100 points scaled
    // threshold_scaled = threshold * 600

    signal clean_txs;
    clean_txs <== tx_count - dispute_count;

    signal score_proxy;
    score_proxy <== tx_capped * 480 + clean_txs * 480 + age_capped * 1000;

    signal threshold_scaled;
    threshold_scaled <== threshold * 600;

    // -------------------------------------------------------
    // 3. Check score_proxy >= threshold_scaled
    // -------------------------------------------------------
    component gte = GreaterEqThan(32);
    gte.in[0] <== score_proxy;
    gte.in[1] <== threshold_scaled;

    meets_threshold <== gte.out;
}

component main {public [threshold, commitment]} = ReputationScore();
