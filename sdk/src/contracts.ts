import {
  Contract,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Keypair,
  SorobanRpc,
  scValToNative,
  nativeToScVal,
  StrKey,
} from "@stellar/stellar-sdk";
import type { ProofBundle, PaymentQuote, Tier } from "./types";
import { TIER_LABELS } from "./types";

// ----------------------------------------------------------------
// Contract addresses — overridden by VITE_ env vars when available,
// otherwise fall back to contract_ids.json (bundled after deploy).
// ----------------------------------------------------------------
function loadContractIds(): {
  groth16Verifier: string;
  reputationRegistry: string;
  paymentGate: string;
} {
  // Vite exposes env vars via import.meta.env (browser-safe)
  const env = (typeof import.meta !== "undefined" && import.meta.env) as
    | Record<string, string | undefined>
    | false;

  if (
    env &&
    env["VITE_GROTH16_VERIFIER_ID"] &&
    env["VITE_REPUTATION_REGISTRY_ID"] &&
    env["VITE_PAYMENT_GATE_ID"]
  ) {
    return {
      groth16Verifier:    env["VITE_GROTH16_VERIFIER_ID"]!,
      reputationRegistry: env["VITE_REPUTATION_REGISTRY_ID"]!,
      paymentGate:        env["VITE_PAYMENT_GATE_ID"]!,
    };
  }

  // Fallback: ids injected at build time via define or left as placeholder
  return {
    groth16Verifier:    (typeof __GROTH16_VERIFIER_ID__ !== "undefined" ? __GROTH16_VERIFIER_ID__ : "REPLACE_AFTER_DEPLOY"),
    reputationRegistry: (typeof __REPUTATION_REGISTRY_ID__ !== "undefined" ? __REPUTATION_REGISTRY_ID__ : "REPLACE_AFTER_DEPLOY"),
    paymentGate:        (typeof __PAYMENT_GATE_ID__ !== "undefined" ? __PAYMENT_GATE_ID__ : "REPLACE_AFTER_DEPLOY"),
  };
}

export const CONTRACT_IDS = loadContractIds();

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

// ----------------------------------------------------------------
// Input validation helpers
// ----------------------------------------------------------------

/** Returns true if the string is a valid Stellar G-address. */
export function isValidStellarAddress(address: string): boolean {
  try {
    return StrKey.isValidEd25519PublicKey(address);
  } catch {
    return false;
  }
}

function requireValidAddress(address: string, label = "address"): void {
  if (!isValidStellarAddress(address)) {
    throw new Error(
      `Invalid Stellar ${label}: "${address.slice(0, 12)}…" — must be a valid G… public key`
    );
  }
}

function requirePositiveAmount(amount: bigint, label = "amount"): void {
  if (amount <= 0n) {
    throw new Error(`${label} must be a positive number of stroops`);
  }
}

// ----------------------------------------------------------------
// Proof encoding helpers (exported for use by frontend and scripts)
// ----------------------------------------------------------------

/**
 * Encode a big-endian 32-byte representation of a decimal field element.
 * Used for both scalars and as a building block for G1/G2 point encoding.
 */
export function encodeScalar(dec: string): Uint8Array {
  const buf = new Uint8Array(32);
  const val = BigInt(dec);
  for (let i = 0; i < 32; i++) {
    buf[31 - i] = Number((val >> BigInt(i * 8)) & 0xffn);
  }
  return buf;
}

/**
 * Encode a BN254 G1 affine point as 64 bytes (x || y, each 32 bytes big-endian).
 * Matches the byte layout expected by Stellar's BN254 host functions.
 */
export function encodeG1(point: [string, string, string]): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set(encodeScalar(point[0]), 0);
  buf.set(encodeScalar(point[1]), 32);
  return buf;
}

/**
 * Encode a BN254 G2 affine point as 128 bytes.
 * Stellar BN254 expects c1 before c0 for each coordinate pair:
 * x_c1 || x_c0 || y_c1 || y_c0  (128 bytes total)
 */
export function encodeG2(
  point: [[string, string], [string, string], [string, string]]
): Uint8Array {
  // Stellar BN254 expects c1 before c0 for each coordinate pair.
  // Order: x_c1 || x_c0 || y_c1 || y_c0  (128 bytes total)
  const buf = new Uint8Array(128);
  const coords = [point[0][1], point[0][0], point[1][1], point[1][0]];
  coords.forEach((dec, idx) => {
    buf.set(encodeScalar(dec), idx * 32);
  });
  return buf;
}

// ----------------------------------------------------------------
// Nullius Contract Client
// ----------------------------------------------------------------
export class NulliusClient {
  private server: SorobanRpc.Server;

  constructor() {
    this.server = new SorobanRpc.Server(RPC_URL);
  }

  /** Expose the underlying RPC server for direct use in frontend signing flows. */
  getServer(): SorobanRpc.Server {
    return this.server;
  }

