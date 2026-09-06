// Minimal stub for circomlibjs — only used in computeCommitment, not in computeScoreProxy tests
export const buildPoseidon = async () => {
  const fn = (inputs: bigint[]) => inputs[0]; // identity stub
  fn.F = { toString: (x: bigint) => x.toString() };
  return fn;
};
