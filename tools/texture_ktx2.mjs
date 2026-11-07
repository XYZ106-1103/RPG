#!/usr/bin/env node
// @ts-check
/**
 * 원본 텍스처 폴더 → 역할별 KTX2 (지형/소품 재질용 낱장 텍스처. GLB 안 텍스처는 optimize.mjs가 처리한다).
 *
 * 사용:
 *   node tools/texture_ktx2.mjs <원본 폴더> <출력 폴더> --name <재질명> [--max 2048] [--rdo 1] [--etc1s-quality 128] [--uastc-level 2]
 * 예:
 *   node tools/texture_ktx2.mjs raw/textures/terrain_ash public/assets/textures/terrain_ash --name terrain_ash
 *
 * 역할 판별 (파일명): 컬러(_diff/_Color) → <이름>_albedo.ktx2 (ETC1S sRGB)
 *                     OpenGL 노멀(_nor_gl/_NormalGL) → <이름>_normal.ktx2 (UASTC 노멀)
 *                     ORM(_arm/_orm) → <이름>_orm.ktx2 (UASTC 선형)
 *                     높이(_disp/_Displacement) → <이름>_height.ktx2 (UASTC 선형)
 * ORM이 없고 AO/Roughness/Metallic이 따로 있으면 pack_orm과 같은 방식으로 패킹한 뒤 변환한다.
 * DirectX 노멀(_nor_dx/_NormalDX)과 그 밖의 맵은 건너뛴다.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { change, encodeImageKTX2, modeLabel } from "./lib/ktx2.mjs";
import { formatBytes } from "./lib/net.mjs";
import { ORM_CHANNELS, packOrm } from "./lib/orm.mjs";
import { ROLES, ROLE_MODE, outputName, planTextureSet } from "./lib/textureSet.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    max: { type: "string" },
    rdo: { type: "string" },
    "etc1s-quality": { type: "string" },
    "uastc-level": { type: "string" },
  },
});

const [srcDir, outDir] = positionals;
const name = values.name;
if (!srcDir || !outDir || !name || !/^[a-z0-9_]+$/i.test(name)) {
  console.error("사용: node tools/texture_ktx2.mjs <원본 폴더> <출력 폴더> --name <재질명> [--max 2048] [--rdo 1] [--etc1s-quality 128] [--uastc-level 2]");
  process.exit(2);
}

/** @param {string | undefined} v @param {string} flag @param {number} min @param {number} max */
function num(v, flag, min, max) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!(n >= min && n <= max)) throw new Error(`--${flag}는 ${min}~${max}이어야 합니다: ${v}`);
  return n;
}

/** @type {string | null} */
let tmp = null;
try {
  const max = num(values.max, "max", 4, 16384);
  /** @type {import("./lib/ktx2.mjs").KtxQuality} */
  const quality = {};
  const rdo = num(values.rdo, "rdo", 0, 10);
  const etc1s = num(values["etc1s-quality"], "etc1s-quality", 1, 255);
  const uastc = num(values["uastc-level"], "uastc-level", 0, 3);
  if (rdo !== undefined) quality.rdo = rdo;
  if (etc1s !== undefined) quality.etc1sQuality = etc1s;
  if (uastc !== undefined) quality.uastcLevel = uastc;

  const plan = planTextureSet(await readdir(srcDir));
  /** @type {Partial<Record<import("./lib/textureSet.mjs").TextureRole, string>>} */
  const inputs = {};
  for (const role of ROLES) if (plan.files[role]) inputs[role] = join(srcDir, /** @type {string} */ (plan.files[role]));
  if (!inputs.orm && Object.keys(plan.separateOrm).length) {
    tmp = await mkdtemp(join(tmpdir(), "orm-"));
    /** @type {Partial<Record<import("./lib/orm.mjs").OrmChannel, string>>} */
    const paths = {};
    for (const ch of ORM_CHANNELS) if (plan.separateOrm[ch]) paths[ch] = join(srcDir, /** @type {string} */ (plan.separateOrm[ch]));
    inputs.orm = join(tmp, "orm.png");
    const r = await packOrm(paths, inputs.orm);
    console.log(`  ORM 패킹: ${r.used.join(", ")} (나머지 기본값) ${r.width}x${r.height}`);
  }
  if (!inputs.albedo) console.warn("⚠ 컬러(albedo) 맵이 없습니다.");
  if (!inputs.normal) console.warn("⚠ OpenGL 노멀 맵이 없습니다.");
  if (plan.skipped.length) console.log(`  건너뜀: ${plan.skipped.join(", ")}`);

  await mkdir(outDir, { recursive: true });
  let before = 0;
  let after = 0;
  let gpuBefore = 0;
  let gpuAfter = 0;
  console.log(`${srcDir} → ${outDir}/`);
  for (const role of ROLES) {
    const input = inputs[role];
    if (!input) continue;
    const mode = ROLE_MODE[role];
    const image = new Uint8Array(await readFile(input));
    const r = await encodeImageKTX2(image, mode, max ? { max, quality } : { quality });
    const out = join(outDir, outputName(name, role));
    await writeFile(out, r.ktx);
    before += image.byteLength;
    after += r.ktx.byteLength;
    gpuBefore += r.gpuBefore;
    gpuAfter += r.gpuAfter;
    console.log(
      `  ✓ ${outputName(name, role).padEnd(32)} ${modeLabel(mode).padEnd(10)} ${`${r.width}x${r.height}`.padEnd(9)} 파일 ${formatBytes(image.byteLength)} → ${formatBytes(r.ktx.byteLength)} (${change(image.byteLength, r.ktx.byteLength)})  GPU ${formatBytes(r.gpuBefore)} → ${formatBytes(r.gpuAfter)}`,
    );
  }
  console.log(`  합계  파일 ${formatBytes(before)} → ${formatBytes(after)} (${change(before, after)})  GPU ${formatBytes(gpuBefore)} → ${formatBytes(gpuAfter)} (${change(gpuBefore, gpuAfter)})`);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  if (tmp) await rm(tmp, { recursive: true, force: true });
}
