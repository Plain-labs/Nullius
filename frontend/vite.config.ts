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
  // snarkjs uses Node built-ins — polyfill for browser
  define: { "process.env": {} },
  optimizeDeps: {
    exclude: ["snarkjs"],
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (used by snarkjs WASM)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    target: "esnext",
  },
});
