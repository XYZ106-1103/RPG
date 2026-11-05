import { bindDebugKey } from "./core/debugKeys";
import { createEngine } from "./core/engine";
import { EventBus } from "./core/eventBus";
import { GameLoop } from "./core/gameLoop";
import { InputManager } from "./core/input";
import { PhysicsDebugView } from "./physics/debugView";
import { PhysicsWorld } from "./physics/physicsWorld";
import { createTestSceneColliders } from "./physics/testSceneColliders";
import { LANTERN_INTENSITY, createTestScene } from "./render/testScene";
import type { GameEventMap } from "./sim/events";
import { createInputFrame, isHeld, wasPressed } from "./sim/inputFrame";
import { InputDebugOverlay } from "./ui/inputDebug";

/**
 * 디버그용 URL 파라미터
 *  - ?simhz=10         시뮬레이션 주기 변경 (기본 60). 낮추면 보간 효과를 눈으로 확인하기 쉽다
 *  - ?nointerp         보간을 끄고 현재 스텝 상태만 그린다 (비교용)
 *  - ?noinputdebug     입력 디버그 오버레이 숨김
 *  - ?physicsdebug     물리 디버그 뷰를 켠 상태로 시작 (F3으로 토글)
 */
const params = new URLSearchParams(window.location.search);
const SIM_HZ = Math.min(240, Math.max(1, Number(params.get("simhz")) || 60));
const INTERPOLATE = !params.has("nointerp");
const SHOW_INPUT_DEBUG = !params.has("noinputdebug");
const PHYSICS_DEBUG_ON_START = params.has("physicsdebug");

/**
 * 입력 확인용 데모: 캡슐이 카메라 기준으로 이동한다 (Space 길게 = 스프린트, F/Y = 등불).
 * TODO: sim/ 월드(플레이어 엔티티, 이동/전투)와 gameplay/ 카메라가 생기면 이 데모를 대체한다.
 */
const RUN_SPEED = 4.6; // m/s
const SPRINT_SPEED = 6.8;
const CAMERA_PITCH_MIN = 0.35; // ArcRotateCamera beta (라디안, 0=바로 위)
const CAMERA_PITCH_MAX = 1.5;
const demo = { prevX: 0, prevZ: 0, x: 0, z: 0, prevYaw: 0, yaw: 0, lanternOn: true };

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