  /**
   * Build an unsigned XDR transaction to submit a reputation proof via Freighter.
   * Returns the unsigned XDR string — caller signs it and submits via server.sendTransaction().
   *
   * This is the preferred path for browser-based proof submission where the
   * private key is held by Freighter and never exposed to the SDK.
   */
  async buildSubmitProofTransaction(
    walletAddress: string,
    bundle: ProofBundle
  ): Promise<string> {
    requireValidAddress(walletAddress, "wallet address");

    const account = await this.server.getAccount(walletAddress);

    const proofABytes     = encodeG1(bundle.proof.pi_a);
    const proofBBytes     = encodeG2(bundle.proof.pi_b);
    const proofCBytes     = encodeG1(bundle.proof.pi_c);
    const commitmentBytes = encodeScalar(bundle.publicSignals.commitment);

    const contract = new Contract(CONTRACT_IDS.reputationRegistry);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "submit_proof",
          nativeToScVal(walletAddress,    { type: "address" }),
          nativeToScVal(bundle.threshold, { type: "u32" }),
          xdr.ScVal.scvBytes(proofABytes     as unknown as Buffer),
          xdr.ScVal.scvBytes(proofBBytes     as unknown as Buffer),
          xdr.ScVal.scvBytes(proofCBytes     as unknown as Buffer),
          xdr.ScVal.scvBytes(commitmentBytes as unknown as Buffer),
        )
      )
      .setTimeout(30)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    return prepared.toXDR();
  }

  /** Submit a reputation proof to the registry contract using a keypair. */
  async submitProof(
    keypair: Keypair,
    bundle: ProofBundle
  ): Promise<{ txHash: string; tier: Tier }> {
    requireValidAddress(keypair.publicKey(), "submitter public key");
    const account = await this.server.getAccount(keypair.publicKey());

    const proofABytes = encodeG1(bundle.proof.pi_a);
    const proofBBytes = encodeG2(bundle.proof.pi_b);
    const proofCBytes = encodeG1(bundle.proof.pi_c);
    const commitment  = encodeScalar(bundle.publicSignals.commitment);

    const contract = new Contract(CONTRACT_IDS.reputationRegistry);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "submit_proof",
          nativeToScVal(keypair.publicKey(), { type: "address" }),
          nativeToScVal(bundle.threshold,    { type: "u32" }),
          xdr.ScVal.scvBytes(proofABytes as unknown as Buffer),
          xdr.ScVal.scvBytes(proofBBytes as unknown as Buffer),
          xdr.ScVal.scvBytes(proofCBytes as unknown as Buffer),
          xdr.ScVal.scvBytes(commitment as unknown as Buffer),
        )
      )
      .setTimeout(30)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(keypair);

    const result = await this.server.sendTransaction(prepared);
    if (result.status !== "PENDING") {
      throw new Error(`Transaction failed: ${result.status}`);
    }

    await this.waitForConfirmation(result.hash);
    return { txHash: result.hash, tier: bundle.tier };
  }

  /** Fetch the current reputation tier for a wallet address. */
  async getTier(walletAddress: string): Promise<Tier> {
    requireValidAddress(walletAddress, "wallet address");
    const contract = new Contract(CONTRACT_IDS.reputationRegistry);
    const account  = await this.server.getAccount(walletAddress);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "get_tier",
          nativeToScVal(walletAddress, { type: "address" })
        )
      )
      .setTimeout(30)
      .build();

    const result = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationSuccess(result)) {
      return scValToNative(result.result!.retval) as Tier;
    }
    throw new Error("Failed to fetch tier");
  }

  /** Get a payment quote (fee, net, tier) without sending. */
  async getQuote(
    walletAddress: string,
    amountStroops: bigint
  ): Promise<PaymentQuote> {
    requireValidAddress(walletAddress, "wallet address");
    requirePositiveAmount(amountStroops, "amount");

    const contract = new Contract(CONTRACT_IDS.paymentGate);
    const account  = await this.server.getAccount(walletAddress);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "quote",
          nativeToScVal(walletAddress, { type: "address" }),
          nativeToScVal(amountStroops, { type: "i128" })
        )
      )
      .setTimeout(30)
      .build();

    const result = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationSuccess(result)) {
      const [fee, net, tier] = scValToNative(result.result!.retval) as [bigint, bigint, number];
      const feePercent = ((Number(fee) / Number(amountStroops)) * 100).toFixed(2);
      return {
        fee,
        net,
        tier: tier as Tier,
        tierLabel: TIER_LABELS[tier as Tier],
        feePercent,
      };
    }
    throw new Error("Failed to get quote");
  }

  /**
   * Build an unsigned XDR transaction for a token send via the payment gate.
   * The caller signs it with Freighter and submits via server.sendTransaction().
   */
  async buildSendTransaction(
    sender: string,
    recipient: string,
    tokenId: string,
    amountStroops: bigint,
    feeCollector: string
  ): Promise<string> {
    requireValidAddress(sender,       "sender");
    requireValidAddress(recipient,    "recipient");
    requireValidAddress(feeCollector, "fee collector");
    requirePositiveAmount(amountStroops, "payment amount");

    const contract = new Contract(CONTRACT_IDS.paymentGate);
    const account  = await this.server.getAccount(sender);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "send",
          nativeToScVal(sender,        { type: "address" }),
          nativeToScVal(recipient,     { type: "address" }),
          nativeToScVal(tokenId,       { type: "address" }),
          nativeToScVal(amountStroops, { type: "i128" }),
          nativeToScVal(feeCollector,  { type: "address" }),
        )
      )
      .setTimeout(30)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    return prepared.toXDR();
  }

  /**
   * Poll for transaction confirmation with exponential backoff.
   * Starts at 1 s, doubles each attempt (capped at 8 s), gives up after
   * maxWaitMs total elapsed time (default 30 s).
   */
  private async waitForConfirmation(
    txHash: string,
    maxWaitMs = 30_000
  ): Promise<void> {
    const start   = Date.now();
    let   delayMs = 1_000;

    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 8_000); // cap at 8 s

      const status = await this.server.getTransaction(txHash);
      if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return;
      if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction failed on-chain: ${txHash}`);
      }
    }
    throw new Error(`Transaction confirmation timeout after ${maxWaitMs / 1000}s: ${txHash}`);
  }
}
