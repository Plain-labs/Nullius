import { useState, useEffect } from "react";
import { ProofPayClient, TIER_LABELS } from "@proofpay/sdk";
import type { Tier, PaymentQuote } from "@proofpay/sdk";

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

  // Debounced quote fetch
  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0) { setQuote(null); return; }
    const timer = setTimeout(async () => {
      setQuoting(true);
      try {
        const client = new ProofPayClient();
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
    if (!quote || !recipient || !amount) return;
    setSending(true);
    setError(null);
    try {
      // TODO: integrate Freighter signTransaction
      // For demo: show the tx would be constructed
      await new Promise((r) => setTimeout(r, 1500));
      setTxHash("DEMO_TX_" + Math.random().toString(36).slice(2, 10).toUpperCase());
    } catch (e: any) {
      setError(e.message);
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
          />
        </div>
        <div className="field">
          <label>Amount (XLM)</label>
          <input
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 500"
          />
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
          ✓ Payment sent! Tx: <code>{txHash}</code>
        </div>
      ) : (
        <button
          className="btn-primary btn-full"
          onClick={handleSend}
          disabled={!quote || !recipient || sending}
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
