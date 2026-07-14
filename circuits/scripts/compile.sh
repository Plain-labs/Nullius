#!/bin/bash
set -e
echo "Installing circomlib..."
npm install circomlib
echo "Compiling reputation_score.circom..."
circom reputation_score.circom --r1cs --wasm --sym --output build/
echo "Done. Outputs in circuits/build/"
