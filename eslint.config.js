// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "coverage/", "public/", "raw/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // CLAUDE.md 코딩 규칙: any 금지
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // CLAUDE.md 아키텍처 원칙 1: sim/은 Babylon.js를 절대 임포트하지 않는다 (서버 재사용)
    files: ["src/sim/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@babylonjs/*", "@babylonjs/**"],
              message: "src/sim/은 순수 TypeScript만 사용합니다. Babylon.js 임포트 금지 (CLAUDE.md 아키텍처 원칙 1).",
            },
          ],
        },
      ],
    },
  },
  {
    // Babylon.js는 ES 모듈 개별 경로로만 임포트한다 (트리 셰이킹). 패키지 루트 임포트 금지.
    files: ["src/**/*.ts"],
    ignores: ["src/sim/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@babylonjs/core", message: "개별 모듈 경로로 임포트하세요. 예: @babylonjs/core/scene" },
            { name: "@babylonjs/loaders", message: "개별 모듈 경로로 임포트하세요. 예: @babylonjs/loaders/glTF/2.0" },
            { name: "@babylonjs/materials", message: "개별 모듈 경로로 임포트하세요." },
          ],
        },
      ],
    },
  },
  {
    files: ["tools/**/*.{js,mjs}", "*.config.{js,ts}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // 브라우저에서 실행되는 도구 코드 (e2e 검사의 page.evaluate, HDR→.env 변환 페이지)
    files: ["tools/e2e/**/*.mjs", "tools/env/**/*.mjs", "tools/hdr_to_env.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
