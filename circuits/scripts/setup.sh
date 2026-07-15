#!/bin/bash
# Nullius — Groth16 Trusted Setup Script
# Runs Phase 1 (Powers of Tau download) + Phase 2 (circuit-specific setup)
# Output: circuits/keys/reputation_score_final.zkey + verification_key.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$CIRCUITS_DIR"

echo "=== Nullius Groth16 Trusted Setup ==="
echo ""

# Check prerequisites
if ! command -v npx &> /dev/null; then
  echo "ERROR: npx not found. Install Node.js ≥ 16."
  exit 1
fi

if [ ! -f "build/reputation_score.r1cs" ]; then
  echo "ERROR: build/reputation_score.r1cs not found."
  echo "Run circuits/scripts/compile.sh first."
  exit 1
fi

mkdir -p keys

PTAU_FILE="keys/pot16_final.ptau"
PTAU_URL="https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_16.ptau"

# Download ptau if not cached
if [ ! -f "$PTAU_FILE" ]; then
  echo "Downloading Powers of Tau ceremony file (~770 MB)..."
  echo "URL: $PTAU_URL"
  echo ""
  if command -v curl &> /dev/null; then
    curl -L --progress-bar "$PTAU_URL" -o "$PTAU_FILE"
  elif command -v wget &> /dev/null; then
    wget --show-progress "$PTAU_URL" -O "$PTAU_FILE"
  else
    echo "ERROR: neither curl nor wget found."
    exit 1
  fi
  echo ""
  echo "✓ Powers of Tau downloaded"
else
  echo "✓ Using cached ptau: $PTAU_FILE"
fi

echo ""
echo "[1/4] Phase 2 initial setup..."
npx snarkjs groth16 setup \
  build/reputation_score.r1cs \
  "$PTAU_FILE" \
  keys/reputation_score_0.zkey

echo ""
echo "[2/4] Contributing entropy (hackathon ceremony)..."
echo "nullius-setup-$(date +%s)" | \
  npx snarkjs zkey contribute \
    keys/reputation_score_0.zkey \
    keys/reputation_score_final.zkey \
    --name="Nullius hackathon setup" \
    -v

echo ""
echo "[3/4] Exporting verification key..."
npx snarkjs zkey export verificationkey \
  keys/reputation_score_final.zkey \
  keys/verification_key.json

echo ""
echo "[4/4] Verifying key integrity..."
npx snarkjs zkey verify \
  build/reputation_score.r1cs \
  "$PTAU_FILE" \
  keys/reputation_score_final.zkey

echo ""
echo "=== Setup complete ==="
echo ""
echo "Keys written to circuits/keys/"
echo "  reputation_score_final.zkey  — prover key (keep private)"
echo "  verification_key.json        — verifier key (public)"
echo ""
echo "Next: run 'npm run vk:all' to extract VK bytes and patch the verifier contract."
