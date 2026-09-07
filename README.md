# Nullius - ZK Reputation Layer built on Stellar
Live Link: https://nullius-taupe.vercel.app/
Contract Address:

"groth16Verifier": "CBRRLMJZ7ZIL5MUVJFEVDKEGQCYBEOWYJ4DZZ6Z7UMMJYNQBJ7U7OWN2",

  "reputationRegistry": "CAAGXWZJO5GKWKR6VG2NMXHRK7VJKATPAFWNOMGJRYVK63KUFR32VXLN",
  
  "paymentGate": "CCPGLJ5EBCARCCIC55Q7MTSMOUTBYTUZ6OGXRV3EA4ZXUDQPJSGCBMBV",

> Prove your financial trustworthiness on Stellar without revealing any underlying data.

Actively developed on Stellar testnet, with mainnet deployment and full wallet integration planned — see the Roadmap below for current status.

## What it does

Nullius lets users prove their payment reputation (transaction history, clean record, wallet age) using **zero-knowledge proofs** — without exposing any raw financial data. A Soroban smart contract verifies the proof on-chain, assigns a **Bronze / Silver / Gold** tier, and a payment gate enforces lower fees and higher limits for verified users.

---

## The problem

Trust in peer-to-peer and DeFi payments is binary today: either you expose your
full transaction history, or the counterparty has no idea who they're dealing with.
This forces users to choose between privacy and credibility. There is no middle path.

## How Nullius solves it

A user's Stellar transaction history is fetched directly by their browser from the
public Horizon API. That data is fed into a Circom ZK circuit, which produces a
Groth16 proof that the computed reputation score meets a minimum threshold — without
revealing any of the underlying data.

The proof is verified on-chain by a Soroban contract using Stellar's native BN254
host functions. Once verified, the wallet is assigned a tier that the payment gate
enforces automatically.

```
Stellar Horizon API
    ↓  (browser fetches real tx history — never leaves the device)
Circom circuit computes score: tx count, dispute rate, wallet age, avg balance
    ↓
Groth16 proof generated via snarkjs (5–15s, entirely in-browser)
    ↓  [only proof + public commitment leave the browser]
Soroban: Groth16Verifier checks BN254 pairing on Stellar testnet
    ↓
ReputationRegistry stores tier: Bronze / Silver / Gold
    ↓
PaymentGate enforces fee rate + per-transaction limit automatically
```

---

## Reputation tiers

| Tier       | Score | Fee   | Max per transaction |
|------------|-------|-------|---------------------|
| Unverified | —     | 5.0%  | 1,000 XLM           |
| Bronze     | ≥ 40  | 2.0%  | 10,000 XLM          |
| Silver     | ≥ 70  | 1.0%  | 100,000 XLM         |
| Gold       | ≥ 85  | 0.3%  | 1,000,000 XLM       |

---

## Privacy guarantees

- Transaction history is fetched directly from Horizon by the user's browser
- Private inputs (tx count, dispute count, balance, wallet age) never leave the device
- The on-chain commitment is a Poseidon hash — it cannot be reversed
- Only the score tier and commitment hash are stored on-chain
- No Nullius server sees any underlying data at any point

---

## Stack

| Layer      | Technology |
|------------|-----------|
| ZK circuit | Circom 2.0 + snarkjs (Groth16 / BN254) |
| On-chain   | Soroban (Rust) — 3 contracts on Stellar |
| Data       | Stellar Horizon API (client-side fetch) |
| SDK        | TypeScript + Stellar SDK v12 |
| Frontend   | React + Vite + Freighter wallet |

---

## Deployed contracts (Stellar testnet)

| Contract             | Address |
|----------------------|---------|
| groth16_verifier     | `CBRRLMJZ7ZIL5MUVJFEVDKEGQCYBEOWYJ4DZZ6Z7UMMJYNQBJ7U7OWN2` |
| reputation_registry  | `CAAGXWZJO5GKWKR6VG2NMXHRK7VJKATPAFWNOMGJRYVK63KUFR32VXLN` |
| payment_gate         | `CCPGLJ5EBCARCCIC55Q7MTSMOUTBYTUZ6OGXRV3EA4ZXUDQPJSGCBMBV` |

---

## Monorepo structure

