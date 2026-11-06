import { bindDebugKey } from "./core/debugKeys";
import { createEngine } from "./core/engine";
import { EventBus } from "./core/eventBus";
import { GameLoop } from "./core/gameLoop";
import { InputManager } from "./core/input";
import { CharacterSystem } from "./physics/character/characterSystem";
import { HavokHitQuery } from "./physics/combat/havokHitQuery";
import { placeholderSockets } from "./physics/combat/placeholderSockets";
import { SweepDebugView } from "./physics/combat/sweepDebugView";
import { PhysicsDebugView } from "./physics/debugView";
import { PhysicsWorld } from "./physics/physicsWorld";
import { createTestSceneColliders } from "./physics/testSceneColliders";
import { TestEntityViews } from "./render/testEntityViews";
import { LANTERN_INTENSITY, createTestScene } from "./render/testScene";
import { isDead } from "./sim/entity";
import type { GameEventMap, SimEvent } from "./sim/events";
import { createInputFrame, wasPressed } from "./sim/inputFrame";
import { revive } from "./sim/stats";
import { SIM_HZ as SIM_DEFAULT_HZ } from "./sim/time";
import { SimWorld } from "./sim/world";
import { InputDebugOverlay } from "./ui/inputDebug";

/**
 * 디버그용 URL 파라미터
 *  - ?simhz=10         렌더 보간 확인용으로 고정 스텝 주기를 바꾼다 (기본 60). sim 수치는 60Hz 기준이라 게임 속도도 바뀐다
 *  - ?nointerp         보간을 끄고 현재 스텝 상태만 그린다 (비교용)
 *  - ?noinputdebug     입력 디버그 오버레이 숨김
 *  - ?physicsdebug     물리 디버그 뷰(충돌 셰이프 + 무기 궤적)를 켠 상태로 시작 (F3으로 토글)
 */
const params = new URLSearchParams(window.location.search);
const SIM_HZ = Math.min(240, Math.max(1, Number(params.get("simhz")) || SIM_DEFAULT_HZ));
const INTERPOLATE = !params.has("nointerp");
const SHOW_INPUT_DEBUG = !params.has("noinputdebug");
const PHYSICS_DEBUG_ON_START = params.has("physicsdebug");

const CAMERA_PITCH_MIN = 0.35; // ArcRotateCamera beta (라디안, 0=바로 위)
const CAMERA_PITCH_MAX = 1.5;
/** 테스트 씬 허수아비: 죽으면 이 시간 뒤 제자리에서 부활 */
const DUMMY_RESPAWN_TICKS = 3 * SIM_DEFAULT_HZ;
const EVENT_LOG_SIZE = 6;

