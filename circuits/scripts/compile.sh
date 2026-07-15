#!/bin/bash
# Nullius — Circuit Compilation Script
# Compiles reputation_score.circom → r1cs + wasm + sym

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$CIRCUITS_DIR"

echo "=== Nullius Circuit Compiler ==="
echo "Circuit dir: $CIRCUITS_DIR"
echo ""

# Check circom is installed
if ! command -v circom &> /dev/null; then
  echo "ERROR: circom not found. Install with: npm install -g circom"
  exit 1
fi

CIRCOM_VERSION=$(circom --version 2>&1 | head -1)
echo "circom version: $CIRCOM_VERSION"

# Install circomlib if not already present
if [ ! -d "node_modules/circomlib" ]; then
  echo ""
  echo "Installing circomlib..."
  npm install circomlib
fi

# Create build directory
mkdir -p build

# Compile
echo ""
echo "Compiling reputation_score.circom..."
circom reputation_score.circom \
  --r1cs \
  --wasm \
  --sym \
  --output build/ \
  --O2

echo ""
echo "=== Compilation complete ==="
echo ""

# Print constraint count
if command -v npx &> /dev/null; then
  echo "Circuit stats:"
  npx snarkjs r1cs info build/reputation_score.r1cs 2>/dev/null || true
fi

echo ""
echo "Outputs written to circuits/build/"
echo "  reputation_score.r1cs     — constraint system"
echo "  reputation_score.sym      — symbol table"
echo "  reputation_score_js/      — witness generation WASM"
echo ""
echo "Next: run circuits/scripts/setup.sh"
