/**
 * 후처리 파이프라인 스모크 검사 (Chromium + Vite 개발 서버, 소프트웨어 렌더링).
 *
 * 프리셋(Low~Ultra)마다 페이지를 열고 확인한다
 *  1. 페이지 오류 / WebGPU 검증 오류 없음
 *  2. 카메라에 붙은 후처리 패스가 CLAUDE.md 순서(SSAO → SSR → 볼류메트릭 → TAA → 모션 블러 → 블룸 → DOF → ACES+LUT → FXAA → 비네팅/그레인)
 *  3. 프리셋 런타임 변경(High → Low → Ultra) 뒤에도 순서 유지
 *  4. 화면이 검게 나오지 않음 (평균 밝기)
 *
 * 실행
 *   npm run e2e:postfx                 WebGL2
 *   xvfb-run -a npm run e2e:postfx -- --webgpu
 *       WebGPU (SwiftShader Vulkan — 헤드리스 모드는 WebGPU 캔버스 출력을 못 해서 가상 디스플레이 + 창 모드로 띄운다)
 */
import { createRequire } from "node:module";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("playwright를 찾을 수 없습니다: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

const webgpu = process.argv.includes("--webgpu");
const ORDER = ["ssao", "ssr", "volumetric", "taa", "motionBlur", "bloom", "dof", "imageProcessing", "fxaa", "sharpen", "finish"];
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(label);
};

const server = await createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls?.local[0];
const browser = await chromium.launch(
  webgpu
    ? { args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader", "--disable-vulkan-surface"], headless: false }
    : { args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] },
);

/** 페이지 안: 체인 상태 (효과 id 순서가 ORDER를 따르는지, 각 효과의 패스가 카메라 목록에서 연속·순서대로인지) */
const inspect = (page) =>
  page.evaluate(() => {
    const s = window.__ashenSession;
    const fx = s.gfx.postFx;
    const list = s.camera.camera._postProcesses.filter(Boolean);
    const groups = fx.passGroups();
    const idx = groups.map((g) => g.passes.map((p) => list.indexOf(p)));
    const flat = idx.flat();
    const ordered = flat.every((v, i) => v >= 0 && (i === 0 || v > flat[i - 1]));
    return { backend: fx.caps.backend, ids: groups.map((g) => g.id), ordered, total: list.length, covered: flat.length, describe: fx.describe() };
  });

/** 화면 평균 밝기 (0~255): 패널을 숨기고 스크린샷을 페이지 안에서 디코드해 평균 (WebGPU 캔버스는 직접 읽을 수 없다) */
const brightness = async (page) => {
  await page.evaluate(() => {
    for (const e of document.querySelectorAll("div,pre")) if (!e.querySelector("canvas")) e.style.visibility = "hidden";
  });
  const png = await page.screenshot();
  await page.evaluate(() => {
    for (const e of document.querySelectorAll("div,pre")) e.style.visibility = "";
  });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, 160, 90);
    const d = ctx.getImageData(0, 0, 160, 90).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return sum / (d.length / 4);
  }, png.toString("base64"));
};

const isOrdered = (ids) => ids.every((id, i) => i === 0 || ORDER.indexOf(id) > ORDER.indexOf(ids[i - 1]));

try {
  for (const level of ["low", "medium", "high", "ultra"]) {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      const t = m.text();
      if (/uncaptured error|Invalid RenderPipeline/.test(t)) errors.push(t.slice(0, 200));
    });
    await page.goto(`${url}?${webgpu ? "" : "engine=webgl2&"}quality=${level}`);
    await page.waitForFunction(() => window.__ashenSession, null, { timeout: 60000 });
    await page.waitForTimeout(webgpu ? 15000 : 8000);
    const r = await inspect(page);
    check(r.backend === (webgpu ? "WebGPU" : "WebGL2"), `${level}: 백엔드 ${r.backend}`);
    check(isOrdered(r.ids) && r.ordered && r.covered === r.total, `${level}: 순서 ${r.ids.join(" › ")}`, `패스 ${r.covered}/${r.total}`);
    check(r.ids.includes("imageProcessing") && r.ids.includes("finish") && (r.ids.includes("taa") || r.ids.includes("fxaa")), `${level}: 필수 효과(ACES+LUT, 마무리, 안티앨리어싱)`);
    const mean = await brightness(page);
    // 어두운 세계라 평균은 낮다 (정상 ≈ 13~22). 검게 깨진 화면(WebGPU 파이프라인 오류 등)은 ≈ 4 이하
    check(mean > 8, `${level}: 화면이 검지 않음`, `평균 밝기 ${mean.toFixed(1)}/255`);
    if (level === "high") {
      for (const next of ["low", "ultra", "high"]) {
        await page.evaluate((l) => window.__ashenSession.gfx.quality.setLevel(l), next);
        await page.waitForTimeout(3000);
        const r2 = await inspect(page);
        check(isOrdered(r2.ids) && r2.ordered && r2.covered === r2.total, `high → ${next}: 순서 유지 ${r2.ids.join(" › ")}`);
      }
    }
    check(errors.length === 0, `${level}: 오류 없음`, errors[0] ?? "");
    console.log(`   ${r.describe}`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`\n실패 ${failures.length}개: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\n모두 통과");
