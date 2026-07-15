# Contributing to Nullius

Thanks for your interest in contributing. This document covers how to set up the development environment, the project conventions, and the pull request process.

## Project structure

```
nullius/
├── circuits/        Circom ZK circuit + trusted setup scripts
├── contracts/       Soroban smart contracts (Rust)
│   ├── groth16_verifier/
│   ├── reputation_registry/
│   └── payment_gate/
├── sdk/             TypeScript client library
├── frontend/        React + Vite web app
└── scripts/         Deployment and testing utilities
```

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Rust | stable  | `rustup target add wasm32-unknown-unknown` |
| Node.js | ≥ 20 | |
| stellar-cli | latest | `cargo install --locked stellar-cli --features opt` |
| Circom | 2.x | `npm install -g circom` |
| snarkjs | latest | `npm install -g snarkjs` |

## Setting up locally

```bash
git clone https://github.com/your-org/nullius
cd nullius
npm install
```

## Running contract tests

```bash
cargo test --all
```

For a specific contract:

```bash
cargo test -p payment-gate
cargo test -p reputation-registry
cargo test -p groth16-verifier
```

## Running the frontend

```bash
npm run dev
# Opens http://localhost:5173
# Connect Freighter wallet set to Testnet
```

The frontend requires compiled circuit artifacts (`circuits/build/`) and a
`sdk/src/contract_ids.json` from a deployment. Without them the UI will show
placeholder states — this is expected during development.

## Code style

**Rust**
- Format with `cargo fmt`
- No Clippy warnings: `cargo clippy --all-targets -- -D warnings`
- All public functions must have doc comments (`///`)

**TypeScript / React**
- Follow the existing ESLint + TypeScript strict config
- Component files use PascalCase; hooks use `use` prefix
- No `any` types without a comment explaining why

## Pull request checklist

- [ ] `cargo fmt` + `cargo clippy` pass with no warnings
- [ ] `cargo test --all` passes
- [ ] New contract logic has at least one unit test
- [ ] TypeScript compiles with `tsc --noEmit`
- [ ] PR description explains *what* and *why*, not just *what*

## Circuit changes

If you modify `circuits/reputation_score.circom`:

1. Re-run `npm run circuit:compile` and `npm run circuit:setup`
2. Re-run `npm run vk:all` to regenerate the Rust VK bytes
3. Re-run `npm run contracts:build` to rebuild the verifier
4. Update tests if the public signal layout changed

## Reporting issues

Please open a GitHub Issue with:
- Steps to reproduce
- Expected vs actual behaviour
- Relevant logs or error messages

## License

By contributing you agree your work will be released under the [MIT License](LICENSE).
