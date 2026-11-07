#!/usr/bin/env node
// @ts-check
/**
 * Poly Haven 에셋 다운로드 → raw/ 저장 → credits.json 자동 추가.
 *
 * 사용:
 *   node tools/fetch_polyhaven.mjs <에셋ID> [--name 재질명] [--res 2k] [--maps Diffuse,nor_gl,arm] [--format jpg] [--dry-run]
 *
 * --name: 게임에서 쓸 이름 (예: terrain_ash). 저장 폴더와 credits 패턴에 쓴다 — 에셋을 바꿔도 코드가 그대로이도록
 *         역할 기준 이름을 권장한다. 생략하면 에셋 ID.
 *
 * 예:
 *   node tools/fetch_polyhaven.mjs rocky_terrain_02                 텍스처: 컬러 + OpenGL 노멀 + ARM(ORM), 2K JPG
 *   node tools/fetch_polyhaven.mjs rocky_terrain_02 --maps diff,nor_gl,rough,ao,disp
 *   node tools/fetch_polyhaven.mjs kloofendal_48d_partly_cloudy_puresky --res 4k   HDRI(.hdr)
 *   node tools/fetch_polyhaven.mjs wooden_crate_02                  모델: glTF + 텍스처, 1K
 *
 * 기본 해상도는 CLAUDE.md 기준 (텍스처 2K, HDRI 2K, 모델 1K). 4K는 클로즈업 히어로 재질에만 쓴다.
 * 저장: 텍스처/HDRI → raw/textures/<이름>/, 모델 → raw/models/<이름>/
 * credits: 텍스처 "textures/<이름>/*", HDRI "hdri/<이름>*", 모델 "props/<이름>*" (최적화 결과물을 둘 위치)
 * 허용 목록에 막히면 멈추고 추가할 도메인을 알려 준다 (종료 코드 3).
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { upsertCredit } from "./lib/credits.mjs";
import { downloadTo, exitWithError, fetchJson, formatBytes } from "./lib/net.mjs";
import { POLYHAVEN_API, creditFor, kindFromType, rawDirFor, selectFiles } from "./lib/polyhaven.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    res: { type: "string" },
    maps: { type: "string" },
    format: { type: "string" },
    out: { type: "string" },
    name: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const id = positionals[0];
if (!id || !/^[a-z0-9_]+$/i.test(id)) {
  console.error("사용: node tools/fetch_polyhaven.mjs <에셋ID> [--name 재질명] [--res 2k] [--maps Diffuse,nor_gl,arm] [--format jpg] [--dry-run]");
  process.exit(2);
}
const assetName = values.name ?? id;
if (!/^[a-z0-9_]+$/i.test(assetName)) {
  console.error(`--name은 영문/숫자/밑줄만 쓸 수 있습니다: ${assetName}`);
  process.exit(2);
}

try {
  const info = await fetchJson(`${POLYHAVEN_API}/info/${id}`);
  if (typeof info !== "object" || info === null || !("type" in info)) throw new Error(`에셋을 찾을 수 없습니다: ${id}`);
  const kind = kindFromType(info.type);
  const files = await fetchJson(`${POLYHAVEN_API}/files/${id}`);
  /** @type {{ res?: string, maps?: string[], format?: string }} */
  const opts = {};
  if (values.res) opts.res = values.res;
  if (values.format) opts.format = values.format;
  if (values.maps) opts.maps = values.maps.split(",").map((s) => s.trim()).filter(Boolean);
  const selected = selectFiles(id, kind, files, opts);
  const outDir = values.out ?? rawDirFor(assetName, kind);
  const total = selected.reduce((s, f) => s + f.size, 0);
  const name = "name" in info ? String(info.name) : id;

  console.log(`Poly Haven: ${name} (${kind}) → ${outDir}/  [${selected.length}개, ${formatBytes(total)}]`);
  if (/^(8|16)k$/i.test(opts.res ?? "")) console.warn("⚠ 8K 이상은 개발용으로 너무 큽니다. CLAUDE.md 기준은 2K(일반)~4K(히어로/최종 HDRI)입니다.");
  for (const f of selected) console.log(`  - ${f.name}  ${formatBytes(f.size)}`);
  if (values["dry-run"]) {
    console.log("(--dry-run: 내려받지 않음)");
    process.exit(0);
  }

  for (const f of selected) {
    const dest = join(outDir, f.name);
    const bytes = await downloadTo(f.url, dest);
    if (f.md5) {
      const md5 = createHash("md5").update(await readFile(dest)).digest("hex");
      if (md5 !== f.md5) throw new Error(`MD5 불일치: ${f.name} (받음 ${md5}, 기대 ${f.md5})`);
    }
    console.log(`  ✓ ${dest}  ${formatBytes(bytes)}`);
  }

  const credit = creditFor(id, kind, info, assetName);
  const result = await upsertCredit(credit);
  console.log(`credits.json ${result === "added" ? "추가" : "갱신"}: ${credit.file} — ${credit.author} (${credit.license})`);
  const next =
    kind === "texture"
      ? `다음: node tools/texture_ktx2.mjs ${outDir} public/assets/textures/${assetName} --name ${assetName}`
      : kind === "hdri"
        ? `다음: node tools/hdr_to_env.mjs ${outDir}/${selected[0]?.name ?? ""} public/assets/hdri/${assetName}.env`
        : `다음: node tools/optimize.mjs ${outDir}/${selected[0]?.name ?? ""} public/assets/props/${assetName}.glb`;
  console.log(next);
} catch (err) {
  exitWithError(err);
}
