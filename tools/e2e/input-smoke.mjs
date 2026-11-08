/**
 * 실제 마우스 입력 스모크 검사 (헤드리스 Chromium + Vite 개발 서버).
 *
 * 스크립트로 만든 MouseEvent(dispatchEvent)가 아니라 Playwright의 실제 마우스 입력을 쓴다.
 * 합성 이벤트로는 "Babylon이 pointerdown을 preventDefault해서 mousedown이 오지 않는" 류의 문제를 잡지 못한다.
 *
 * 검사 항목
 *  1. 첫 화면에 마우스 고정 안내가 보인다
 *  2. 화면 클릭 → 포인터 락이 걸리고 안내가 사라진다
 *  3. 고정에 쓴 그 클릭은 공격으로 나가지 않는다 (상태 idle 유지)
 *  4. 마우스 이동(pointermove의 movementX) → 카메라 yaw가 바뀐다 (헤드리스 한계로 이 항목만 합성 이벤트)
 *  5. 왼쪽 클릭 → 공격 상태가 된다
 *  6. 캐릭터 모델: 서 있을 때 idle, 공격할 때 공격 애니메이션이 실제로 본을 움직인다 (디버그 패널 "포즈 N°/s")
 *
 * 실행: npm run e2e:input   (Playwright와 Chromium이 필요: npm i -D playwright && npx playwright install chromium)
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

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(label);
};

const server = await createServer({ server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls?.local[0];
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const loopStarted = page.waitForEvent("console", { predicate: (m) => m.text().includes("[loop]"), timeout: 30000 });
  await page.goto(`${url}?engine=webgl2`);
  await loopStarted;
  await page.waitForTimeout(1500);

  const panelText = () => page.evaluate(() => [...document.querySelectorAll("div")].find((d) => d.textContent?.includes("스태미나"))?.textContent ?? "");
  const state = async () => /상태\s+(\S+)/.exec(await panelText())?.[1] ?? "?";
  const yaw = async () => Number(/카메라 (-?\d+)°/.exec(await panelText())?.[1] ?? NaN);
  /** 캐릭터 모델 척추 본의 실제 회전 속도 (도/초) — 모델이 없으면 NaN */
  const pose = async () => Number(/포즈 (\d+)°\/s/.exec(await panelText())?.[1] ?? NaN);
  const hintVisible = () => page.evaluate(() => [...document.querySelectorAll("div")].some((d) => d.textContent?.includes("마우스가 고정됩니다") && d.style.display !== "none"));
  const locked = () => page.evaluate(() => document.pointerLockElement?.id === "renderCanvas");

  check(await hintVisible(), "첫 화면에 마우스 고정 안내 표시");
  // 서 있을 때도 idle 애니메이션이 실제로 포즈를 움직이는가 (Babylon 시계가 프레임을 덮어써 멈추던 문제 방지)
  await page.waitForTimeout(1200);
  const idlePose = await pose();
  check(idlePose >= 1, "서 있을 때 idle 애니메이션이 움직인다", `척추 ${idlePose}°/s`);

  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(400);
  check(await locked(), "클릭하면 포인터 락이 걸린다");
  check(!(await hintVisible()), "잠긴 뒤 안내가 사라진다");
  const afterLock = await state();
  check(afterLock === "idle", "고정에 쓴 클릭은 공격으로 나가지 않는다", `상태 ${afterLock}`);

  const yaw0 = await yaw();
  // 헤드리스 Chromium의 포인터 락 에뮬레이션은 이동을 +x 다음 -x로 보내 합이 0이 된다 (실제 브라우저는 상대 이동량).
  // 그래서 회전만은 movementX를 담은 pointermove를 직접 보낸다 — pointermove → 시점 입력 → 카메라 연결을 확인한다.
  await page.evaluate(() => {
    const c = document.getElementById("renderCanvas");
    for (let i = 0; i < 10; i++) c?.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", movementX: 30, bubbles: true }));
  });
  await page.waitForTimeout(400);
  const yaw1 = await yaw();
  check(Number.isFinite(yaw0) && Math.abs(yaw1 - yaw0) >= 5, "마우스 이동으로 카메라가 돈다", `yaw ${yaw0}° → ${yaw1}°`);

  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  let attacked = "";
  let attackPose = 0;
  for (let i = 0; i < 20 && !attacked; i++) {
    const s = await state();
    if (s.startsWith("attack")) attacked = s;
    else await page.waitForTimeout(25);
  }
  check(attacked !== "", "왼쪽 클릭으로 공격한다", attacked || `상태 ${await state()}`);
  for (let i = 0; i < 12; i++) {
    attackPose = Math.max(attackPose, await pose());
    await page.waitForTimeout(50);
  }
  check(attackPose >= 30, "공격 애니메이션이 실제로 포즈를 움직인다", `척추 최대 ${attackPose}°/s`);

  check(errors.length === 0, "페이지 오류 없음", errors.join(" | "));
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`\n실패 ${failures.length}건`);
  process.exit(1);
}
console.log("\n모두 통과");
