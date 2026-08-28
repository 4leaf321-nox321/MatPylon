import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@engine": r("src/engine"), "@shared": r("src/shared") } },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts"],
    // 엔진 테스트는 node 그대로. 화면 테스트만 DOM 이 필요하다.
    environmentMatchGlobs: [["tests/renderer/**", "jsdom"]],
  },
});
