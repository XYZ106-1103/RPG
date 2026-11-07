// @ts-check
/**
 * public/assets/credits.json 읽기/쓰기/검사.
 *
 * 항목 형식 (CLAUDE.md): { "file", "source", "url", "author", "license" }
 *  - file은 public/assets/ 기준 경로 또는 패턴. "*"는 경로 구분자(/)를 넘지 않는 임의 문자열, "**"는 하위 폴더까지.
 *    다운로드 도구는 원본(raw/) 대신 최종 위치 패턴을 기록한다 (예: "textures/rocky_terrain_02/*").
 *    그래서 이후 ORM 패킹·최적화로 만든 파일을 그 폴더에 넣으면 자동으로 기록된 것으로 인정된다.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const ASSETS_DIR = "public/assets";
export const CREDITS_PATH = `${ASSETS_DIR}/credits.json`;
export const REQUIRED_FIELDS = /** @type {const} */ (["file", "source", "url", "author", "license"]);

/**
 * @typedef {{ file: string, source: string, url: string, author: string, license: string }} CreditEntry
 */

/**
 * @param {string} [path]
 * @returns {Promise<unknown[]>}
 */
export async function readCredits(path = CREDITS_PATH) {
  const raw = await readFile(path, "utf8");
  const data = /** @type {unknown} */ (JSON.parse(raw));
  if (!Array.isArray(data)) throw new Error(`${path}는 배열이어야 합니다.`);
  return data;
}

/**
 * file이 같은 항목은 교체, 없으면 추가하고 file 순으로 정렬해 저장한다.
 * @param {CreditEntry} entry
 * @param {string} [path]
 * @returns {Promise<"added" | "updated">}
 */
export async function upsertCredit(entry, path = CREDITS_PATH) {
  const entries = await readCredits(path);
  const result = upsertInto(entries, entry);
  await writeFile(path, JSON.stringify(entries, null, 2) + "\n");
  return result;
}

/**
 * @param {unknown[]} entries
 * @param {CreditEntry} entry
 * @returns {"added" | "updated"}
 */
export function upsertInto(entries, entry) {
  const missing = validateEntry(entry);
  if (missing.length) throw new Error(`credits 항목에 빈 필드가 있습니다: ${missing.join(", ")}`);
  const ordered = { file: entry.file, source: entry.source, url: entry.url, author: entry.author, license: entry.license };
  const i = entries.findIndex((e) => isObject(e) && e.file === entry.file);
  if (i >= 0) entries[i] = ordered;
  else entries.push(ordered);
  entries.sort((a, b) => String(isObject(a) ? a.file : "").localeCompare(String(isObject(b) ? b.file : "")));
  return i >= 0 ? "updated" : "added";
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 비었거나 문자열이 아닌 필수 필드 목록
 * @param {unknown} entry
 * @returns {string[]}
 */
export function validateEntry(entry) {
  if (!isObject(entry)) return [...REQUIRED_FIELDS];
  return REQUIRED_FIELDS.filter((k) => typeof entry[k] !== "string" || String(entry[k]).trim() === "");
}

/**
 * credits 패턴을 정규식으로 ("*" = 한 단계, "**" = 여러 단계)
 * @param {string} pattern
 */
export function patternToRegExp(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? "";
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // "**/" 는 0개 이상의 폴더, 끝의 "**"는 아무거나
        if (pattern[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * @param {string} pattern
 * @param {string} file public/assets 기준 경로 (/ 구분)
 */
export function matchesPattern(pattern, file) {
  return patternToRegExp(pattern).test(file);
}

/** 검사에서 제외하는 파일 (credits 자체, 빈 폴더 유지용) */
export function isIgnoredAssetFile(/** @type {string} */ rel) {
  const base = rel.split("/").pop() ?? rel;
  return rel === "credits.json" || base === ".gitkeep" || base === ".DS_Store" || base === "Thumbs.db";
}

/**
 * @typedef {{ uncredited: string[], invalid: { index: number, missing: string[] }[], unused: string[] }} CreditReport
 */

/**
 * @param {readonly string[]} files public/assets 기준 경로
 * @param {readonly unknown[]} entries
 * @returns {CreditReport}
 */
export function checkCredits(files, entries) {
  /** @type {CreditReport["invalid"]} */
  const invalid = [];
  /** @type {{ pattern: RegExp, file: string, used: boolean }[]} */
  const patterns = [];
  entries.forEach((e, index) => {
    const missing = validateEntry(e);
    if (missing.length) invalid.push({ index, missing });
    if (isObject(e) && typeof e.file === "string" && e.file.trim()) patterns.push({ pattern: patternToRegExp(e.file), file: e.file, used: false });
  });
  const uncredited = [];
  for (const f of files) {
    if (isIgnoredAssetFile(f)) continue;
    let ok = false;
    for (const p of patterns) {
      if (p.pattern.test(f)) {
        p.used = true;
        ok = true;
      }
    }
    if (!ok) uncredited.push(f);
  }
  return { uncredited, invalid, unused: patterns.filter((p) => !p.used).map((p) => p.file) };
}

/**
 * 폴더 아래 모든 파일 (상대 경로, / 구분)
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function listFiles(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const walk = async (dir) => {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (ent.isFile()) out.push(relative(root, p).split(sep).join("/"));
    }
  };
  await walk(root);
  return out.sort();
}
