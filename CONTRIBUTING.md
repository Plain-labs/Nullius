# Contributing to Nullius

Thanks for your interest in contributing. This document covers how to get set up,
the project conventions, and what to check before opening a PR.

---

## Repository structure

```
nullius/
├── circuits/        Circom ZK circuit + setup scripts
├── contracts/       Soroban smart contracts (Rust)
├── sdk/             TypeScript SDK (@nullius/sdk)
├── frontend/        React + Vite frontend
└── scripts/         Deployment + VK extraction scripts
```

---

## Development setup

### Contracts (Rust)

```bash
# Install Rust + wasm target
rustup target add wasm32-unknown-unknown

# Run all contract tests
cargo test --all

# Check formatting
cargo fmt --all -- --check

# Run Clippy (zero warnings policy)
cargo clippy --all-targets -- -D warnings

# Build WASM artifacts
cargo build --target wasm32-unknown-unknown --release
```

### SDK + Frontend (TypeScript)

```bash
npm install

# Build SDK
npm run build:sdk

# Type-check frontend
npx tsc --noEmit --project frontend/tsconfig.json

# Build frontend
npm run build:frontend

# Start dev server
npm run dev
```

### ZK circuit

```bash
# Requires circom + snarkjs installed globally
npm install -g circom snarkjs

npm run circuit:compile   # compile → r1cs + wasm
npm run circuit:setup     # trusted setup → zkey + verification_key.json
npm run vk:all            # extract VK bytes into contracts/groth16_verifier/src/vk_bytes.rs
```

---

## Code conventions

### Rust
- `no_std` in all contracts — no standard library in Soroban WASM
- Every public contract function must have at least one test
- Panic messages must be user-readable (they surface in simulation errors)
- No `unwrap()` in production paths — use explicit panics with messages
- Run `cargo fmt` before committing

### TypeScript
- Strict mode enabled — no `any` without a comment explaining why
- SDK functions validate inputs and throw descriptive errors before any RPC call
- Browser-only APIs (crypto, fetch) are accessed via `window.*` or guarded with
  `typeof` checks so the SDK stays usable in Node test scripts
- No secrets or private keys in frontend code

### Git
- Branch naming: `feat/`, `fix/`, `chore/`, `docs/`
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
- Keep commits focused — one logical change per commit

---

## Pull request checklist

Before opening a PR, confirm:

- [ ] `cargo fmt --all -- --check` passes
- [ ] `cargo clippy --all-targets -- -D warnings` passes
- [ ] `cargo test --all` passes
- [ ] `npx tsc --noEmit --project frontend/tsconfig.json` passes
- [ ] New contract functions have tests
- [ ] No new `unwrap()` in production contract paths
- [ ] `.env` or secret values are not committed

---

## Contract upgrade policy

The three Soroban contracts do not currently implement upgrade paths. Any change
to contract logic requires a redeployment and a new contract address. Update
`sdk/src/contract_ids.json` and `.contract_addresses.json` after deploying.

---

## Reporting issues

Open a GitHub issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Relevant environment (browser, OS, Node version, Rust toolchain)

For security issues, do not open a public issue — email the maintainer directly.
