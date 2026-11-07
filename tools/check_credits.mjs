#!/usr/bin/env node
// @ts-check
/**
 * public/assets/의 모든 파일이 credits.json에 기록돼 있는지 검사한다 (CLAUDE.md: 라이선스 기록이 없는 에셋은 커밋하지 않는다).
 *
 * 사용:
 *   node tools/check_credits.mjs            작업 폴더 기준
 *   node tools/check_credits.mjs --staged   커밋될 내용(git 인덱스) 기준 — pre-commit 훅이 쓴다
 *
 * 실패(종료 코드 1): 기록 없는 파일, 필수 필드(file/source/url/author/license)가 빈 항목
 * 경고만: 어떤 파일과도 맞지 않는 항목 (아직 최적화 결과물을 넣기 전일 수 있음)
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { ASSETS_DIR, CREDITS_PATH, checkCredits, listFiles, readCredits } from "./lib/credits.mjs";

const { values } = parseArgs({ options: { staged: { type: "boolean", default: false } } });

/** @returns {Promise<{ files: string[], entries: unknown[] }>} */
async function load() {
  if (values.staged) {
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { encoding: "utf8" });
    const files = git("ls-files", "-z", "--", ASSETS_DIR)
      .split("\0")
      .filter(Boolean)
      .map((f) => f.slice(ASSETS_DIR.length + 1));
    if (!files.includes("credits.json")) return { files, entries: [] };
    const data = /** @type {unknown} */ (JSON.parse(git("show", `:${CREDITS_PATH}`)));
    if (!Array.isArray(data)) throw new Error(`${CREDITS_PATH}는 배열이어야 합니다.`);
    return { files, entries: data };
  }
  if (!existsSync(ASSETS_DIR)) return { files: [], entries: [] };
  return { files: await listFiles(ASSETS_DIR), entries: existsSync(CREDITS_PATH) ? await readCredits() : [] };
}

try {
  const { files, entries } = await load();
  const report = checkCredits(files, entries);
  for (const p of report.unused) console.warn(`⚠ 맞는 파일이 없는 credits 항목: ${p}`);
  if (report.invalid.length || report.uncredited.length) {
    console.error(`✗ credits 검사 실패 (${values.staged ? "커밋될 내용" : "작업 폴더"} 기준)`);
    for (const { index, missing } of report.invalid) console.error(`  - credits.json [${index}] 빈 필드: ${missing.join(", ")}`);
    for (const f of report.uncredited) console.error(`  - 기록 없음: ${ASSETS_DIR}/${f}`);
    console.error('  credits.json에 { "file", "source", "url", "author", "license" }를 추가하세요 (file에 "textures/<이름>/*" 같은 패턴 가능).');
    process.exit(1);
  }
  const count = files.filter((f) => f !== "credits.json" && !f.endsWith(".gitkeep")).length;
  console.log(`✓ credits 검사 통과 (에셋 ${count}개, 항목 ${entries.length}개)`);
} catch (err) {
  console.error(`✗ credits 검사 오류: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
