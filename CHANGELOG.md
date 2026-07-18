# Changelog

All notable changes to Nullius are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- GitHub Actions CI pipeline (`ci.yml`) — builds and tests contracts, SDK, and frontend on every push
- `ErrorBoundary` React component — catches render errors and shows a user-friendly recovery screen
- Comprehensive unit tests for `payment_gate` contract (fee/limit logic, initialization guard, fee arithmetic)
- Comprehensive unit tests for `reputation_registry` contract (tier constants, `get_tier` default, `tier_name`, threshold rejection)
- Expanded `groth16_verifier` tests — covers `meets_threshold ≠ 1` rejection and encoding validation
- Input validation in `NulliusClient` — Stellar address and positive-amount checks before any RPC call
- `isValidStellarAddress` utility exported from SDK
- `NulliusClient.getServer()` — exposes the RPC server for advanced frontend signing flows
- Freighter `signTransaction` integration in `ProofGenerator` — replaces `Keypair.random()` demo stub
- `CONTRACT_IDS` now auto-loads from `sdk/src/contract_ids.json` or environment variables instead of hardcoded placeholders
- Open Graph and Twitter Card meta tags in `index.html`
- PWA meta tags (`theme-color`, `apple-mobile-web-app-capable`)
- Wallet connection error surfaced in the connect screen UI
- `CONTRIBUTING.md` — development setup, code style, and PR checklist
- `CHANGELOG.md` — this file
- `NulliusClient.buildSubmitProofTransaction(walletAddress, bundle)` — builds unsigned proof submission XDR for Freighter signing; frontend no longer duplicates transaction construction
- `encodeG1`, `encodeG2`, `encodeScalar` exported from SDK — shared by `contracts.ts` and available to consumers; removes duplicate implementations in the frontend
- Byte-length validation in `reputation_registry::submit_proof` — explicit panics with descriptive messages for wrong-length proof components, before the cross-contract call
- `quote` and `send` unit tests for `payment_gate` — mock registry stub, Silver/Unverified fee checks, zero-amount and over-limit rejections
- `VITE_NATIVE_TOKEN`, `VITE_FEE_COLLECTOR`, `VITE_ERROR_ENDPOINT`, `VITE_*` contract IDs added to `.env.example`
- Remote error reporting in `ErrorBoundary` via `navigator.sendBeacon` — fires when `VITE_ERROR_ENDPOINT` is set; swallows failures so reporting never crashes the app
- MIT `LICENSE` file
- Score formula breakdown table in README

### Changed
- `ProofGenerator` no longer imports `Keypair` from `@stellar/stellar-sdk`
- `App.tsx` wraps each tab panel in `ErrorBoundary`
- `groth16_verifier` test module refactored into helper functions for readability
- Silver tier color corrected from `#6b7280` (grey, indistinct from Unverified) to `#94a3b8` (silver-slate) in `ReputationCard` and `ProofHistory`
- `PaymentWidget` reads `VITE_NATIVE_TOKEN` and `VITE_FEE_COLLECTOR` at runtime with testnet fallbacks
- `useFreighter` hook no longer exports unused `sign` method; components call `signTransaction` directly
- `sdk/package.json` runtime dependencies pinned to exact versions (`@stellar/stellar-sdk@12.3.0`, `snarkjs@0.7.6`, `circomlibjs@0.1.7`)
- `.gitignore` `.env.*` exclusion narrowed to `.env.local` and `.env.*.local` so `.env.example` is tracked
- `waitForConfirmation` in SDK replaced fixed 1500ms poll with exponential backoff (1 s → 2 s → 4 s → 8 s, 30 s total budget)
- README deployed contracts table: TBD replaced with reference to `sdk/src/contract_ids.json`
- Placeholder GitHub link `your-repo/nullius` in footer replaced with `nullius-zk/nullius`

### Fixed
- `quote` function in `payment_gate` had an incorrect `#[allow(clippy::too_many_arguments)]` attribute removed (it doesn't take many args)
- `avg_balance` private input was committed via Poseidon hash but never used in `score_proxy` — now incorporated with a cap of 10,000 units; threshold scaling factor updated from 600 to 700; `selectThreshold()` and live score preview in `ProofGenerator` updated to match
- `vite.config.ts` was missing `Cross-Origin-Embedder-Policy: require-corp` header; without it browsers cannot expose `SharedArrayBuffer` and snarkjs falls back to single-threaded WASM (~3× slower)
- Dead `encodeBytes` closure in `ProofGenerator.handleGenerate` removed
- `ProofGenerator` local proof-encoding functions (`encodeG1Bytes`, `encodeG2Bytes`, `encodeScalarBytes`) removed; imports from SDK instead
- JSDoc on `generateReputationProof` documents the snarkjs output ordering vs on-chain input ordering asymmetry that was an undocumented footgun

---

## [0.1.0] — 2025-06-15

### Added
- Initial hackathon release for Stellar Hacks: Real-World ZK
- `ReputationScore` Circom 2.0 circuit with Poseidon commitment and Groth16 proof
- `Groth16Verifier` Soroban contract using Stellar native BN254 host functions
- `ReputationRegistry` contract — stores wallet → Bronze/Silver/Gold tier mapping
- `PaymentGate` contract — fee rates and payment limits gated by reputation tier
- TypeScript SDK (`@nullius/sdk`) — proof generation, local verification, contract client
- React + Vite frontend — `ProofGenerator`, `ReputationCard`, `PaymentWidget`
- Freighter wallet hook (`useFreighter`)
- Deployment script (`scripts/deploy.js`) and end-to-end test (`scripts/e2e_test.js`)
- VK extraction and verifier patching scripts
