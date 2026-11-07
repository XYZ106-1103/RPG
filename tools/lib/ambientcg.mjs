// @ts-check
/**
 * ambientCG API 응답/압축 파일 해석 (네트워크 없음 — 단위 테스트 대상).
 * API: https://ambientcg.com/api/v2/full_json?id=<ID>&include=downloadData
 * 다운로드: ambientcg.com/get?file=<ID>_2K-JPG.zip → acg-download.struffelproductions.com 으로 리다이렉트
 */

export const AMBIENTCG_API = "https://ambientcg.com/api/v2/full_json";
/** CLAUDE.md: ambientCG는 2K JPG 세트가 기본 */
export const DEFAULT_ATTRIBUTE = "2K-JPG";

/**
 * 압축 파일에서 꺼낼 맵. 노멀은 OpenGL 규격(NormalGL)만 — DirectX(NormalDX)와 미리보기, 재질 정의 파일은 버린다.
 * 뒤집혀 보이면 Babylon 재질의 invertNormalMapY로 조정한다 (CLAUDE.md).
 */
export const KEEP_MAPS = ["Color", "NormalGL", "Roughness", "AmbientOcclusion", "Metalness", "Displacement", "Opacity"];

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * @typedef {{ assetId: string, displayName: string, shortLink: string, downloads: { attribute: string, url: string, fileName: string, size: number }[] }} AmbientAsset
 */

/**
 * full_json 응답에서 에셋 하나를 꺼낸다.
 * @param {unknown} json
 * @param {string} id
 * @returns {AmbientAsset}
 */
export function parseAsset(json, id) {
  const found = isRecord(json) && Array.isArray(json.foundAssets) ? json.foundAssets : [];
  const asset = found.find((a) => isRecord(a) && typeof a.assetId === "string" && a.assetId.toLowerCase() === id.toLowerCase());
  if (!isRecord(asset)) throw new Error(`ambientCG에서 에셋을 찾을 수 없습니다: ${id}`);
  /** @type {AmbientAsset["downloads"]} */
  const downloads = [];
  const folders = isRecord(asset.downloadFolders) ? Object.values(asset.downloadFolders) : [];
  for (const folder of folders) {
    const cats = isRecord(folder) && isRecord(folder.downloadFiletypeCategories) ? Object.values(folder.downloadFiletypeCategories) : [];
    for (const cat of cats) {
      const list = isRecord(cat) && Array.isArray(cat.downloads) ? cat.downloads : [];
      for (const d of list) {
        if (!isRecord(d)) continue;
        const url = typeof d.fullDownloadPath === "string" ? d.fullDownloadPath : typeof d.downloadLink === "string" ? d.downloadLink : "";
        if (typeof d.attribute === "string" && url) downloads.push({ attribute: d.attribute, url, fileName: String(d.fileName ?? ""), size: typeof d.size === "number" ? d.size : 0 });
      }
    }
  }
  return {
    assetId: String(asset.assetId),
    displayName: typeof asset.displayName === "string" ? asset.displayName : String(asset.assetId),
    shortLink: typeof asset.shortLink === "string" ? asset.shortLink : `https://ambientcg.com/a/${String(asset.assetId)}`,
    downloads,
  };
}

/**
 * @param {AmbientAsset} asset
 * @param {string} attribute 예: "2K-JPG"
 */
export function pickDownload(asset, attribute = DEFAULT_ATTRIBUTE) {
  const d = asset.downloads.find((x) => x.attribute.toLowerCase() === attribute.toLowerCase());
  if (!d) throw new Error(`${asset.assetId}: ${attribute} 다운로드가 없습니다. 가능한 것: ${asset.downloads.map((x) => x.attribute).join(", ") || "없음"}`);
  return d;
}

/**
 * 압축 파일 안의 파일명이 꺼낼 맵이면 그 맵 이름 (예: Ground054_2K-JPG_NormalGL.jpg → "NormalGL")
 * @param {string} entryName
 * @returns {string | null}
 */
export function mapOfEntry(entryName) {
  const base = entryName.split("/").pop() ?? entryName;
  const m = /_([A-Za-z]+)\.(jpe?g|png|exr|tiff?)$/i.exec(base);
  if (!m) return null;
  const map = m[1] ?? "";
  return KEEP_MAPS.find((k) => k.toLowerCase() === map.toLowerCase()) ?? null;
}

/**
 * @param {AmbientAsset} asset
 * @returns {import("./credits.mjs").CreditEntry}
 */
export function creditFor(asset) {
  return {
    file: `textures/${asset.assetId}/*`,
    source: "ambientCG",
    url: asset.shortLink,
    author: "Lennart Demes (ambientCG)",
    license: "CC0",
  };
}
