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
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  build: {
    target: "esnext",
  },
});
