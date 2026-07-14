#!/usr/bin/env node
/**
 * ProofPay — End-to-End Integration Test
 *
 * Runs the full pipeline without a browser:
 *   1. Generate a Groth16 proof using snarkjs
 *   2. Verify proof locally
 *   3. Submit to Stellar testnet via the registry contract
 *   4. Read back the tier and assert it's correct
 *   5. Call payment_gate.quote() and assert fee is correct for tier
 *
 * Usage:
 *   node scripts/e2e_test.js
 *
 * Environment variables:
 *   SECRET_KEY   — Stellar testnet secret key (starts with S...)
 *                  Defaults to a funded test keypair if not set.
 */

const snarkjs = require("snarkjs");
const path    = require("path");
const fs      = require("fs");
const {
  Keypair,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  SorobanRpc,
  nativeToScVal,
  xdr,
  scValToNative,
} = require("@stellar/stellar-sdk");

// ----------------------------------------------------------------
// Config
// ----------------------------------------------------------------
const WASM_PATH = path.join(__dirname, "../circuits/build/reputation_score_js/reputation_score.wasm");
const ZKEY_PATH = path.join(__dirname, "../circuits/keys/reputation_score_final.zkey");
const VK_PATH   = path.join(__dirname, "../circuits/keys/verification_key.json");
const IDS_PATH  = path.join(__dirname, "../sdk/src/contract_ids.json");

const RPC_URL   = "https://soroban-testnet.stellar.org";
const PASSPHRASE = Networks.TESTNET;

// ----------------------------------------------------------------
// Load contract addresses
// ----------------------------------------------------------------
if (!fs.existsSync(IDS_PATH)) {
  console.error("contract_ids.json not found. Run scripts/deploy.js first.");
  process.exit(1);
}
const CONTRACT_IDS = JSON.parse(fs.readFileSync(IDS_PATH, "utf8"));

// ----------------------------------------------------------------
// Test keypair
// ----------------------------------------------------------------
const SECRET = process.env.SECRET_KEY;
const keypair = SECRET ? Keypair.fromSecret(SECRET) : Keypair.random();
console.log("Test wallet:", keypair.publicKey());

// ----------------------------------------------------------------
// Helper: BigInt field element → 32-byte BE buffer
// ----------------------------------------------------------------
function fieldToBytes32(dec) {
  let val = BigInt(dec);
  const buf = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(val & 0xffn);
    val >>= 8n;
  }
  return buf;
}

function encodeG1(point) {
  return Buffer.concat([fieldToBytes32(point[0]), fieldToBytes32(point[1])]);
}

function encodeG2(point) {
  // c1 before c0 for Stellar BN254
  return Buffer.concat([
    fieldToBytes32(point[0][1]), fieldToBytes32(point[0][0]),
    fieldToBytes32(point[1][1]), fieldToBytes32(point[1][0]),
  ]);
}

// ----------------------------------------------------------------
// Step 1: Generate proof
// ----------------------------------------------------------------
async function generateProof() {
  console.log("\n[1/5] Generating Groth16 proof...");

  // Representative inputs for a Silver-tier user
  const salt = BigInt("0x" + require("crypto").randomBytes(31).toString("hex"));

  // Build Poseidon commitment (matches circuit)
  // For testing we use a simple hash stub; in production use circomlibjs
  const inputs = {
    tx_count:      "35",
    dispute_count: "1",
    avg_balance:   "5000",
    months_active: "10",
    salt:          salt.toString(),
    threshold:     "70",  // Silver
    // commitment computed by circuit witness — use snarkjs to derive
    commitment:    "0",   // snarkjs will compute this via witness generation
  };

  // snarkjs fullProve computes witness internally — commitment is a private output
  // We need to compute commitment externally to pass as public input.
  // For e2e test: use snarkjs calculateWitness first to get commitment, then prove.
  const { buildPoseidon } = require("circomlibjs");
  const poseidon = await buildPoseidon();
  const hash = poseidon([
    BigInt(inputs.tx_count),
    BigInt(inputs.dispute_count),
    BigInt(inputs.avg_balance),
    BigInt(inputs.months_active),
    salt,
  ]);
  inputs.commitment = poseidon.F.toString(hash);

  console.log("  Private inputs prepared (commitment derived locally)");
  console.log("  Commitment:", inputs.commitment.slice(0, 20) + "...");

  if (!fs.existsSync(WASM_PATH) || !fs.existsSync(ZKEY_PATH)) {
    console.log("\n  WASM/zkey not found — skipping actual proof generation.");
    console.log("  Run circuits/scripts/compile.sh + setup.sh first.");
    console.log("  Continuing with mock proof for structure validation...");
    return { proof: null, publicSignals: null, inputs };
  }

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputs, WASM_PATH, ZKEY_PATH
  );

  console.log("  ✓ Proof generated");
  console.log("  meets_threshold:", publicSignals[0]);
  console.log("  threshold:", publicSignals[1]);

  if (publicSignals[0] !== "1") {
    throw new Error("Circuit returned meets_threshold=0 — inputs don't satisfy threshold");
  }

  return { proof, publicSignals, inputs };
}

