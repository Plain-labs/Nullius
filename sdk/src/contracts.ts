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
// Contract addresses — loaded from contract_ids.json after deploy,
// or overridden by environment variables for flexibility.
// ----------------------------------------------------------------
function loadContractIds(): {
  groth16Verifier: string;
  reputationRegistry: string;
  paymentGate: string;
} {
  if (
    typeof process !== "undefined" &&
    process.env.GROTH16_VERIFIER_ID &&
    process.env.REPUTATION_REGISTRY_ID &&
    process.env.PAYMENT_GATE_ID
  ) {
    return {
      groth16Verifier:    process.env.GROTH16_VERIFIER_ID,
      reputationRegistry: process.env.REPUTATION_REGISTRY_ID,
      paymentGate:        process.env.PAYMENT_GATE_ID,
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ids = require("./contract_ids.json");
    return {
      groth16Verifier:    ids.groth16Verifier,
      reputationRegistry: ids.reputationRegistry,
      paymentGate:        ids.paymentGate,
    };
  } catch {
    return {
      groth16Verifier:    "REPLACE_AFTER_DEPLOY",
      reputationRegistry: "REPLACE_AFTER_DEPLOY",
      paymentGate:        "REPLACE_AFTER_DEPLOY",
    };
  }
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
// Proof encoding helpers
// ----------------------------------------------------------------

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

function encodeG2(
  point: [[string, string], [string, string], [string, string]]
): Uint8Array {
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

  /** Expose the underlying RPC server for direct use in frontend signing flows. */
  getServer(): SorobanRpc.Server {
    return this.server;
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
