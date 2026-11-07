#!/usr/bin/env node
// @ts-check
/**
 * AO / Roughness / Metallic → ORM 한 장 (R=AO, G=Roughness, B=Metallic). CLAUDE.md: 텍스처 수를 줄이기 위해 패킹한다.
 *
 * 사용:
 *   node tools/pack_orm.mjs --dir raw/textures/Ground054 --out public/assets/textures/Ground054/Ground054_orm.png
 *   node tools/pack_orm.mjs --ao a.jpg --roughness r.jpg [--metallic m.jpg] --out orm.png [--size 2048]
 *
 * --dir: 파일명으로 채널을 찾는다 (_ao/_AmbientOcclusion, _rough/_Roughness, _metal/_Metalness)
 * 없는 채널은 기본값: AO=1(흰색), Roughness=1, Metallic=0
 * 크기가 다르면 가장 큰 크기로 맞춘다 (--size로 지정 가능)
 * 참고: Poly Haven의 arm 맵은 이미 같은 배치(ORM)라 패킹할 필요가 없다.
 */
import { mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { ORM_CHANNELS, ORM_DEFAULTS, detectOrmMaps, packOrm } from "./lib/orm.mjs";
import { formatBytes } from "./lib/net.mjs";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    ao: { type: "string" },
    roughness: { type: "string" },
    metallic: { type: "string" },
    out: { type: "string" },
    size: { type: "string" },
  },
});

if (!values.out || (!values.dir && !values.ao && !values.roughness && !values.metallic)) {
  console.error("사용: node tools/pack_orm.mjs (--dir <폴더> | --ao <파일> --roughness <파일> --metallic <파일>) --out <출력.png> [--size 2048]");
  process.exit(2);
}

try {
  /** @type {Partial<Record<import("./lib/orm.mjs").OrmChannel, string>>} */
  const paths = {};
  if (values.dir) {
    const found = detectOrmMaps(await readdir(values.dir));
    for (const ch of ORM_CHANNELS) if (found[ch]) paths[ch] = join(values.dir, /** @type {string} */ (found[ch]));
  }
  if (values.ao) paths.ao = values.ao;
  if (values.roughness) paths.roughness = values.roughness;
  if (values.metallic) paths.metallic = values.metallic;

  for (const ch of ORM_CHANNELS) console.log(`  ${ch.padEnd(9)} ${paths[ch] ?? `(없음 → 기본값 ${ORM_DEFAULTS[ch]})`}`);
  const size = values.size ? Number(values.size) : undefined;
  if (size !== undefined && !(size > 0)) throw new Error(`--size가 올바르지 않습니다: ${values.size}`);
  await mkdir(dirname(values.out), { recursive: true });
  const r = await packOrm(paths, values.out, size ? { size } : {});
  console.log(`✓ ${values.out}  ${r.width}x${r.height}  ${formatBytes((await stat(values.out)).size)}  (R=AO, G=Roughness, B=Metallic)`);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