// ----------------------------------------------------------------
// Step 2: Local verification
// ----------------------------------------------------------------
async function verifyLocally(proof, publicSignals) {
  console.log("\n[2/5] Verifying proof locally with snarkjs...");

  if (!proof) { console.log("  Skipped (mock mode)"); return; }

  const vkey = JSON.parse(fs.readFileSync(VK_PATH, "utf8"));
  const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);

  if (!valid) throw new Error("Local verification FAILED");
  console.log("  ✓ Local verification passed");
}

// ----------------------------------------------------------------
// Step 3: Submit to Stellar testnet
// ----------------------------------------------------------------
async function submitToStellar(proof, publicSignals, inputs) {
  console.log("\n[3/5] Submitting proof to Stellar testnet...");

  if (!proof) { console.log("  Skipped (mock mode)"); return; }

  const server  = new SorobanRpc.Server(RPC_URL);
  const account = await server.getAccount(keypair.publicKey());

  const proofABytes  = encodeG1(proof.pi_a);
  const proofBBytes  = encodeG2(proof.pi_b);
  const proofCBytes  = encodeG1(proof.pi_c);
  const commitment   = fieldToBytes32(publicSignals[2]);

  const { Contract } = require("@stellar/stellar-sdk");
  const contract = new Contract(CONTRACT_IDS.reputationRegistry);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(contract.call(
      "submit_proof",
      nativeToScVal(keypair.publicKey(), { type: "address" }),
      nativeToScVal(70, { type: "u32" }),
      xdr.ScVal.scvBytes(proofABytes),
      xdr.ScVal.scvBytes(proofBBytes),
      xdr.ScVal.scvBytes(proofCBytes),
      xdr.ScVal.scvBytes(commitment),
    ))
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);

  const sendResult = await server.sendTransaction(prepared);
  if (sendResult.status !== "PENDING") {
    throw new Error(`Submit failed: ${sendResult.status}`);
  }

  // Poll for confirmation
  const txHash = sendResult.hash;
  console.log("  Tx submitted:", txHash);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const status = await server.getTransaction(txHash);
    if (status.status === "SUCCESS") {
      console.log("  ✓ Transaction confirmed");
      return txHash;
    }
    if (status.status === "FAILED") throw new Error(`Tx failed: ${txHash}`);
    process.stdout.write(".");
  }
  throw new Error("Tx confirmation timeout");
}

// ----------------------------------------------------------------
// Step 4: Read back tier
// ----------------------------------------------------------------
async function assertTier() {
  console.log("\n[4/5] Reading tier from registry...");

  const server  = new SorobanRpc.Server(RPC_URL);
  const account = await server.getAccount(keypair.publicKey());
  const { Contract } = require("@stellar/stellar-sdk");
  const contract = new Contract(CONTRACT_IDS.reputationRegistry);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(contract.call(
      "get_tier",
      nativeToScVal(keypair.publicKey(), { type: "address" })
    ))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if (!SorobanRpc.Api.isSimulationSuccess(result)) {
    throw new Error("get_tier simulation failed");
  }

  const tier = scValToNative(result.result.retval);
  const TIER_NAMES = ["Unverified", "Bronze", "Silver", "Gold"];
  console.log(`  ✓ On-chain tier: ${tier} (${TIER_NAMES[tier]})`);

  if (tier !== 2) {
    throw new Error(`Expected Silver (2), got ${tier}`);
  }

  return tier;
}

// ----------------------------------------------------------------
// Step 5: Quote check
// ----------------------------------------------------------------
async function assertQuote(tier) {
  console.log("\n[5/5] Checking payment gate quote...");

  const server  = new SorobanRpc.Server(RPC_URL);
  const account = await server.getAccount(keypair.publicKey());
  const { Contract } = require("@stellar/stellar-sdk");
  const contract = new Contract(CONTRACT_IDS.paymentGate);

  const AMOUNT_STROOPS = 1_000_000_000n; // 100 XLM

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(contract.call(
      "quote",
      nativeToScVal(keypair.publicKey(), { type: "address" }),
      nativeToScVal(AMOUNT_STROOPS, { type: "i128" })
    ))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if (!SorobanRpc.Api.isSimulationSuccess(result)) {
    throw new Error("quote simulation failed");
  }

  const [fee, net, returnedTier] = scValToNative(result.result.retval);

  // Silver = 1.0% fee
  const expectedFee = AMOUNT_STROOPS / 100n;
  console.log(`  Amount:  100.0000 XLM`);
  console.log(`  Fee:     ${Number(fee) / 10_000_000} XLM (expected 1.0% = 1.0 XLM)`);
  console.log(`  Net:     ${Number(net) / 10_000_000} XLM`);
  console.log(`  Tier:    ${returnedTier}`);

  if (fee !== expectedFee) {
    throw new Error(`Fee mismatch: got ${fee}, expected ${expectedFee}`);
  }

  console.log("  ✓ Fee correct for Silver tier");
}

// ----------------------------------------------------------------
// Run all steps
// ----------------------------------------------------------------
(async () => {
  console.log("=== ProofPay End-to-End Test ===\n");
  try {
    const { proof, publicSignals, inputs } = await generateProof();
    await verifyLocally(proof, publicSignals);
    await submitToStellar(proof, publicSignals, inputs);
    const tier = await assertTier();
    await assertQuote(tier);

    console.log("\n✓ All tests passed. ProofPay is working end-to-end on Stellar testnet.");
  } catch (err) {
    console.error("\n✗ Test failed:", err.message);
    process.exit(1);
  }
})();
