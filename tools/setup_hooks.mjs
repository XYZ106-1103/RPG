// @ts-check
/**
 * npm install 때(prepare) Git 훅 폴더를 .githooks로 지정한다.
 * Git 저장소가 아니거나(CI 압축본 등) git이 없으면 조용히 건너뛴다.
 */
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
  console.log("[hooks] core.hooksPath = .githooks (pre-commit: credits 검사)");
} catch {
  // 무시
}
