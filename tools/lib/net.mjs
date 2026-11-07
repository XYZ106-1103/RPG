// @ts-check
/**
 * 다운로드 공용: 리다이렉트를 직접 따라가며 각 호스트를 확인하고,
 * 허용 목록(allowlist)에 막힌 호스트를 감지하면 HostBlockedError로 멈춘다.
 *
 * 막힘 감지 (클라우드 환경의 네트워크 정책):
 *  - HTTP 403 + 본문/헤더에 "allowlist"·"not allowed" (프록시 응답)
 *  - DNS 실패(ENOTFOUND/EAI_AGAIN), 연결 거부 — 이 환경에서 허용되지 않은 호스트는 DNS부터 실패한다
 *    (로컬 PC라면 오프라인이거나 주소 오타일 수도 있으므로 안내문에 둘 다 적는다)
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const EXIT_HOST_BLOCKED = 3;

export class HostBlockedError extends Error {
  /**
   * @param {string} host
   * @param {string} detail
   */
  constructor(host, detail) {
    super(`호스트에 접속할 수 없습니다: ${host} (${detail})`);
    this.name = "HostBlockedError";
    this.host = host;
  }
}

const NETWORK_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]);

/**
 * fetch 실패(예외)가 네트워크 수준 실패면 HostBlockedError로 바꾼다.
 * @param {unknown} err
 * @param {string} host
 * @returns {unknown}
 */
export function classifyFetchError(err, host) {
  const cause = err instanceof Error ? /** @type {{ code?: unknown }} */ (err.cause) : undefined;
  const code = cause && typeof cause === "object" && typeof cause.code === "string" ? cause.code : "";
  if (NETWORK_CODES.has(code)) return new HostBlockedError(host, code);
  return err;
}

/**
 * 403 응답이 네트워크 정책(프록시) 차단인가
 * @param {number} status
 * @param {string} body
 */
export function isPolicyBlock(status, body) {
  return status === 403 && /allowlist|not allowed|host not in|blocked by (the )?(egress|proxy)/i.test(body);
}

/**
 * 리다이렉트를 직접 따라가는 fetch. 최종 응답이 2xx가 아니면 예외.
 * @param {string} url
 * @param {{ maxRedirects?: number, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<Response>}
 */
export async function fetchChecked(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  let current = url;
  for (let hop = 0; hop <= (options.maxRedirects ?? 8); hop++) {
    const host = new URL(current).host;
    /** @type {Response} */
    let res;
    try {
      res = await fetchImpl(current, { redirect: "manual", headers: { "user-agent": "ashen-lantern-asset-tools" } });
    } catch (err) {
      throw classifyFetchError(err, host);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`리다이렉트에 location이 없습니다: ${current}`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (isPolicyBlock(res.status, body + " " + (res.headers.get("x-deny-reason") ?? ""))) throw new HostBlockedError(host, `HTTP ${res.status}`);
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${current}\n${body.slice(0, 300)}`);
    }
    return res;
  }
  throw new Error(`리다이렉트가 너무 많습니다: ${url}`);
}

/**
 * @param {string} url
 * @returns {Promise<unknown>}
 */
export async function fetchJson(url) {
  const res = await fetchChecked(url);
  return res.json();
}

/**
 * 파일로 내려받는다 (임시 파일에 쓰고 끝나면 이름을 바꾼다 — 중간에 끊겨도 깨진 파일이 남지 않게).
 * @param {string} url
 * @param {string} dest
 * @returns {Promise<number>} 바이트 수
 */
export async function downloadTo(url, dest) {
  const res = await fetchChecked(url);
  if (!res.body) throw new Error(`응답 본문이 없습니다: ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  let bytes = 0;
  const body = Readable.fromWeb(/** @type {import("node:stream/web").ReadableStream} */ (res.body));
  body.on("data", (/** @type {Buffer} */ chunk) => (bytes += chunk.length));
  try {
    await pipeline(body, createWriteStream(tmp));
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  await rename(tmp, dest);
  return bytes;
}

/**
 * CLI 공통 마무리: 허용 목록 차단이면 필요한 도메인을 알려 주고 코드 3으로 종료.
 * @param {unknown} err
 * @returns {never}
 */
export function exitWithError(err) {
  if (err instanceof HostBlockedError) {
    console.error(`\n✗ ${err.message}`);
    console.error("  클라우드 환경이라면 네트워크 허용 목록(Host not in allowlist)에 막힌 것입니다. 작업을 멈춥니다.");
    console.error(`  추가해야 할 도메인: ${err.host}`);
    console.error("  (로컬 PC라면 인터넷 연결이나 주소를 확인하세요.)");
    process.exit(EXIT_HOST_BLOCKED);
  }
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

/**
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
