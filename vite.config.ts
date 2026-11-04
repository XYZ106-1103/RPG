import { defineConfig } from "vitest/config";

export default defineConfig({
  // Havok는 WASM을 별도 파일로 로드하므로 사전 번들링에서 제외한다.
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4096,
  },
  test: {
    // sim/ 로직 위주 단위 테스트 (Node 환경, 브라우저/GPU 불필요)
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    coverage: {
      include: ["src/sim/**/*.ts"],
    },
  },
});
