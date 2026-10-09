import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Component tests (.tsx) use the same automatic JSX runtime as Next.js.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