function describeEvent(e: SimEvent): string | null {
  switch (e.type) {
    case "hit":
      return `hit → #${e.payload.target} ${e.payload.damage.toFixed(1)}${e.payload.backAttack ? " (백어택)" : ""}${e.payload.staggered ? " 경직" : ""}`;
    case "weapon_bounce":
      return `weapon_bounce #${e.payload.attacker} (${e.payload.attack})`;
    case "guard":
      return `guard #${e.payload.target}${e.payload.broken ? " 브레이크" : ""}`;
    case "parry":
      return `parry #${e.payload.parrier} ← #${e.payload.attacker}`;
    case "death":
      return `death #${e.payload.entity}`;
    case "stagger":
      return `stagger #${e.payload.entity}`;
    case "action_rejected":
      return `거부: ${e.payload.action} (${e.payload.reason})`;
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById("renderCanvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#renderCanvas 캔버스를 찾을 수 없습니다.");

  const { engine } = await createEngine(canvas);
  const { scene, camera, lantern, capsule } = createTestScene(engine);
  const input = new InputManager(canvas);
  const overlay = SHOW_INPUT_DEBUG ? new InputDebugOverlay() : null;

  // 물리 → 캐릭터 컨트롤러(이동 포트) → 무기 스윕(HitQuery) → sim 월드
  const physics = await PhysicsWorld.create(scene);
  createTestSceneColliders(physics, scene);
  const characters = new CharacterSystem(physics);
  const hitQuery = new HavokHitQuery(physics, characters, placeholderSockets);
  const sim = new SimWorld({ movement: characters, hitQuery });
  const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 }, 0);
  // 허수아비 적 — AI 없음 (TODO: 적 AI가 생기면 대체)
  const dummySpawn = { x: 3, y: 0, z: 4 };
  const dummy = sim.spawn("hollow", "enemy", dummySpawn, Math.PI);
  let dummyDeadTicks = 0;

  const views = new TestEntityViews(scene, new Map([[hero.id, capsule]]));

  // F3: 충돌 셰이프 + 무기 스윕 궤적
  const physicsDebug = new PhysicsDebugView(physics);
  const sweepDebug = new SweepDebugView(scene, hitQuery);
  const setDebug = (on: boolean): void => {
    physicsDebug.setEnabled(on);
    sweepDebug.setEnabled(on);
  };
  setDebug(PHYSICS_DEBUG_ON_START);
  bindDebugKey("F3", () => {
    setDebug(!physicsDebug.enabled);
    console.info(`[physics] 디버그 표시 ${physicsDebug.enabled ? "켜짐" : "꺼짐"}`);
  });

  let inTrigger = false;
  physics.onTriggerEnter.add((e) => {
    if (e.other !== characters.bodyOf(hero.id)) return;
    inTrigger = true;
    console.info("[physics] 트리거 진입");
  });
  physics.onTriggerExit.add((e) => {
    if (e.other !== characters.bodyOf(hero.id)) return;
    inTrigger = false;
    console.info("[physics] 트리거 이탈");
  });

  // sim → render 이벤트: 고정 스텝 중 enqueue, 렌더 프레임에서 flush
  const events = new EventBus<GameEventMap>();
  const drained: SimEvent[] = [];
  const eventLog: string[] = [];

  /** 카메라 시선 yaw (Babylon 규약: +Z=0, +X 방향으로 증가) */
  let viewYaw = 0;
  let pitch = 1.2;
  let lanternOn = true;
  const look = { x: 0, y: 0 };
  const frame = createInputFrame();

  const loop = new GameLoop(
    {
      fixedUpdate: (dt) => {
        input.sampleFrame(sim.tick + 1, viewYaw, frame);
        overlay?.recordFrame(frame, performance.now());
        if (wasPressed(frame, "toggle_lantern")) lanternOn = !lanternOn; // TODO(gameplay): 등불을 sim 상태로

        views.capturePrevious(sim);
        sim.players.setInput(hero.id, frame);
        sim.step(); // 상태 머신(의도) → 캐릭터 컨트롤러(이동) → 무기 스윕(전투)
        physics.step(dt);

        drained.length = 0;
        sim.drainEvents(drained);
        for (const ev of drained) {
          events.enqueue(ev.type, ev.payload as never);
          const text = describeEvent(ev);
          if (text) {
            eventLog.unshift(`[${ev.tick}] ${text}`);
            if (eventLog.length > EVENT_LOG_SIZE) eventLog.length = EVENT_LOG_SIZE;
            console.info(`[sim] ${text}`);
          }
        }

        // 테스트 씬 편의: 허수아비는 죽으면 잠시 뒤 제자리에서 부활
        if (isDead(dummy) && ++dummyDeadTicks >= DUMMY_RESPAWN_TICKS) {
          revive(dummy);
          characters.teleport(dummy, dummySpawn);
          dummy.yaw = Math.PI;
          dummyDeadTicks = 0;
        }
      },
      render: (alpha) => {
        const now = performance.now();
        input.consumeLook(look);
        viewYaw += look.x;
        pitch = Math.min(CAMERA_PITCH_MAX, Math.max(CAMERA_PITCH_MIN, pitch + look.y));

        events.flush();
        views.sync(sim, INTERPOLATE ? alpha : 1);
        sweepDebug.update();
        // freeze()된 재질에는 setEnabled 변화가 반영되지 않으므로 intensity로 끈다 (testScene.ts 참고)
        lantern.intensity = lanternOn ? LANTERN_INTENSITY : 0;

        // 카메라: 보간된 플레이어 뒤에서 viewYaw 방향을 바라본다 (ArcRotate alpha는 타깃→카메라 방향의 XZ 각도)
        const hp = views.interpolatedPosition(hero.id);
        if (hp) camera.target.set(hp.x, hp.y + 1.2, hp.z);
        camera.alpha = Math.atan2(-Math.cos(viewYaw), -Math.sin(viewYaw));
        camera.beta = pitch;

        const ps = sim.players.get(hero.id);
        overlay?.update(
          frame,
          {
            device: input.activeDevice,
            pointerLocked: input.isPointerLocked,
            gamepad: input.gamepadConnected,
            lanternOn,
            extra: [
              `상태: ${ps?.state ?? "-"}${ps?.action ? ` (${ps.action})` : ""}  접지: ${characters.get(hero.id)?.groundState ?? "-"}`,
              `체력 ${hero.health.toFixed(0)}/${hero.maxHealth}  스태미나 ${hero.stamina.toFixed(0)}/${hero.maxStamina}  허수아비 ${dummy.health.toFixed(0)}/${dummy.maxHealth}`,
              `위치 (${hero.position.x.toFixed(2)}, ${hero.position.y.toFixed(2)}, ${hero.position.z.toFixed(2)})`,
              `물리 디버그(F3): ${physicsDebug.enabled ? "켜짐" : "꺼짐"}  트리거 영역: ${inTrigger ? "안" : "밖"}`,
              "최근 이벤트:",
              ...eventLog,
            ],
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
