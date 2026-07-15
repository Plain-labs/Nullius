export function buildPoseidon(): Promise<{
  (inputs: bigint[]): Uint8Array;
  F: { toString(hash: Uint8Array): string };
}>;
