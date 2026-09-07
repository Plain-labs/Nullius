# Nullius — ZK Reputation Layer on Stellar

**Live demo:** https://nullius-taupe.vercel.app

Nullius lets any Stellar wallet prove its payment reputation — transaction history,
reliability, wallet age — using zero-knowledge cryptography, without revealing any
underlying financial data. A Soroban smart contract verifies the proof on-chain,
assigns a **Bronze / Silver / Gold** tier, and a payment gate enforces lower fees
and higher limits for verified users.

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
# Open http://localhost:5173 — connect Freighter on Testnet
```

See [DEMO.md](DEMO.md) for a step-by-step walkthrough.

---

## Why the ZK proof is load-bearing

The verifier contract cannot be bypassed:
- `submit_proof` panics on any invalid or missing proof
- The Poseidon commitment binds the proof to specific private inputs — it cannot be replayed
- `meets_threshold` is enforced both by the circuit output and by the verifier contract
- Stellar's native BN254 host functions (Protocol 22+) make on-chain pairing verification cheap

---

## Roadmap

| Milestone | Description |
|-----------|-------------|
| ✅ Testnet | Three contracts deployed, frontend live, Horizon data ingestion |
| 🔜 Ceremony | Project-specific Phase 2 trusted setup with public contributors |
| 🔜 Oracle | Horizon data attested by a light-client oracle to prevent input forgery |
| 🔜 SDK v2 | Embeddable `<NulliusGate>` React component for third-party dApps |
| 🔜 Mainnet | Mainnet deployment after security audit |

---

## Security notes

- The current trusted setup uses the Hermez Powers of Tau ceremony (Phase 1). A
  production deployment requires a project-specific Phase 2 ceremony.
- Financial data is currently sourced from Horizon by the client. A production
  deployment would add an oracle or light-client attestation layer to prevent
  users from manipulating inputs before they enter the circuit.
- Contracts have not yet been through a formal security audit.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
