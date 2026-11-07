// @ts-check
/**
 * Poly Haven API 응답 해석 (네트워크 없음 — 단위 테스트 대상).
 * API: https://api.polyhaven.com/info/<id>, https://api.polyhaven.com/files/<id>
 *  - info.type: 0 = HDRI, 1 = 텍스처, 2 = 모델
 *  - files: { <맵>: { <해상도>: { <포맷>: { url, size, md5, include? } } } }
 */

export const POLYHAVEN_API = "https://api.polyhaven.com";

/** @typedef {"hdri" | "texture" | "model"} PolyhavenKind */
/** @typedef {{ url: string, size?: number, md5?: string, include?: Record<string, { url: string, size?: number, md5?: string }> }} PolyhavenFile */
/** @typedef {{ name: string, url: string, size: number, md5: string }} SelectedFile */

/** CLAUDE.md 해상도 기준: 지면/일반 재질 2K, HDRI 2K(개발용), 소품(모델) 텍스처 예산 1K */
export const DEFAULT_RES = /** @type {const} */ ({ texture: "2k", hdri: "2k", model: "1k" });
export const DEFAULT_FORMAT = /** @type {const} */ ({ texture: "jpg", hdri: "hdr", model: "gltf" });
/** 기본 맵: 컬러, OpenGL 노멀, ARM(R=AO, G=Roughness, B=Metallic — 이미 ORM 배치) */
export const DEFAULT_MAPS = ["Diffuse", "nor_gl", "arm"];

/** 짧은 이름 → API 맵 키 (대소문자 무시로도 찾는다) */
const MAP_ALIASES = /** @type {Record<string, string>} */ ({
  diff: "Diffuse",
  diffuse: "Diffuse",
  color: "Diffuse",
  normal: "nor_gl",
  nor: "nor_gl",
  rough: "Rough",
  roughness: "Rough",
  metal: "Metal",
  metallic: "Metal",
  disp: "Displacement",
  height: "Displacement",
  ao: "AO",
  orm: "arm",
});

/** 파일명에 쓰는 맵 접미사 (Poly Haven 원본 파일명 규칙과 같게) */
const MAP_SUFFIX = /** @type {Record<string, string>} */ ({ Diffuse: "diff", Rough: "rough", Metal: "metal", Displacement: "disp", AO: "ao", Mask: "mask" });

/**
 * @param {unknown} type info.type
 * @returns {PolyhavenKind}
 */
export function kindFromType(type) {
  if (type === 0) return "hdri";
  if (type === 1) return "texture";
  if (type === 2) return "model";
  throw new Error(`알 수 없는 Poly Haven 에셋 종류: ${String(type)}`);
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * @param {Record<string, unknown>} files
 * @param {string} wanted
 */
function resolveMapKey(files, wanted) {
  const alias = MAP_ALIASES[wanted.toLowerCase()] ?? wanted;
  if (alias in files) return alias;
  const lower = alias.toLowerCase();
  return Object.keys(files).find((k) => k.toLowerCase() === lower) ?? null;
}

/**
 * @param {unknown} node files[map]
 * @param {string} res
 * @param {string} format
 * @param {string} label
 * @returns {PolyhavenFile}
 */
function pick(node, res, format, label) {
  if (!isRecord(node)) throw new Error(`${label}: 파일 정보가 없습니다.`);
  const byRes = node[res];
  if (!isRecord(byRes)) throw new Error(`${label}: 해상도 ${res}가 없습니다. 가능한 해상도: ${Object.keys(node).sort(byResolution).join(", ")}`);
  const file = byRes[format];
  if (!isRecord(file) || typeof file.url !== "string") throw new Error(`${label}: ${res}에 ${format} 포맷이 없습니다. 가능한 포맷: ${Object.keys(byRes).join(", ")}`);
  return /** @type {PolyhavenFile} */ (file);
}

/** "1k" < "2k" < "16k" 정렬 */
function byResolution(/** @type {string} */ a, /** @type {string} */ b) {
  return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0);
}

/**
 * 받을 파일 목록을 고른다. 요청한 해상도/맵/포맷이 없으면 가능한 값을 알려 주는 예외.
 * @param {string} id
 * @param {PolyhavenKind} kind
 * @param {unknown} files /files 응답
 * @param {{ res?: string, maps?: string[], format?: string }} [opts]
 * @returns {SelectedFile[]}
 */
export function selectFiles(id, kind, files, opts = {}) {
  if (!isRecord(files)) throw new Error("Poly Haven files 응답 형식이 올바르지 않습니다.");
  const res = (opts.res ?? DEFAULT_RES[kind]).toLowerCase();
  const format = opts.format ?? DEFAULT_FORMAT[kind];
  /** @param {PolyhavenFile} f @param {string} name */
  const sel = (f, name) => ({ name, url: f.url, size: f.size ?? 0, md5: f.md5 ?? "" });

  if (kind === "hdri") {
    const f = pick(files.hdri, res, format, "HDRI");
    return [sel(f, `${id}_${res}.${format}`)];
  }
  if (kind === "model") {
    const f = pick(files[format], res, format, `모델(${format})`);
    const out = [sel(f, `${id}_${res}.${format}`)];
    for (const [rel, inc] of Object.entries(f.include ?? {})) out.push(sel(inc, rel));
    return out;
  }
  const maps = opts.maps ?? DEFAULT_MAPS;
  return maps.map((m) => {
    const key = resolveMapKey(files, m);
    if (!key) {
      const available = Object.keys(files).filter((k) => isRecord(files[k]) && Object.values(/** @type {Record<string, unknown>} */ (files[k])).some((r) => isRecord(r) && format in r));
      throw new Error(`맵 '${m}'를 찾을 수 없습니다. 가능한 맵: ${available.join(", ")}`);
    }
    const f = pick(files[key], res, format, `맵 ${key}`);
    return sel(f, `${id}_${MAP_SUFFIX[key] ?? key}_${res}.${format}`);
  });
}

/**
 * credits 항목. file은 최종 위치 패턴 (credits.mjs 참고).
 * @param {string} id
 * @param {PolyhavenKind} kind
 * @param {unknown} info /info 응답
 * @returns {import("./credits.mjs").CreditEntry}
 */
export function creditFor(id, kind, info) {
  const authors = isRecord(info) && isRecord(info.authors) ? Object.keys(info.authors) : [];
  const file = kind === "texture" ? `textures/${id}/*` : kind === "hdri" ? `hdri/${id}*` : `props/${id}*`;
  return { file, source: "Poly Haven", url: `https://polyhaven.com/a/${id}`, author: authors.join(", ") || "Poly Haven", license: "CC0" };
}

/**
 * 원본 저장 폴더 (CLAUDE.md: raw/textures/ 외부 텍스처, raw/models/<이름>/ 모델)
 * @param {string} id
 * @param {PolyhavenKind} kind
 */
export function rawDirFor(id, kind) {
  return kind === "model" ? `raw/models/${id}` : `raw/textures/${id}`;
}
