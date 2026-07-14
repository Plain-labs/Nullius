#!/usr/bin/env node
/**
 * ProofPay — Testnet Deployment Script
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
 *   cargo build --target wasm32-unknown-unknown --release
 *
 * Usage:
 *   node scripts/deploy.js
 */

const { execSync } = require("child_process");
const fs           = require("path").resolve;
const path         = require("path");

const NETWORK     = "testnet";
const SOURCE      = "deployer";
const WASM_DIR    = path.join(__dirname, "../target/wasm32-unknown-unknown/release");
const SDK_OUT     = path.join(__dirname, "../sdk/src/contract_ids.json");
const CONTRACTS_OUT = path.join(__dirname, "../.contract_addresses.json");

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
function run(cmd, label) {
  console.log(`\n→ ${label}`);
  console.log(`  $ ${cmd}`);
  try {
    const out = execSync(cmd, { encoding: "utf8" }).trim();
    console.log(`  ${out}`);
    return out;
  } catch (e) {
    console.error(`\nERROR during: ${label}`);
    console.error(e.stderr || e.message);
    process.exit(1);
  }
}

function deployContract(name, wasmFile) {
  const wasmPath = path.join(WASM_DIR, wasmFile);
  if (!require("fs").existsSync(wasmPath)) {
    console.error(`WASM not found: ${wasmPath}`);
    console.error("Run: cargo build --target wasm32-unknown-unknown --release");
    process.exit(1);
  }

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
  const argStr = args.map(([k, v]) => `--arg-name ${k} --arg ${v}`).join(" ");
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
console.log("=== ProofPay Testnet Deployment ===");
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
