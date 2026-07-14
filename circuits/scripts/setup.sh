#!/bin/bash
set -e
echo "Downloading Powers of Tau (Hermez ceremony)..."
curl -L https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_16.ptau \
    -o keys/pot16_final.ptau
echo "Phase 2: circuit-specific setup..."
npx snarkjs groth16 setup build/reputation_score.r1cs keys/pot16_final.ptau keys/reputation_score_0.zkey
echo "Contributing randomness..."
npx snarkjs zkey contribute keys/reputation_score_0.zkey keys/reputation_score_final.zkey --name="ProofPay hackathon" -v
echo "Exporting verification key..."
npx snarkjs zkey export verificationkey keys/reputation_score_final.zkey keys/verification_key.json
echo "Setup complete."