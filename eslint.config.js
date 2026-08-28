// `npm run lint` 가 스크립트만 있고 설정이 없어 그냥 실패하고 있었다. 규칙은 얇게 —
// 타입은 tsc 가 보고, 여기서는 **tsc 가 못 보는 것**만 본다(안 쓰는 값, 훅 규칙).
import js from "@eslint/js";
import ts from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default ts.config(
  { ignores: ["dist/**", "dist-electron/**", "release/**", "build/**", "scripts/make-icon.mjs"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    rules: {
      // 전역 이름(window·Buffer·NodeJS…)은 tsc 가 이미 판정한다. 여기서 또 보면 오탐뿐이다.
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["src/renderer/**/*.tsx", "tests/renderer/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      // 훅 순서와 의존성 빠짐만 본다. 의존성 누락은 화면이 조용히 옛 값을 쓰게 만든다 —
      // tsc 가 못 잡는 부류다.
      //
      // `recommended` 전체(컴파일러 규칙: set-state-in-effect · 렌더 중 순수성 등)는
      // **일부러 안 켠다.** 돌아가는 화면을 파일럿 직전에 갈아엎게 되고, 지적된 것들이
      // 실제 결함이 아니었다. 화면이 더 커지면 그때 한 번에 도입한다.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
