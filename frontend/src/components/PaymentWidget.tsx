import { useState, useEffect } from "react";
import {
  NulliusClient,
  TIER_LABELS,
  isValidStellarAddress,
  CONTRACT_IDS,
} from "@nullius/sdk";
import type { Tier, PaymentQuote } from "@nullius/sdk";
import {
  Networks,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";

interface Props {
  walletAddress: string;
  currentTier: Tier;
}

export function PaymentWidget({ walletAddress, currentTier }: Props) {
  const [recipient, setRecipient]     = useState("");
  const [amount, setAmount]           = useState("");
  const [quote, setQuote]             = useState<PaymentQuote | null>(null);
  const [quoting, setQuoting]         = useState(false);
  const [sending, setSending]         = useState(false);
  const [txHash, setTxHash]           = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);

  const recipientValid = recipient === "" || isValidStellarAddress(recipient);
  const amountNum = parseFloat(amount);
  const amountValid = !amount || (amountNum > 0 && isFinite(amountNum));

  // Debounced quote fetch
  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0 || !isValidStellarAddress(recipient)) {
      setQuote(null);
      return;
    }
    const timer = setTimeout(async () => {
      setQuoting(true);
      try {
      const client = new NulliusClient();
        const stroops = BigInt(Math.round(parseFloat(amount) * 10_000_000));
        const q = await client.getQuote(walletAddress, stroops);
        setQuote(q);
      } catch {
        setQuote(null);
      } finally {
        setQuoting(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [amount, walletAddress]);

  const handleSend = async () => {
    if (!quote || !recipient || !amount || !recipientValid) return;
    setSending(true);
    setError(null);
    try {
      const client = new NulliusClient();
      const stroops = BigInt(Math.round(parseFloat(amount) * 10_000_000));

      // Native XLM token address on Stellar testnet
      const NATIVE_TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

      // Build tx → sign via Freighter → submit
      const unsignedXdr = await client.buildSendTransaction(
        walletAddress,
        recipient,
        NATIVE_TOKEN,
        stroops,
        walletAddress // fee goes back to sender in demo; replace with treasury address
      );

      const { signedTxXdr } = await signTransaction(unsignedXdr, {
        networkPassphrase: Networks.TESTNET,
      });

      const server = client.getServer();
      const result = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET)
      );

      if (result.status !== "PENDING") {
        throw new Error(`Transaction rejected by network: ${result.status}`);
      }

      setTxHash(result.hash);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "An unknown error occurred");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card">
      <h2>Send Payment</h2>
      <p className="subtitle">
        Your reputation tier (<strong>{TIER_LABELS[currentTier]}</strong>) determines
        your fee rate and payment limits.
      </p>

      <div className="form-grid form-grid--single">
        <div className="field">
          <label>Recipient Stellar address</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="G..."
            style={recipient && !recipientValid ? { borderColor: "var(--error)" } : {}}
            aria-invalid={recipient !== "" && !recipientValid}
            aria-describedby={recipient && !recipientValid ? "recipient-error" : undefined}
          />
          {recipient && !recipientValid && (
            <span id="recipient-error" style={{ color: "var(--error)", fontSize: 12 }}>
              Must be a valid Stellar address starting with G
            </span>
          )}
        </div>
        <div className="field">
          <label>Amount (XLM)</label>
          <input
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 500"
            style={amount && !amountValid ? { borderColor: "var(--error)" } : {}}
            aria-invalid={amount !== "" && !amountValid}
          />
          {amount && !amountValid && (
            <span style={{ color: "var(--error)", fontSize: 12 }}>
              Amount must be a positive number
            </span>
          )}
        </div>
      </div>

      {quoting && (
        <div className="step-indicator"><div className="step-spinner" /><span>Fetching quote…</span></div>
      )}

      {quote && !quoting && (
        <div className="quote-box">
          <div className="quote-row">
            <span>Amount</span>
            <strong>{amount} XLM</strong>
          </div>
          <div className="quote-row">
            <span>Fee ({quote.feePercent}% — {quote.tierLabel} tier)</span>
            <strong>{(Number(quote.fee) / 10_000_000).toFixed(4)} XLM</strong>
          </div>
          <div className="quote-row quote-row--net">
            <span>Recipient receives</span>
            <strong>{(Number(quote.net) / 10_000_000).toFixed(4)} XLM</strong>
          </div>
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      {txHash ? (
        <div className="success-box">
          ✓ Payment sent!{" "}
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View on Stellar Expert →
          </a>
        </div>
      ) : (
        <button
          className="btn-primary btn-full"
          onClick={handleSend}
          disabled={!quote || !recipient || !recipientValid || sending}
        >
          {sending ? "Sending…" : "Send Payment"}
        </button>
      )}

      {currentTier === 0 && (
        <div className="tier-warning">
          You don't have a verified reputation yet. Generate a proof first to access lower fees and higher limits.
        </div>
      )}
    </div>
  );
}
