import { createEngine } from "./core/engine";
import { EventBus } from "./core/eventBus";
import { GameLoop } from "./core/gameLoop";
import { createTestScene } from "./render/testScene";
import type { GameEventMap } from "./sim/events";

/**
 * 디버그용 URL 파라미터
 *  - ?simhz=10   시뮬레이션 주기 변경 (기본 60). 낮추면 보간 효과를 눈으로 확인하기 쉽다
 *  - ?nointerp   보간을 끄고 현재 스텝 상태만 그린다 (비교용)
 */
const params = new URLSearchParams(window.location.search);
const SIM_HZ = Math.min(240, Math.max(1, Number(params.get("simhz")) || 60));
const INTERPOLATE = !params.has("nointerp");

/**
 * 고정 스텝 + 보간 확인용 데모 상태: 캡슐이 원을 따라 걷는다.
 * TODO: sim/ 월드(플레이어/적 엔티티)가 생기면 이 데모를 대체한다.
 */
const ORBIT_RADIUS = 3;
const ORBIT_SPEED = 0.6; // rad/s
const demo = { prevAngle: 0, angle: 0 };

function demoFixedUpdate(dt: number): void {
  demo.prevAngle = demo.angle;
  demo.angle += ORBIT_SPEED * dt;
}

async function main(): Promise<void> {
  const canvas = document.getElementById("renderCanvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#renderCanvas 캔버스를 찾을 수 없습니다.");

  const { engine } = await createEngine(canvas);
  const { scene, capsule } = createTestScene(engine, canvas);

  // sim → render 이벤트: 고정 스텝 중 enqueue, 렌더 프레임에서 flush
  const events = new EventBus<GameEventMap>();

  const loop = new GameLoop(
    {
      fixedUpdate: (dt) => {
        demoFixedUpdate(dt);
      },
      render: (alpha) => {
        events.flush();
        const a = INTERPOLATE ? demo.prevAngle + (demo.angle - demo.prevAngle) * alpha : demo.angle;
        capsule.position.set(Math.cos(a) * ORBIT_RADIUS, 0, Math.sin(a) * ORBIT_RADIUS);
        // 진행 방향(접선)을 바라본다. Babylon yaw: +Z가 0, +X 쪽으로 증가
        capsule.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
        scene.render();
      },
    },
    { stepSeconds: 1 / SIM_HZ },
  );
  loop.bindVisibility(document);

  console.info(`[loop] 시뮬레이션 ${SIM_HZ}Hz 고정 스텝, 보간 ${INTERPOLATE ? "켜짐" : "꺼짐"}`);
  engine.runRenderLoop(() => loop.frame(performance.now()));
  window.addEventListener("resize", () => engine.resize());
}

main().catch((err: unknown) => {
  console.error(err);
  const el = document.getElementById("fatal");
  if (el) {
    el.textContent = err instanceof Error ? err.message : String(err);
    el.hidden = false;
  }
});
