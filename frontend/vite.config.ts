import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@nullius/sdk": path.resolve(__dirname, "../sdk/src/index.ts"),
    },
  },
  // Polyfill Node globals used by snarkjs/circomlibjs at runtime
  define: {
    "process.env": "{}",
    "process.browser": "true",
    global: "globalThis",
  },
  optimizeDeps: {
    // Let Vite pre-bundle these so they work cleanly in the browser
    include: ["snarkjs", "circomlibjs"],
  },
  server: {
    headers: {
      // Both headers are required to enable SharedArrayBuffer, which snarkjs
      // uses for multi-threaded WASM proof generation. Without COEP, browsers
      // silently disable SAB and fall back to single-threaded mode (~3× slower).
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    target: "esnext",
  },
});
