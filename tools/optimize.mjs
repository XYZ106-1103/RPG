#!/usr/bin/env node
// @ts-check
/**
 * glTF/GLB 최적화: KTX2 텍스처 + meshopt 압축 (CLAUDE.md: 모든 GLB는 이 스크립트를 거친 뒤 public/assets/에 넣는다).
 *
 * 사용:
 *   node tools/optimize.mjs <입력.glb|.gltf> <출력.glb> [--max 2048] [--etc1s-quality 128] [--uastc-level 2] [--rdo 1] [--no-ktx2] [--no-meshopt]
 *
 * 처리 순서: dedup(중복 제거) → prune(미사용 제거) → resample(애니메이션 키 정리) → [텍스처 리사이즈] → KTX2 → meshopt
 * 텍스처 방식 (쓰임새로 판별, lib/textureMode.mjs):
 *   노멀 → UASTC(노멀맵 모드, zstd), 베이스컬러/이미시브 → ETC1S(sRGB), ORM 등 데이터 → UASTC(선형, zstd)
 * --rdo: UASTC RDO 강도 (기본 1, 0이면 끔) — 클수록 작아지고 화질이 떨어진다
 * 참고: UASTC는 디스크 용량이 JPG보다 클 수 있지만 GPU 메모리는 원본(RGBA)의 1/4 수준이다 (표의 GPU 열).
 * --max: 텍스처 긴 변 상한 (CLAUDE.md 예산: 플레이어/일반 적 2K, 소품 1K)
 * 출력: 전/후 용량, 텍스처별 방식·크기, 메시/애니메이션 요약
 *
 * KTX2 인코더는 ktx2-encoder(Basis Universal WASM, MIT)를 쓴다 — KTX-Software 설치가 필요 없다.
 */
import { readFile, stat, mkdir } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { parseArgs } from "node:util";
import { Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureBasisu } from "@gltf-transform/extensions";
import { dedup, getSceneVertexCount, listTextureSlots, meshopt, prune, resample, VertexCountMethod } from "@gltf-transform/functions";
import { encodeToKTX2 } from "ktx2-encoder";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { formatBytes } from "./lib/net.mjs";
import { classifyTexture, encodeOptionsFor, gpuBytes } from "./lib/textureMode.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    max: { type: "string" },
    "etc1s-quality": { type: "string" },
    "uastc-level": { type: "string" },
    rdo: { type: "string" },
    "no-ktx2": { type: "boolean", default: false },
    "no-meshopt": { type: "boolean", default: false },
  },
});

const [input, output] = positionals;
if (!input || !output || extname(output).toLowerCase() !== ".glb") {
  console.error("사용: node tools/optimize.mjs <입력.glb|.gltf> <출력.glb> [--max 2048] [--etc1s-quality 128] [--uastc-level 2] [--rdo 1] [--no-ktx2] [--no-meshopt]");
  process.exit(2);
}

