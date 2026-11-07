// @ts-check
/**
 * ORM 패킹: R = AO, G = Roughness, B = Metallic (glTF occlusion/metallicRoughness 규약과 같음).
 * 없는 채널은 기본값으로 채운다 — AO 1(흰색, 가림 없음), Roughness 1(완전 거침), Metallic 0(비금속).
 */
import sharp from "sharp";

export const ORM_DEFAULTS = /** @type {const} */ ({ ao: 255, roughness: 255, metallic: 0 });
/** @typedef {"ao" | "roughness" | "metallic"} OrmChannel */
export const ORM_CHANNELS = /** @type {const} */ (["ao", "roughness", "metallic"]);

/** 파일명으로 채널 판별 (Poly Haven: _ao_/_rough_/_metal_, ambientCG: _AmbientOcclusion/_Roughness/_Metalness) */
const PATTERNS = /** @type {Record<OrmChannel, RegExp>} */ ({
  ao: /(^|[_\-. ])(ao|ambientocclusion|ambient_occlusion|occlusion)([_\-. ]|$)/i,
  roughness: /(^|[_\-. ])(rough|roughness)([_\-. ]|$)/i,
  metallic: /(^|[_\-. ])(metal|metallic|metalness)([_\-. ]|$)/i,
});
const IMAGE_EXT = /\.(jpe?g|png|tiff?|webp)$/i;
/** 이미 패킹된 맵(arm/orm)이나 다른 용도 파일은 후보에서 뺀다 */
const EXCLUDE = /(^|[_\-. ])(arm|orm|rma|mra|preview|thumb)([_\-. ]|$)/i;

/**
 * @param {readonly string[]} fileNames 폴더의 파일 이름들
 * @returns {Partial<Record<OrmChannel, string>>}
 */
export function detectOrmMaps(fileNames) {
  /** @type {Partial<Record<OrmChannel, string>>} */
  const out = {};
  for (const ch of ORM_CHANNELS) {
    const hits = fileNames.filter((f) => IMAGE_EXT.test(f) && !EXCLUDE.test(f.replace(IMAGE_EXT, "")) && PATTERNS[ch].test(f.replace(IMAGE_EXT, "")));
    if (hits.length > 1) throw new Error(`${ch} 후보가 여러 개입니다: ${hits.join(", ")} — --${ch}로 직접 지정하세요.`);
    if (hits[0]) out[ch] = hits[0];
  }
  return out;
}

/**
 * 채널별 8비트 버퍼(없으면 기본값)를 RGB로 섞는다.
 * @param {Partial<Record<OrmChannel, Uint8Array>>} channels 각 길이 = width*height
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
export function interleaveOrm(channels, width, height) {
  const n = width * height;
  const out = new Uint8Array(n * 3);
  ORM_CHANNELS.forEach((ch, c) => {
    const src = channels[ch];
    if (src && src.length !== n) throw new Error(`${ch} 크기가 맞지 않습니다 (${src.length} != ${n})`);
    for (let i = 0; i < n; i++) out[i * 3 + c] = src ? (src[i] ?? 0) : ORM_DEFAULTS[ch];
  });
  return out;
}

/**
 * @param {Partial<Record<OrmChannel, string>>} paths 채널별 이미지 경로
 * @param {string} outPath .png 권장 (무손실 — 이후 optimize.mjs가 KTX2로 압축)
 * @param {{ size?: number }} [opts] 지정하면 정사각형 size로, 아니면 입력 중 가장 큰 크기로 맞춘다
 * @returns {Promise<{ width: number, height: number, used: OrmChannel[] }>}
 */
export async function packOrm(paths, outPath, opts = {}) {
  const used = ORM_CHANNELS.filter((ch) => paths[ch]);
  if (used.length === 0) throw new Error("AO/Roughness/Metallic 중 하나 이상이 필요합니다.");
  let width = opts.size ?? 0;
  let height = opts.size ?? 0;
  if (!opts.size) {
    for (const ch of used) {
      const m = await sharp(/** @type {string} */ (paths[ch])).metadata();
      width = Math.max(width, m.width ?? 0);
      height = Math.max(height, m.height ?? 0);
    }
  }
  if (!width || !height) throw new Error("이미지 크기를 알 수 없습니다.");
  /** @type {Partial<Record<OrmChannel, Uint8Array>>} */
  const channels = {};
  for (const ch of used) {
    // 첫 채널(회색조 맵이면 그 값)만 8비트로 읽는다. 크기가 다르면 맞춘다.
    const buf = await sharp(/** @type {string} */ (paths[ch]))
      .resize(width, height, { fit: "fill" })
      .extractChannel(0)
      .raw({ depth: "uchar" })
      .toBuffer();
    channels[ch] = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const rgb = interleaveOrm(channels, width, height);
  await sharp(rgb, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 9 }).toFile(outPath);
  return { width, height, used };
}
