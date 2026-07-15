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
} from "@stellar/stellar-sdk";
import type { ProofBundle, PaymentQuote, Tier } from "./types";
import { TIER_LABELS } from "./types";

// ----------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------

/**
 * Returns true if the string is a valid Stellar public key (StrKey G-address).
 * A valid address starts with 'G' and is exactly 56 base32 characters.
 */
export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address);
}

// ----------------------------------------------------------------
// Contract addresses — replace after deploying to testnet
// ----------------------------------------------------------------
export const CONTRACT_IDS = {
  groth16Verifier:      "REPLACE_AFTER_DEPLOY",
  reputationRegistry:   "REPLACE_AFTER_DEPLOY",
  paymentGate:          "REPLACE_AFTER_DEPLOY",
} as const;

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

/**
 * Encode a Groth16 proof point (G1 or G2) into bytes for Soroban.
 * snarkjs returns decimal strings; we convert to 32-byte big-endian buffers.
 */
function encodeG1(point: [string, string, string]): Uint8Array {
  const buf = new Uint8Array(64);
  const x = BigInt(point[0]);
  const y = BigInt(point[1]);
  for (let i = 0; i < 32; i++) {
    buf[31 - i] = Number((x >> BigInt(i * 8)) & 0xffn);
    buf[63 - i] = Number((y >> BigInt(i * 8)) & 0xffn);
  }
  return buf;
}

function encodeG2(point: [[string, string], [string, string], [string, string]]): Uint8Array {
  // G2 points on BN254: each coordinate is (c0, c1) in Fp2, 32 bytes each = 128 bytes total
  const buf = new Uint8Array(128);
  const coords = [point[0][0], point[0][1], point[1][0], point[1][1]];
  coords.forEach((dec, idx) => {
    const val = BigInt(dec);
    for (let i = 0; i < 32; i++) {
      buf[idx * 32 + 31 - i] = Number((val >> BigInt(i * 8)) & 0xffn);
    }
  });
  return buf;
}

function encodeScalar(dec: string): Uint8Array {
  const buf = new Uint8Array(32);
  const val = BigInt(dec);
  for (let i = 0; i < 32; i++) {
    buf[31 - i] = Number((val >> BigInt(i * 8)) & 0xffn);
  }
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

  /**
   * Submit a reputation proof to the registry contract.
   * Signs and submits the transaction using the provided keypair.
   */
  async submitProof(
    keypair: Keypair,
    bundle: ProofBundle
  ): Promise<{ txHash: string; tier: Tier }> {
    const account = await this.server.getAccount(keypair.publicKey());

    const proofABytes  = encodeG1(bundle.proof.pi_a);
    const proofBBytes  = encodeG2(bundle.proof.pi_b);
    const proofCBytes  = encodeG1(bundle.proof.pi_c);
    const commitment   = encodeScalar(bundle.publicSignals.commitment);
    const threshold    = bundle.threshold;

    const contract = new Contract(CONTRACT_IDS.reputationRegistry);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "submit_proof",
          nativeToScVal(keypair.publicKey(), { type: "address" }),
          nativeToScVal(threshold,           { type: "u32" }),
          xdr.ScVal.scvBytes(proofABytes),
          xdr.ScVal.scvBytes(proofBBytes),
          xdr.ScVal.scvBytes(proofCBytes),
          xdr.ScVal.scvBytes(commitment),
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

    // Poll for confirmation
    const txHash = result.hash;
    await this.waitForConfirmation(txHash);

    return { txHash, tier: bundle.tier };
  }

  /**
   * Fetch the current reputation tier for a wallet address.
   */
  async getTier(walletAddress: string): Promise<Tier> {
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
      const val = scValToNative(result.result!.retval);
      return val as Tier;
    }
    throw new Error("Failed to fetch tier");
  }

  /**
   * Get a payment quote (fee, net, tier) without sending.
   */
  async getQuote(
    walletAddress: string,
    amountStroops: bigint
  ): Promise<PaymentQuote> {
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

  /** Expose the underlying RPC server instance for direct use (e.g., sendTransaction). */
  getServer(): SorobanRpc.Server {
    return this.server;
  }

  /** Build an unsigned XDR transaction for a token transfer. Returns the XDR string. */
  async buildSendTransaction(
    senderAddress: string,
    recipientAddress: string,
    tokenContractId: string,
    amountStroops: bigint,
    feeDestination: string
  ): Promise<string> {
    const account  = await this.server.getAccount(senderAddress);
    const contract = new Contract(CONTRACT_IDS.paymentGate);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "send",
          nativeToScVal(senderAddress,     { type: "address" }),
          nativeToScVal(recipientAddress,  { type: "address" }),
          nativeToScVal(tokenContractId,   { type: "address" }),
          nativeToScVal(amountStroops,     { type: "i128" }),
          nativeToScVal(feeDestination,    { type: "address" }),
        )
      )
      .setTimeout(30)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    return prepared.toXDR();
  }

  private async waitForConfirmation(txHash: string, maxAttempts = 20): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const status = await this.server.getTransaction(txHash);
      if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return;
      if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction failed on-chain: ${txHash}`);
      }
    }
    throw new Error("Transaction confirmation timeout");
  }
}
