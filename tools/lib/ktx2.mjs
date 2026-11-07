// @ts-check
/**
 * 이미지 한 장 → KTX2 (ktx2-encoder: Basis Universal WASM). optimize.mjs와 texture_ktx2.mjs가 함께 쓴다.
 */
import { encodeToKTX2 } from "ktx2-encoder";
import sharp from "sharp";
import { encodeOptionsFor, gpuBytes } from "./textureMode.mjs";

/** sharp로 RGBA 디코딩 (ktx2-encoder가 Node에서 요구) */
export async function decodeRGBA(/** @type {Uint8Array} */ buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

/**
 * Basis 인코더(WASM)는 진행 로그를 표준 출력에 직접 찍는다 — 인코딩하는 동안만 막는다.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function quiet(fn) {
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

/**
 * @typedef {{ etc1sQuality?: number, uastcLevel?: number, rdo?: number }} KtxQuality
 * @typedef {{ ktx: Uint8Array, width: number, height: number, gpuBefore: number, gpuAfter: number }} KtxResult
 */

/**
 * @param {Uint8Array} image PNG/JPEG/WebP 등 sharp가 읽을 수 있는 이미지
 * @param {import("./textureMode.mjs").TextureMode} mode
 * @param {{ max?: number, quality?: KtxQuality }} [opts] max: 긴 변 상한 (넘으면 비율 유지 축소)
 * @returns {Promise<KtxResult>}
 */
export async function encodeImageKTX2(image, mode, opts = {}) {
  const meta = await sharp(image).metadata();
  let width = meta.width ?? 0;
  let height = meta.height ?? 0;
  const gpuBefore = gpuBytes(width, height, "raw");
  let src = image;
  if (opts.max && Math.max(width, height) > opts.max) {
    const resized = await sharp(image).resize(opts.max, opts.max, { fit: "inside", kernel: "lanczos3" }).png().toBuffer({ resolveWithObject: true });
    src = new Uint8Array(resized.data.buffer, resized.data.byteOffset, resized.data.byteLength);
    width = resized.info.width;
    height = resized.info.height;
  }
  const ktx = await quiet(() => encodeToKTX2(src, { ...encodeOptionsFor(mode, opts.quality ?? {}), imageDecoder: decodeRGBA }));
  return { ktx, width, height, gpuBefore, gpuAfter: gpuBytes(width, height, mode, meta.hasAlpha ?? false) };
}

/** 증감률 표기 (+12% / -75%) */
export function change(/** @type {number} */ before, /** @type {number} */ after) {
  if (!before) return "";
  const pct = (after / before - 1) * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

/** @param {import("./textureMode.mjs").TextureMode} mode */
export function modeLabel(mode) {
  return mode === "color" ? "ETC1S sRGB" : mode === "dataCompact" ? "ETC1S 선형" : mode === "normal" ? "UASTC 노멀" : "UASTC 선형";
}
