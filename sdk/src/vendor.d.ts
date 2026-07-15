// Type shims for packages and globals not covered by the SDK's tsconfig.

// Node globals used in contracts.ts for env-based config loading
declare const process: {
  env: Record<string, string | undefined>;
  browser?: boolean;
};
declare function require(module: string): any;

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
