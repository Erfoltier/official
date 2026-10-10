import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // API のテストは PHP 版（php/）を php -S で動かして確かめる（src/lib/__tests__/php/server.ts）
  test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 },
});
