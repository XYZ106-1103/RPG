#!/usr/bin/env node
// @ts-check
/**
 * ambientCG 재질 다운로드 (기본 2K JPG) → 필요한 맵만 raw/textures/<ID>/에 풀기 → credits.json 자동 추가.
 *
 * 사용:
 *   node tools/fetch_ambientcg.mjs <에셋ID> [--attr 2K-JPG] [--dry-run]
 * 예:
 *   node tools/fetch_ambientcg.mjs Ground054
 *
 * 꺼내는 맵: Color, NormalGL(OpenGL 노멀), Roughness, AmbientOcclusion, Metalness, Displacement, Opacity
 * (NormalDX, 미리보기, 재질 정의 파일은 버린다)
 * credits: "textures/<ID>/*" (최적화 결과물을 둘 위치)
 * 허용 목록에 막히면 멈추고 추가할 도메인을 알려 준다 (종료 코드 3).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { unzipSync } from "fflate";
import { AMBIENTCG_API, DEFAULT_ATTRIBUTE, creditFor, mapOfEntry, parseAsset, pickDownload } from "./lib/ambientcg.mjs";
import { upsertCredit } from "./lib/credits.mjs";
import { exitWithError, fetchChecked, fetchJson, formatBytes } from "./lib/net.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    attr: { type: "string", default: DEFAULT_ATTRIBUTE },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const id = positionals[0];
if (!id || !/^[a-z0-9_-]+$/i.test(id)) {
  console.error("사용: node tools/fetch_ambientcg.mjs <에셋ID> [--attr 2K-JPG] [--dry-run]");
  process.exit(2);
}

try {
  const json = await fetchJson(`${AMBIENTCG_API}?id=${encodeURIComponent(id)}&include=downloadData`);
  const asset = parseAsset(json, id);
  const dl = pickDownload(asset, values.attr);
  const outDir = values.out ?? `raw/textures/${asset.assetId}`;
  console.log(`ambientCG: ${asset.displayName} (${dl.attribute}) → ${outDir}/  [zip ${formatBytes(dl.size)}]`);
  if (values["dry-run"]) {
    console.log(`  - ${dl.url}\n(--dry-run: 내려받지 않음)`);
    process.exit(0);
  }

  const res = await fetchChecked(dl.url);
  const zip = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(zip, { filter: (f) => mapOfEntry(f.name) !== null });
  const names = Object.keys(files);
  if (names.length === 0) throw new Error("압축 파일에 꺼낼 맵이 없습니다.");
  await mkdir(outDir, { recursive: true });
  for (const name of names.sort()) {
    const data = files[name];
    if (!data) continue;
    const base = name.split("/").pop() ?? name;
    await writeFile(join(outDir, base), data);
    console.log(`  ✓ ${join(outDir, base)}  ${formatBytes(data.byteLength)}  (${mapOfEntry(name)})`);
  }
  if (!names.some((n) => mapOfEntry(n) === "NormalGL")) console.warn("⚠ NormalGL 맵이 없습니다.");

  const credit = creditFor(asset);
  const result = await upsertCredit(credit);
  console.log(`credits.json ${result === "added" ? "추가" : "갱신"}: ${credit.file} — ${credit.author} (${credit.license})`);
  console.log(`다음: node tools/pack_orm.mjs --dir ${outDir} --out public/assets/textures/${asset.assetId}/${asset.assetId}_orm.png`);
} catch (err) {
  exitWithError(err);
}