/** @param {string | undefined} v @param {string} name @param {number} min @param {number} max */
function intArg(v, name, min, max) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name}는 ${min}~${max} 정수여야 합니다: ${v}`);
  return n;
}

/** sharp로 RGBA 디코딩 (ktx2-encoder가 Node에서 요구) */
async function decodeRGBA(/** @type {Uint8Array} */ buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

/**
 * Basis 인코더(WASM)는 진행 로그를 표준 출력에 직접 찍는다 — 인코딩하는 동안만 막는다.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function quiet(fn) {
  const write = process.stdout.write;
  const log = console.log;
  process.stdout.write = /** @type {typeof process.stdout.write} */ (() => true);
  console.log = () => {};
  try {
    return await fn();
  } finally {
    process.stdout.write = write;
    console.log = log;
  }
}

/** @param {number} before @param {number} after */
function change(before, after) {
  if (!before) return "";
  const pct = (after / before - 1) * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

/** 입력 전체 용량 (.gltf면 외부 버퍼/이미지 포함) */
async function inputBytes(/** @type {NodeIO} */ io, /** @type {string} */ path) {
  if (extname(path).toLowerCase() === ".glb") return (await stat(path)).size;
  const json = await io.readAsJSON(path);
  return Buffer.byteLength(await readFile(path)) + Object.values(json.resources).reduce((s, r) => s + r.byteLength, 0);
}

try {
  const max = intArg(values.max, "max", 4, 16384);
  const etc1sQuality = intArg(values["etc1s-quality"], "etc1s-quality", 1, 255);
  const uastcLevel = intArg(values["uastc-level"], "uastc-level", 0, 3);
  const rdo = values.rdo === undefined ? undefined : Number(values.rdo);
  if (rdo !== undefined && !(rdo >= 0 && rdo <= 10)) throw new Error(`--rdo는 0~10이어야 합니다: ${values.rdo}`);
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

  const t0 = performance.now();
  const before = await inputBytes(io, input);
  const doc = await io.read(input);
  doc.setLogger(new Logger(Logger.Verbosity.WARN));
  await doc.transform(dedup(), prune(), resample());

  /** @type {{ name: string, slots: string, mode: string, size: string, before: number, after: number, gpuBefore: number, gpuAfter: number }[]} */
  const rows = [];
  if (!values["no-ktx2"]) {
    let any = false;
    const textures = doc.getRoot().listTextures();
    for (const [i, tex] of textures.entries()) {
      const name = tex.getName() || tex.getURI() || `#${i}`;
      const slots = listTextureSlots(tex);
      const image = tex.getImage();
      if (!image) continue;
      const mime = tex.getMimeType();
      if (mime === "image/ktx2") {
        rows.push({ name, slots: slots.join(","), mode: "(이미 KTX2)", size: "-", before: image.byteLength, after: image.byteLength, gpuBefore: 0, gpuAfter: 0 });
        continue;
      }
      const { mode, conflict } = classifyTexture(slots);
      if (conflict) console.warn(`⚠ ${name}: 여러 용도로 공유됨 [${slots.join(", ")}] → ${mode}로 압축`);
      let src = image;
      const meta = await sharp(image).metadata();
      let w = meta.width ?? 0;
      let h = meta.height ?? 0;
      const gpuBefore = gpuBytes(w, h, "raw");
      if (max && Math.max(w, h) > max) {
        const resized = await sharp(image).resize(max, max, { fit: "inside", kernel: "lanczos3" }).png().toBuffer({ resolveWithObject: true });
        src = new Uint8Array(resized.data.buffer, resized.data.byteOffset, resized.data.byteLength);
        w = resized.info.width;
        h = resized.info.height;
      }
      /** @type {Record<string, unknown>} */
      const q = {};
      if (etc1sQuality !== undefined) q.etc1sQuality = etc1sQuality;
      if (uastcLevel !== undefined) q.uastcLevel = uastcLevel;
      if (rdo !== undefined) q.rdo = rdo;
      process.stdout.write(`  KTX2 ${name} (${mode}) ... `);
      const ktx = await quiet(() => encodeToKTX2(src, { ...encodeOptionsFor(mode, q), imageDecoder: decodeRGBA }));
      process.stdout.write("완료\n");
      tex.setImage(ktx).setMimeType("image/ktx2");
      if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.(png|jpe?g|webp)$/i, ".ktx2"));
      any = true;
      const label = mode === "color" ? "ETC1S sRGB" : mode === "normal" ? "UASTC 노멀" : "UASTC 선형";
      rows.push({ name, slots: slots.join(","), mode: label, size: `${w}x${h}`, before: image.byteLength, after: ktx.byteLength, gpuBefore, gpuAfter: gpuBytes(w, h, mode, meta.hasAlpha ?? false) });
    }
    if (any) doc.createExtension(KHRTextureBasisu).setRequired(true);
  }
  if (!values["no-meshopt"]) await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));

  await mkdir(dirname(output), { recursive: true });
  await io.write(output, doc);
  const after = (await stat(output)).size;

  // 결과 확인: 다시 읽어서 요약 (meshopt 디코딩까지 되는지)
  const check = await io.read(output);
  const root = check.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const verts = scene ? getSceneVertexCount(scene, VertexCountMethod.RENDER) : 0;

  console.log(`\n${input} → ${output}  (${((performance.now() - t0) / 1000).toFixed(1)}초)`);
  if (rows.length) {
    console.log("\n텍스처 (파일 용량 / GPU 메모리 추정)");
    for (const r of rows) {
      const name = r.name.length > 28 ? `${r.name.slice(0, 27)}…` : r.name.padEnd(28);
      const gpu = r.gpuBefore ? `  GPU ${formatBytes(r.gpuBefore)} → ${formatBytes(r.gpuAfter)} (${change(r.gpuBefore, r.gpuAfter)})` : "";
      console.log(`  ${name} ${r.mode.padEnd(10)} ${r.size.padEnd(9)} 파일 ${formatBytes(r.before)} → ${formatBytes(r.after)} (${change(r.before, r.after)})${gpu}  [${r.slots || "슬롯 없음"}]`);
    }
  }
  console.log(`\n메시 ${root.listMeshes().length}개, 렌더 정점 ${verts.toLocaleString()}개, 재질 ${root.listMaterials().length}개, 텍스처 ${root.listTextures().length}개`);
  const anims = root.listAnimations();
  if (anims.length) {
    console.log(`애니메이션 ${anims.length}개`);
    for (const a of anims) {
      let end = 0;
      for (const s of a.listSamplers()) end = Math.max(end, s.getInput()?.getMax([0])[0] ?? 0);
      console.log(`  - ${a.getName() || "(이름 없음)"}  ${end.toFixed(2)}초`);
    }
  }
  console.log(`확장: ${root.listExtensionsUsed().map((e) => e.extensionName).join(", ") || "없음"}`);
  console.log(`\n용량  ${formatBytes(before)} → ${formatBytes(after)}  (${change(before, after)})`);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
}
