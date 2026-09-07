// Minimal stub for snarkjs — fullProve/verify are never called in unit tests
export const groth16 = {
  fullProve: async () => { throw new Error("snarkjs.groth16.fullProve not available in unit tests"); },
  verify:    async () => false,
};
