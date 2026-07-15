// Type shims for packages and globals not covered by the SDK's tsconfig.

// Vite's ImportMeta augmentation (import.meta.env)
interface ImportMeta {
  readonly env: Record<string, string | undefined>;
}

// Minimal Buffer type alias so Uint8Array can satisfy stellar-base's
// scvBytes(value: Buffer) signature without pulling in @types/node.
// At runtime Uint8Array is passed directly — Buffer extends Uint8Array
// so no copy or conversion is needed.
declare class Buffer extends Uint8Array {}

// Vite build-time defines injected when bundling without env vars
declare const __GROTH16_VERIFIER_ID__: string | undefined;
declare const __REPUTATION_REGISTRY_ID__: string | undefined;
declare const __PAYMENT_GATE_ID__: string | undefined;

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
