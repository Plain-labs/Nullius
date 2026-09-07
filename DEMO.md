# Nullius — Demo Walkthrough

This guide walks through the full Nullius flow from a fresh browser session.
Takes about 3 minutes end-to-end.

---

## Prerequisites

1. **Freighter wallet** installed in your browser — [freighter.app](https://freighter.app)
2. Freighter set to **Testnet** (Settings → Network → Testnet)
3. A funded testnet account — if your wallet has no XLM yet, fund it via
   [Stellar Friendbot](https://friendbot.stellar.org) (paste your G… address)

---

## Step 1 — Connect your wallet

Open [https://proxima-beryl.vercel.app](https://proxima-beryl.vercel.app) and click
**Connect Freighter Wallet**. Approve the connection in the Freighter popup.

Your truncated address appears in the top-right corner once connected.

---

## Step 2 — Load real wallet data

You land on the **Generate Proof** tab. At the top you'll see a banner:

> ⬡ Load real wallet data

Click **Load from wallet**. Nullius fetches your transaction history directly from
the Stellar Horizon API — this is a public API call made by your browser; no data
is sent to any Nullius server.

After a few seconds you'll see a summary card showing:

- Total successful transactions
- Failed / disputed transactions
- Average XLM balance (sampled from recent payment history)
- Wallet age in months
- An estimated reputation score and tier

Review the data, then click **Use this data → Generate [Tier] Proof**.

> If your wallet is brand new and has little history, the score may fall below the
> Bronze threshold (40). In that case, use the **Enter manually** option to simulate
> a wallet with more history for testing purposes.

---

## Step 3 — Generate the ZK proof

The form pre-fills with your real data. You'll see a green badge:

> ⬡ Inputs sourced from your real Stellar transaction history

Click **Generate [Tier] Proof**. The proof is generated entirely in your browser
using snarkjs and the pre-compiled WASM circuit. This takes **5–15 seconds** on a
modern device — normal for Groth16.

The status bar cycles through:
1. Generating ZK proof in browser…
2. Verifying proof locally…
3. Submitting to Stellar testnet…

Freighter will pop up asking you to sign a transaction. Approve it. This submits
the proof to the `reputation_registry` contract on Stellar testnet.

---

## Step 4 — View your reputation tier

After the transaction confirms, you're taken to the **My Score** tab automatically.
You'll see your tier (Bronze / Silver / Gold) displayed with:

- Your verified tier ring
- Benefits: fee rate and maximum transaction size for your tier
- The latest proof commitment (truncated) — this is what's stored on-chain

---

## Step 5 — Send a payment

Switch to the **Send Payment** tab. Enter a recipient Stellar address (G…) and an
amount in XLM.

A live quote appears showing:
- Amount
- Fee (reduced based on your tier vs the 5% unverified rate)
- Amount the recipient will receive

Click **Send Payment**, approve in Freighter, and the payment is processed through
the `payment_gate` contract with your tier's fee rate applied automatically.

A link to the transaction on [Stellar Expert](https://stellar.expert/explorer/testnet)
appears on success.

---

## Running locally

```bash
git clone https://github.com/nullius-zk/nullius
cd nullius
npm install
cp .env.example .env
# Add your VITE_* contract IDs to .env
npm run dev
```

Open http://localhost:5173 and follow the same steps above.

---

## Contracts on Stellar testnet

| Contract            | Address |
|---------------------|---------|
| groth16_verifier    | `CBRRLMJZ7ZIL5MUVJFEVDKEGQCYBEOWYJ4DZZ6Z7UMMJYNQBJ7U7OWN2` |
| reputation_registry | `CAAGXWZJO5GKWKR6VG2NMXHRK7VJKATPAFWNOMGJRYVK63KUFR32VXLN` |
| payment_gate        | `CCPGLJ5EBCARCCIC55Q7MTSMOUTBYTUZ6OGXRV3EA4ZXUDQPJSGCBMBV` |

All three are open source — view them in this repo under `contracts/`.
