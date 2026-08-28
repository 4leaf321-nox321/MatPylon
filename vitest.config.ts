import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { "@engine": r("src/engine"), "@shared": r("src/shared") } },
  test: { include: ["tests/**/*.test.ts", "src/**/*.test.ts"] },
});
