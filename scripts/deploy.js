#!/usr/bin/env node
/**
 * Nullius — Testnet Deployment Script
 *
 * Deploys all three contracts in order to Stellar testnet:
 *   1. groth16_verifier
 *   2. reputation_registry  (needs verifier address)
 *   3. payment_gate         (needs registry address)
 *
 * Then initializes registry + gate, and writes all contract addresses
 * to sdk/src/contract_ids.json for the SDK to pick up.
 *
 * Prerequisites:
 *   stellar keys generate deployer --network testnet
 *   stellar keys fund deployer --network testnet
 *   npm run contracts:build   (cargo build --target wasm32v1-none --release)
 *
 * Usage:
 *   node scripts/deploy.js
 */

const { execSync } = require("child_process");
const fs           = require("path").resolve;
const path         = require("path");

const NETWORK     = "testnet";
const SOURCE      = "deployer";
const WASM_DIR    = path.join(__dirname, "../target/wasm32v1-none/release");
const SDK_OUT     = path.join(__dirname, "../sdk/src/contract_ids.json");
const CONTRACTS_OUT = path.join(__dirname, "../.contract_addresses.json");

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/**
 * Execute a shell command, retrying up to `retries` times on transient
 * RPC/network errors. Non-network errors exit immediately.
 */
function run(cmd, label, retries = 2) {
  console.log(`\n→ ${label}`);
  console.log(`  $ ${cmd}`);

  const TRANSIENT_PATTERNS = [
    /connection refused/i,
    /timeout/i,
    /ECONNRESET/i,
    /network error/i,
    /429/,          // rate limited
    /503/,          // service unavailable
  ];

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const out = execSync(cmd, { encoding: "utf8" }).trim();
      console.log(`  ${out}`);
      return out;
    } catch (e) {
      const msg = (e.stderr || e.message || "").toString();
      const isTransient = TRANSIENT_PATTERNS.some((p) => p.test(msg));

      if (isTransient && attempt < retries) {
        const waitMs = 3000 * (attempt + 1);
        console.warn(`  ⚠ Transient error (attempt ${attempt + 1}/${retries + 1}), retrying in ${waitMs / 1000}s...`);
        // Synchronous sleep via a tight loop (deploy script is already blocking)
        const end = Date.now() + waitMs;
        while (Date.now() < end) { /* spin */ }
        continue;
      }

      console.error(`\nERROR during: ${label}`);
      console.error(msg);
      process.exit(1);
    }
  }
}

function deployContract(name, wasmFile) {
  const wasmPath = path.join(WASM_DIR, wasmFile);
  const fsSafe   = require("fs");

  if (!fsSafe.existsSync(wasmPath)) {
    console.error(`WASM not found: ${wasmPath}`);
    console.error("Run: cargo build --target wasm32v1-none --release");
    process.exit(1);
  }

  // Sanity-check: a valid WASM file is always at least a few KB.
  // Zero-byte or tiny files indicate a failed build silently succeeded.
  const { size } = fsSafe.statSync(wasmPath);
  if (size < 1024) {
    console.error(`WASM file is suspiciously small (${size} bytes): ${wasmPath}`);
    console.error("This usually means the build failed silently. Re-run: npm run contracts:build");
    process.exit(1);
  }
  console.log(`  WASM size: ${(size / 1024).toFixed(1)} KB`);

  const contractId = run(
    `stellar contract deploy \
      --wasm ${wasmPath} \
      --source ${SOURCE} \
      --network ${NETWORK}`,
    `Deploy ${name}`
  );

  console.log(`  ✓ ${name}: ${contractId}`);
  return contractId;
}

function invokeContract(contractId, fn, args, label) {
  const argStr = args.map(([k, v]) => `--${k} ${v}`).join(" ");
  return run(
    `stellar contract invoke \
      --id ${contractId} \
      --source ${SOURCE} \
      --network ${NETWORK} \
      -- ${fn} ${argStr}`,
    label
  );
}

// ----------------------------------------------------------------
// Main deployment flow
// ----------------------------------------------------------------
console.log("=== Nullius Testnet Deployment ===");
console.log(`Network:  ${NETWORK}`);
console.log(`Deployer: ${SOURCE}`);
console.log("");

// Check stellar CLI available
run("stellar --version", "Check Stellar CLI");

// Step 1: Deploy verifier
const verifierId = deployContract(
  "groth16_verifier",
  "groth16_verifier.wasm"
);

// Step 2: Deploy registry
const registryId = deployContract(
  "reputation_registry",
  "reputation_registry.wasm"
);

// Step 3: Deploy payment gate
const gateId = deployContract(
  "payment_gate",
  "payment_gate.wasm"
);

// Step 4: Initialize registry with verifier address
invokeContract(
  registryId,
  "initialize",
  [["verifier", verifierId]],
  "Initialize reputation_registry"
);

// Step 5: Initialize gate with registry address
invokeContract(
  gateId,
  "initialize",
  [["registry", registryId]],
  "Initialize payment_gate"
);

// Step 6: Write addresses to SDK + local file
const addresses = {
  groth16Verifier:    verifierId,
  reputationRegistry: registryId,
  paymentGate:        gateId,
  network:            NETWORK,
  deployedAt:         new Date().toISOString(),
};

require("fs").writeFileSync(SDK_OUT, JSON.stringify(addresses, null, 2));
require("fs").writeFileSync(CONTRACTS_OUT, JSON.stringify(addresses, null, 2));

// Step 7: Print explorer links
console.log("\n=== Deployment complete ===");
console.log("");
console.log("Contract addresses:");
console.log(`  groth16_verifier:    ${verifierId}`);
console.log(`  reputation_registry: ${registryId}`);
console.log(`  payment_gate:        ${gateId}`);
console.log("");
console.log("Stellar Expert explorer links:");
console.log(`  https://stellar.expert/explorer/testnet/contract/${verifierId}`);
console.log(`  https://stellar.expert/explorer/testnet/contract/${registryId}`);
console.log(`  https://stellar.expert/explorer/testnet/contract/${gateId}`);
console.log("");
console.log("Addresses written to:");
console.log(`  ${SDK_OUT}`);
console.log(`  ${CONTRACTS_OUT}`);
console.log("");
console.log("Next: update sdk/src/contracts.ts CONTRACT_IDS with these addresses.");
console.log("Or:   the SDK will auto-read from contract_ids.json if you wire it up.");
