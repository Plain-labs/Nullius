// Deterministic stub for poseidon-lite used in jest tests.
// Returns a stable BigInt derived from the input sum so that tests which call
// generateReputationProof get a consistent, non-zero commitment without
// pulling in the real library's BN254 arithmetic.
// Parity with the real library is verified separately in poseidon_parity.test.ts.

function stubHash(inputs: Array<bigint | string | number>): bigint {
  return inputs.reduce<bigint>((acc, v) => acc + BigInt(v) + 1n, 42n);
}

export const poseidon1 = (inputs: Array<bigint | string | number>) => stubHash(inputs);
export const poseidon2 = (inputs: Array<bigint | string | number>) => stubHash(inputs);
export const poseidon3 = (inputs: Array<bigint | string | number>) => stubHash(inputs);
export const poseidon4 = (inputs: Array<bigint | string | number>) => stubHash(inputs);
export const poseidon5 = (inputs: Array<bigint | string | number>) => stubHash(inputs);
export const poseidon6 = (inputs: Array<bigint | string | number>) => stubHash(inputs);
export const poseidon7 = (inputs: Array<bigint | string | number>) => stubHash(inputs);
export const poseidon8 = (inputs: Array<bigint | string | number>) => stubHash(inputs);