```
nullius/
├── circuits/
│   ├── reputation_score.circom   # ZK circuit
│   └── scripts/
│       ├── compile.sh            # Compile circuit → r1cs + wasm
│       └── setup.sh              # Groth16 trusted setup → zkey + vk
├── contracts/
│   ├── groth16_verifier/         # Verifies BN254 Groth16 proofs on Stellar
│   ├── reputation_registry/      # Stores wallet → tier mapping
│   └── payment_gate/             # Fee + limit enforcement
├── scripts/
│   ├── extract_vk.js             # VK → Rust byte arrays
│   ├── patch_verifier.js         # Patches lib.rs with real VK
│   ├── deploy.js                 # Deploy all contracts to testnet
│   └── e2e_test.js               # Full pipeline integration test
├── sdk/
│   └── src/
│       ├── types.ts              # Shared types
│       ├── prover.ts             # snarkjs proof generation
│       └── contracts.ts          # Stellar contract client
└── frontend/
    └── src/
        ├── App.tsx
        ├── hooks/
        │   ├── useFreighter.ts   # Wallet connection
        │   └── useHorizonData.ts # Real tx data from Horizon API
        └── components/
            ├── HorizonFetcher.tsx   # Review real wallet data before proving
            ├── ProofGenerator.tsx
            ├── ReputationCard.tsx
            └── PaymentWidget.tsx
```

---

## Score formula

Computed inside the ZK circuit — never on-chain:

| Component              | Max contribution | Cap         |
|------------------------|-----------------|-------------|
| Transaction count      | 40 pts          | 50 txs      |
| Clean transaction rate | 40 pts          | 50 clean txs|
| Wallet age             | 20 pts          | 12 months   |
| Average balance        | ~14 pts         | 1,000 XLM   |

All arithmetic uses integer scaling (factor 700) to avoid division in ZK constraints.
The circuit proves `score_proxy ≥ threshold × 700` using Groth16 over BN254.

---

## Build and run

### Prerequisites

```bash
# Rust + Soroban CLI
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli --features opt

# Circom + snarkjs
npm install -g circom snarkjs

# Node dependencies
npm install
```

### Full setup

```bash
# 1. Compile ZK circuit
npm run circuit:compile

# 2. Groth16 trusted setup (~700 MB ptau download)
npm run circuit:setup

# 3. Extract VK bytes into verifier contract
npm run vk:all

# 4. Build Soroban contracts
npm run contracts:build

# 5. Fund deployer wallet
stellar keys generate deployer --network testnet
stellar keys fund deployer --network testnet

# 6. Deploy to Stellar testnet
npm run deploy:testnet

# 7. Run end-to-end integration test
npm run test:e2e

# 8. Start frontend
npm run dev
```

Or in one step: `npm run setup:all`

### Frontend only (contracts already deployed)

```bash
cp .env.example .env
# Fill in VITE_* contract IDs from .contract_addresses.json
npm run dev
# Open http://localhost:5173
# Connect Freighter wallet (set to Testnet)
```

## How ZK is load-bearing

The ZK proof is not cosmetic — the Soroban contract **cannot be tricked**:
- Without a valid Groth16 proof, `submit_proof` panics
- The proof mathematically commits to the user's private inputs via Poseidon hash
- The `meets_threshold` output is enforced both by the circuit and the verifier contract
- Stellar's native BN254 host functions (Protocol 25/26) make verification cheap

### Score formula

The reputation score is computed inside the ZK circuit (never on-chain):

| Component | Max contribution | Notes |
|-----------|-----------------|-------|
| Transaction count | 40 pts | capped at 50 txs |
| Clean transaction rate | 40 pts | (tx_count − disputes) contribution |
| Wallet age | 20 pts | capped at 12 months |
| Average balance | ~14 pts | capped at 10,000 units (XLM/1000) |

All arithmetic uses integer scaling (factor 700) to avoid division in ZK constraints.

## Deployed contracts (Stellar testnet)

> Updated after deployment via `npm run deploy:testnet`.
> Run `cat sdk/src/contract_ids.json` to see the latest addresses.

| Contract | Address |
|----------|---------|
| groth16_verifier | See `sdk/src/contract_ids.json` |
| reputation_registry | See `sdk/src/contract_ids.json` |
| payment_gate | See `sdk/src/contract_ids.json` |

## Privacy guarantees

- Private inputs (tx history, balances, identity) never leave the user's browser
- The on-chain commitment is a Poseidon hash — cannot be reversed
- Only the score tier (Bronze/Silver/Gold) is stored on-chain
- No third party sees the underlying data at any point

## Roadmap

- [ ] Full Freighter `signTransaction` flow — replace remaining demo keypair paths and complete testing
- [ ] Replace self-reported financial data with real Stellar Horizon API integration
- [ ] Project-specific Groth16 trusted setup ceremony (currently uses the shared Hermez ceremony ptau)
- [ ] Mainnet deployment and security review

## License

MIT
