// @ts-check
/**
 * 텍스처 쓰임새(머티리얼 슬롯) → KTX2 압축 방식.
 *  - normal: 노멀맵 → UASTC + 노멀맵 모드, 선형(linear)
 *  - color : 베이스컬러/이미시브 등 색 → ETC1S, sRGB
 *  - data  : ORM(AO/러프니스/메탈릭) 등 선형 데이터 → UASTC, 선형 (ETC1S는 러프니스 계조가 깨지기 쉽다)
 */

/** @typedef {"normal" | "color" | "data"} TextureMode */

const NORMAL_SLOTS = /normalTexture$/i; // normalTexture, clearcoatNormalTexture
const COLOR_SLOTS = /^(baseColorTexture|emissiveTexture|diffuseTexture|sheenColorTexture|specularColorTexture|specularGlossinessTexture)$/i;

/**
 * 한 텍스처가 여러 슬롯에 쓰이면 노멀 > 데이터 > 컬러 순으로 정한다
 * (색으로 압축하면 데이터가 sRGB로 왜곡되므로 선형 쪽을 우선).
 * @param {readonly string[]} slots gltf-transform listTextureSlots 결과
 * @returns {{ mode: TextureMode, conflict: boolean }}
 */
export function classifyTexture(slots) {
  const normal = slots.some((s) => NORMAL_SLOTS.test(s));
  const color = slots.some((s) => COLOR_SLOTS.test(s));
  const data = slots.some((s) => !NORMAL_SLOTS.test(s) && !COLOR_SLOTS.test(s));
  const kinds = Number(normal) + Number(color) + Number(data);
  const mode = normal ? "normal" : data ? "data" : color ? "color" : "data";
  return { mode, conflict: kinds > 1 };
}

/**
 * ktx2-encoder 옵션
 * @param {TextureMode} mode
 * @param {{ etc1sQuality?: number, uastcLevel?: number, rdo?: number }} [q] rdo: UASTC RDO 강도 (0 = 끔, 기본 1 — zstd 용량 25~35% 감소, 화질 손실 적음)
 */
export function encodeOptionsFor(mode, q = {}) {
  if (mode === "color") {
    return { isUASTC: false, qualityLevel: q.etc1sQuality ?? 128, compressionLevel: 2, isPerceptual: true, isSetKTX2SRGBTransferFunc: true, generateMipmap: true };
  }
  const rdo = q.rdo ?? 1;
  return {
    isUASTC: true,
    enableRDO: rdo > 0,
    ...(rdo > 0 ? { rdoQualityLevel: rdo } : {}),
    uastcLDRQualityLevel: q.uastcLevel ?? 2,
    needSupercompression: true, // zstd
    isNormalMap: mode === "normal",
    isPerceptual: false,
    isSetKTX2SRGBTransferFunc: false,
    generateMipmap: true,
  };
}

/**
 * GPU 메모리 추정 (밉맵 포함 4/3배). 원본: RGBA8 4바이트/픽셀.
 * KTX2 트랜스코딩 후: UASTC → BC7/ASTC 1바이트/픽셀, ETC1S → BC1/ETC1 0.5바이트/픽셀 (알파 있으면 1).
 * @param {number} width
 * @param {number} height
 * @param {TextureMode | "raw"} mode
 * @param {boolean} [alpha]
 */
export function gpuBytes(width, height, mode, alpha = false) {
  const bpp = mode === "raw" ? 4 : mode === "color" && !alpha ? 0.5 : 1;
  return Math.round((width * height * bpp * 4) / 3);
}
