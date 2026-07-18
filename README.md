# Nullius — ZK Reputation Layer for Stellar Payments
Live Link: https://proxima-beryl.vercel.app/

> Prove your financial trustworthiness on Stellar without revealing any underlying data.

Built for **Stellar Hacks: Real-World ZK** (June 2025).

## What it does

Nullius lets users prove their payment reputation (transaction history, clean record, wallet age) using **zero-knowledge proofs** — without exposing any raw financial data. A Soroban smart contract verifies the proof on-chain, assigns a **Bronze / Silver / Gold** tier, and a payment gate enforces lower fees and higher limits for verified users.

```
User inputs financial data (stays in browser)
    ↓
Circom circuit computes reputation score
    ↓
Groth16 proof generated via snarkjs
    ↓  [only proof + public signals leave the browser]
Stellar testnet: Groth16Verifier contract checks BN254 pairing
    ↓
ReputationRegistry stores tier: Bronze / Silver / Gold
    ↓
PaymentGate enforces fee rate + payment limits
```

## Tiers

| Tier       | Score | Fee   | Max payment     |
|------------|-------|-------|-----------------|
| Unverified | —     | 5.0%  | 1,000 XLM/tx    |
| Bronze     | ≥ 40  | 2.0%  | 10,000 XLM/tx   |
| Silver     | ≥ 70  | 1.0%  | 100,000 XLM/tx  |
| Gold       | ≥ 85  | 0.3%  | 1,000,000 XLM/tx|

## Stack

| Layer     | Tech |
|-----------|------|
| ZK circuit | Circom 2.0 + snarkjs (Groth16 / BN254) |
| On-chain  | Soroban (Rust), 3 contracts on Stellar testnet |
| SDK       | TypeScript + Stellar SDK |
| Frontend  | React + Vite + Freighter wallet |

## Monorepo structure

```
nullius/
├── circuits/
│   ├── reputation_score.circom   # ZK circuit
│   ├── scripts/
│   │   ├── compile.sh            # Compile circuit → r1cs + wasm
│   │   └── setup.sh              # Groth16 trusted setup → zkey + vk
│   └── keys/                     # Generated keys (gitignored)
├── contracts/
│   ├── groth16_verifier/         # Verifies BN254 Groth16 proofs on Stellar
│   ├── reputation_registry/      # Stores wallet → tier mapping
│   └── payment_gate/             # Fee + limit enforcement
├── scripts/
│   ├── extract_vk.js             # VK → Rust byte arrays
│   ├── patch_verifier.js         # Auto-patches lib.rs with real VK
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
        ├── components/
        │   ├── ProofGenerator.tsx
        │   ├── ReputationCard.tsx
        │   └── PaymentWidget.tsx
        └── hooks/useFreighter.ts
```

## Build & run

### Prerequisites

```bash
# Rust + Soroban
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
cargo install --locked stellar-cli --features opt

# Circom + snarkjs
npm install -g circom snarkjs

# Node deps
npm install
```

### Step-by-step

```bash
# 1. Compile ZK circuit
npm run circuit:compile

# 2. Groth16 trusted setup (downloads ~700MB ptau file)
npm run circuit:setup

# 3. Extract VK bytes + patch verifier contract
npm run vk:all

# 4. Build Soroban contracts
npm run contracts:build

# 5. Fund deployer wallet on testnet
stellar keys generate deployer --network testnet
stellar keys fund deployer --network testnet

# 6. Deploy all contracts to Stellar testnet
npm run deploy:testnet

# 7. Run end-to-end integration test
npm run test:e2e

# 8. Start frontend
npm run dev
```

Or run everything at once:

```bash
npm run setup:all
```

### Run frontend only (after deployment)

```bash
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

## Known limitations (hackathon scope)

- Trusted setup uses Hermez ceremony ptau — production would need a project-specific ceremony
- Financial data is self-reported; production would integrate Stellar Horizon API or an oracle
- Freighter integration uses a demo keypair path in places — full signTransaction flow is wired but needs final testing

## License

MIT
