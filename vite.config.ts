import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: "src/renderer",
  base: "./",
  build: { outDir: "../../dist", emptyOutDir: true },
  resolve: {
    alias: { "@": r("src/renderer"), "@shared": r("src/shared"), "@engine": r("src/engine") },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: r("electron/main.ts"),
        vite: {
          build: {
            outDir: r("dist-electron"),
            // 네이티브 모듈은 번들하지 않는다 — electron-builder 가 리빌드해 넣는다.
            rollupOptions: { external: ["better-sqlite3"] },
          },
          resolve: { alias: { "@engine": r("src/engine"), "@shared": r("src/shared") } },
        },
      },
      preload: {
        input: r("electron/preload.ts"),
        vite: {
          build: { outDir: r("dist-electron") },
          resolve: { alias: { "@shared": r("src/shared") } },
        },
      },
    }),
  ],
});
