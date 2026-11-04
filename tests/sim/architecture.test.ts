import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SIM_DIR = join(import.meta.dirname, "../../src/sim");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTsFiles(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("sim/ 아키텍처 규칙", () => {
  it("src/sim/에 TypeScript 파일이 존재한다", () => {
    expect(listTsFiles(SIM_DIR).length).toBeGreaterThan(0);
  });

  it("src/sim/은 @babylonjs 패키지를 임포트하지 않는다 (서버 재사용)", () => {
    const importRe = /(?:import|export)[^;]*?from\s*["'](@babylonjs\/[^"']*)["']|import\(\s*["'](@babylonjs\/[^"']*)["']\s*\)|import\s*["'](@babylonjs\/[^"']*)["']/g;
    const violations: string[] = [];
    for (const file of listTsFiles(SIM_DIR)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(importRe)) {
        violations.push(`${relative(SIM_DIR, file)}: ${m[1] ?? m[2] ?? m[3]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
