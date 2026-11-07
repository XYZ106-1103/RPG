#!/usr/bin/env node
// @ts-check
/**
 * HDRI(.hdr 파노라마) → Babylon 환경맵(.env): 프리필터된 반사 큐브 + 조명(구면 조화) 데이터.
 * Babylon 공식 변환(EnvironmentTextureTools)은 WebGL이 필요해서 헤드리스 Chromium에서 돌린다.
 *
 * 사용:
 *   node tools/hdr_to_env.mjs <입력.hdr> <출력.env> [--size 512] [--webp] [--preview 미리보기.png]
 * 예:
 *   node tools/hdr_to_env.mjs raw/textures/night_overcast/kloppenheim_07_puresky_2k.hdr public/assets/hdri/night_overcast.env
 *
 * --size: 반사 큐브 한 면 크기 (기본 512, 개발용 — 최종은 1024 고려)
 * --webp: 큐브 면을 PNG 대신 WebP로 (작지만 화질 손실)
 * 필요: Playwright + Chromium (npm i -D playwright && npx playwright install chromium)
 * 변환 후 같은 페이지에서 .env를 다시 불러와 조명 데이터까지 확인한다.
 */
import { createRequire } from "node:module";
import { stat, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import { formatBytes } from "./lib/net.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { size: { type: "string", default: "512" }, webp: { type: "boolean", default: false }, preview: { type: "string" } },
});
const [input, output] = positionals;
const size = Number(values.size);
if (!input || !output || !/\.hdr$/i.test(input) || !/\.env$/i.test(output) || !Number.isInteger(Math.log2(size))) {
  console.error("사용: node tools/hdr_to_env.mjs <입력.hdr> <출력.env> [--size 512(2의 거듭제곱)] [--webp] [--preview 미리보기.png]");
  process.exit(2);
}

/**
 * 쓰는 부분만 정의한 Playwright 타입 (Playwright는 선택 의존성이라 타입 패키지에 기대지 않는다)
 * @typedef {{ type(): string, text(): string }} PwConsoleMessage
 * @typedef {{
 *   on(event: string, fn: (arg: never) => void): void,
 *   goto(url: string): Promise<unknown>,
 *   waitForFunction(fn: () => boolean, arg: null, opts: { timeout: number }): Promise<unknown>,
 *   evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>,
 *   waitForTimeout(ms: number): Promise<void>,
 *   screenshot(opts: { path: string }): Promise<unknown>,
 * }} PwPage
 * @typedef {{ newPage(opts?: object): Promise<PwPage>, close(): Promise<void> }} PwBrowser
 * @typedef {{ launch(opts?: object): Promise<PwBrowser> }} PwBrowserType
 * @typedef {{ base64: string, width: number, mipmaps: number, imageType: string, irradiance: boolean, avgRadiance: number[] }} EnvResult
 * @typedef {Window & { convertHdrToEnv(url: string, size: number, imageType: string): Promise<EnvResult> }} ConverterWindow
 */

const require = createRequire(import.meta.url);
/** @type {PwBrowserType} */
let chromium;
try {
  ({ chromium } = /** @type {{ chromium: PwBrowserType }} */ (require("playwright")));
} catch {
  console.error("playwright를 찾을 수 없습니다: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const hdrPath = resolve(input);
const server = await createServer({
  root: resolve(here, "env"),
  configFile: false,
  logLevel: "error",
  optimizeDeps: { noDiscovery: true },
  server: { port: 0, host: "127.0.0.1", fs: { allow: [resolve(here, ".."), dirname(hdrPath)] } },
});
await server.listen();
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  /** @type {string[]} */
  const errors = [];
  page.on("pageerror", (/** @type {Error} */ e) => errors.push(e.message));
  page.on("console", (/** @type {PwConsoleMessage} */ m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(server.resolvedUrls?.local[0] ?? "");
  await page.waitForFunction(() => "envReady" in window, null, { timeout: 60000 });
  const t0 = performance.now();
  /** @type {[string, number, string]} */
  const args = [`/@fs${hdrPath}`, size, values.webp ? "image/webp" : "image/png"];
  const r = await page.evaluate(([url, sz, type]) => /** @type {ConverterWindow} */ (/** @type {unknown} */ (window)).convertHdrToEnv(url, sz, type), args);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, Buffer.from(r.base64, "base64"));
  if (values.preview) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: values.preview });
  }
  const inSize = (await stat(input)).size;
  const outSize = (await stat(output)).size;
  console.log(`✓ ${input} → ${output}  (${((performance.now() - t0) / 1000).toFixed(1)}초)`);
  console.log(`  큐브 ${r.width}px, 밉맵 ${r.mipmaps}단계, ${r.imageType}, 조명 데이터 ${r.irradiance ? "있음" : "구면 조화만"}`);
  console.log(`  평균 조명(l00) R ${r.avgRadiance[0]?.toFixed(4)} G ${r.avgRadiance[1]?.toFixed(4)} B ${r.avgRadiance[2]?.toFixed(4)}`);
  console.log(`  용량 ${formatBytes(inSize)} → ${formatBytes(outSize)}  (다시 불러오기 확인 완료)`);
  if (errors.length) console.warn(`⚠ 페이지 경고/오류:\n  ${errors.join("\n  ")}`);
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
