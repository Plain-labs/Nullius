// Type shims for packages that ship no TypeScript declarations.

declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
    verify(
      vkey: unknown,
      publicSignals: string[],
      proof: unknown
    ): Promise<boolean>;
  };
}

declare module "circomlibjs" {
  export function buildPoseidon(): Promise<{
    (inputs: bigint[]): Uint8Array;
    F: { toString(hash: Uint8Array): string };
  }>;
}
