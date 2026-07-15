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

### Changed
- `ProofGenerator` no longer imports `Keypair` from `@stellar/stellar-sdk`
- `App.tsx` wraps each tab panel in `ErrorBoundary`
- `groth16_verifier` test module refactored into helper functions for readability

### Fixed
- `quote` function in `payment_gate` had an incorrect `#[allow(clippy::too_many_arguments)]` attribute removed (it doesn't take many args)

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
