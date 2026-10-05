import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // テストではサーバー専用の目印を無効化する
      "server-only": fileURLToPath(new URL("./src/lib/__tests__/empty.ts", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