async function main(): Promise<void> {
  const canvas = document.getElementById("renderCanvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#renderCanvas 캔버스를 찾을 수 없습니다.");

  const { engine } = await createEngine(canvas);
  const { scene, camera, lantern, capsule } = createTestScene(engine);
  const input = new InputManager(canvas);
  const overlay = SHOW_INPUT_DEBUG ? new InputDebugOverlay() : null;

  // 물리: Havok 로드 → 충돌체 배치 → F3 디버그 뷰
  const physics = await PhysicsWorld.create(scene);
  const colliders = createTestSceneColliders(physics, scene);
  const physicsDebug = new PhysicsDebugView(physics);
  physicsDebug.setEnabled(PHYSICS_DEBUG_ON_START);
  bindDebugKey("F3", () => {
    const on = physicsDebug.toggle();
    console.info(`[physics] 충돌 셰이프 표시 ${on ? "켜짐" : "꺼짐"}`);
  });
  let inTrigger = false;
  physics.onTriggerEnter.add((e) => {
    if (e.other !== colliders.playerBody) return;
    inTrigger = true;
    console.info("[physics] 트리거 진입");
  });
  physics.onTriggerExit.add((e) => {
    if (e.other !== colliders.playerBody) return;
    inTrigger = false;
    console.info("[physics] 트리거 이탈");
  });

  // sim → render 이벤트: 고정 스텝 중 enqueue, 렌더 프레임에서 flush
  const events = new EventBus<GameEventMap>();

  /** 카메라 시선 yaw (Babylon 규약: +Z=0, +X 방향으로 증가) */
  let viewYaw = 0;
  let pitch = 1.2;
  const look = { x: 0, y: 0 };
  const frame = createInputFrame();

  const loop = new GameLoop(
    {
      fixedUpdate: (dt, tick) => {
        input.sampleFrame(tick, viewYaw, frame);
        overlay?.recordFrame(frame, performance.now());

        demo.prevX = demo.x;
        demo.prevZ = demo.z;
        demo.prevYaw = demo.yaw;
        if (wasPressed(frame, "toggle_lantern")) demo.lanternOn = !demo.lanternOn;

        // 스틱 공간(x=오른쪽, y=앞) → 월드: 카메라 yaw만큼 회전
        const fx = Math.sin(frame.viewYaw);
        const fz = Math.cos(frame.viewYaw);
        const wx = fx * frame.moveY + fz * frame.moveX;
        const wz = fz * frame.moveY - fx * frame.moveX;
        const speed = isHeld(frame, "sprint") ? SPRINT_SPEED : RUN_SPEED;
        demo.x += wx * speed * dt;
        demo.z += wz * speed * dt;
        if (wx !== 0 || wz !== 0) demo.yaw = Math.atan2(wx, wz);

        // 물리는 고정 스텝에서만 진행한다. 충돌체는 보간 전 sim 위치를 따른다.
        // TODO(physics): 캐릭터 컨트롤러가 생기면 이동을 컨트롤러에 맡긴다 (지금은 상자/적을 통과함)
        colliders.playerCollider.position.set(demo.x, 0, demo.z);
        physics.step(dt);
      },
      render: (alpha) => {
        const now = performance.now();
        input.consumeLook(look);
        viewYaw += look.x;
        pitch = Math.min(CAMERA_PITCH_MAX, Math.max(CAMERA_PITCH_MIN, pitch + look.y));

        events.flush();
        const t = INTERPOLATE ? alpha : 1;
        capsule.position.set(demo.prevX + (demo.x - demo.prevX) * t, 0, demo.prevZ + (demo.z - demo.prevZ) * t);
        capsule.rotation.y = lerpAngle(demo.prevYaw, demo.yaw, t);
        // freeze()된 재질에는 setEnabled 변화가 반영되지 않으므로 intensity로 끈다 (testScene.ts 참고)
        lantern.intensity = demo.lanternOn ? LANTERN_INTENSITY : 0;

        // 카메라: 캡슐 뒤에서 viewYaw 방향을 바라본다 (ArcRotate alpha는 타깃→카메라 방향의 XZ 각도)
        camera.target.set(capsule.position.x, 1.2, capsule.position.z);
        camera.alpha = Math.atan2(-Math.cos(viewYaw), -Math.sin(viewYaw));
        camera.beta = pitch;

        overlay?.update(
          frame,
          {
            device: input.activeDevice,
            pointerLocked: input.isPointerLocked,
            gamepad: input.gamepadConnected,
            lanternOn: demo.lanternOn,
            extra: [`물리 디버그(F3): ${physicsDebug.enabled ? "켜짐" : "꺼짐"}`, `트리거 영역: ${inTrigger ? "안" : "밖"}`],
          },
          now,
        );
        scene.render();
      },
    },
    { stepSeconds: 1 / SIM_HZ },
  );
  loop.bindVisibility(document);

  console.info(`[loop] 시뮬레이션 ${SIM_HZ}Hz 고정 스텝, 보간 ${INTERPOLATE ? "켜짐" : "꺼짐"}`);
  // 입력 폴링(게임패드, 탭/홀드 타이머)은 고정 스텝보다 먼저 해야 같은 프레임의 sim 틱에 반영된다
  let lastFrameMs = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    input.update(now, Math.min(0.25, (now - lastFrameMs) / 1000));
    lastFrameMs = now;
    loop.frame(now);
  });
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
