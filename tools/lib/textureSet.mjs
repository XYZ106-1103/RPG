// @ts-check
/**
 * 원본 텍스처 폴더 → 역할별 파일 (albedo/normal/orm/height + 따로 있는 ao/roughness/metallic).
 * Poly Haven(_diff_/_nor_gl_/_arm_/_disp_)과 ambientCG(_Color/_NormalGL/_Roughness/...) 파일명 규칙을 안다.
 */
import { detectOrmMaps } from "./orm.mjs";

/** @typedef {"albedo" | "normal" | "orm" | "height"} TextureRole */

/** 역할 → KTX2 압축 방식 (textureMode.mjs) */
export const ROLE_MODE = /** @type {const} */ ({ albedo: "color", normal: "normal", orm: "data", height: "data" });
export const ROLES = /** @type {const} */ (["albedo", "normal", "orm", "height"]);

const IMAGE_EXT = /\.(jpe?g|png|tiff?|webp)$/i;
const PATTERNS = /** @type {Record<TextureRole, RegExp>} */ ({
  albedo: /(^|[_\-. ])(diff|diffuse|color|colour|albedo|basecolor|base_color)([_\-. ]|$)/i,
  normal: /(^|[_\-. ])(nor_gl|normalgl|normal_gl|normal)([_\-. ]|$)/i,
  orm: /(^|[_\-. ])(arm|orm)([_\-. ]|$)/i,
  height: /(^|[_\-. ])(disp|displacement|height)([_\-. ]|$)/i,
});
/** DirectX 노멀은 쓰지 않는다 (OpenGL 규격만 — CLAUDE.md) */
const NORMAL_DX = /(^|[_\-. ])(nor_dx|normaldx|normal_dx)([_\-. ]|$)/i;

/**
 * @typedef {{
 *   files: Partial<Record<TextureRole, string>>,
 *   separateOrm: Partial<Record<import("./orm.mjs").OrmChannel, string>>,
 *   skipped: string[],
 * }} TextureSetPlan
 */

/**
 * @param {readonly string[]} fileNames 폴더의 파일 이름들
 * @returns {TextureSetPlan}
 */
export function planTextureSet(fileNames) {
  /** @type {TextureSetPlan["files"]} */
  const files = {};
  const images = fileNames.filter((f) => IMAGE_EXT.test(f));
  const used = new Set();
  for (const role of ROLES) {
    const hits = images.filter((f) => {
      const stem = f.replace(IMAGE_EXT, "");
      if (role === "normal" && NORMAL_DX.test(stem)) return false;
      return PATTERNS[role].test(stem);
    });
    if (hits.length > 1) throw new Error(`${role} 후보가 여러 개입니다: ${hits.join(", ")}`);
    if (hits[0]) {
      files[role] = hits[0];
      used.add(hits[0]);
    }
  }
  /** @type {TextureSetPlan["separateOrm"]} */
  let separateOrm = {};
  if (!files.orm) {
    separateOrm = detectOrmMaps(images.filter((f) => !used.has(f)));
    for (const f of Object.values(separateOrm)) used.add(f);
  }
  return { files, separateOrm, skipped: images.filter((f) => !used.has(f)) };
}

/**
 * 출력 파일 이름: <이름>_<역할>.ktx2
 * @param {string} name
 * @param {TextureRole} role
 */
export function outputName(name, role) {
  return `${name}_${role}.ktx2`;
}
