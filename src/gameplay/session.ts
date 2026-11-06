/**
 * 게임 세션: 입력 → sim 상태 머신 → 캐릭터 컨트롤러 → 렌더 메시(보간) → 카메라/락온 → UI 를 한 곳에서 연결한다.
 *
 *  고정 스텝(60Hz):  입력 샘플(카메라 yaw, 락온 대상) → sim.step()(상태 머신 → 이동 → 전투) → physics.step() → 이벤트 큐
 *  렌더 프레임:      이벤트 전달 → 메시 보간 → 카메라(스프링 암, 셰이크) → 락온 해제/전환 → 마커/패널
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { PointLight } from "@babylonjs/core/Lights/pointLight";
import type { Scene } from "@babylonjs/core/scene";
import { bindDebugKey } from "../core/debugKeys";
import { EventBus } from "../core/eventBus";
import type { InputManager } from "../core/input";
import { CharacterSystem } from "../physics/character/characterSystem";
import { HavokHitQuery } from "../physics/combat/havokHitQuery";
import { placeholderSockets } from "../physics/combat/placeholderSockets";
import { SweepDebugView } from "../physics/combat/sweepDebugView";
import { PhysicsDebugView } from "../physics/debugView";
import { PhysicsWorld } from "../physics/physicsWorld";
import { createTestSceneColliders } from "../physics/testSceneColliders";
import { LANTERN_INTENSITY, createTestScene } from "../render/testScene";
import type { AttackInstance } from "../sim/combat/types";
import { isDead, isStaggered, type Entity, type EntityId } from "../sim/entity";
import type { GameEventMap, SimEvent } from "../sim/events";
import { createInputFrame, wasPressed } from "../sim/inputFrame";
import { revive } from "../sim/stats";
import { SIM_HZ } from "../sim/time";
import { SimWorld } from "../sim/world";
import { DebugPanel, textBar } from "../ui/debugPanel";
import { FpsMeter } from "../ui/fpsMeter";
import type { InputDebugOverlay } from "../ui/inputDebug";
import { LockOnMarker } from "../ui/lockOnMarker";
import { LockOnSystem, type MarkerPosition } from "./camera/lockOnSystem";
import { SpringArmProbe } from "./camera/springArmProbe";
import { ThirdPersonCamera } from "./camera/thirdPersonCamera";
import { CharacterView, ViewMaterials } from "./player/characterView";
import { playerColorKey, type ViewColorKey } from "./player/stateColors";

export interface SessionOptions {
  interpolate: boolean;
  physicsDebugOnStart: boolean;
  inputDebug: InputDebugOverlay | null;
}

/** 연습용 허수아비 배치 (플레이어는 원점에서 +Z를 보고 시작) */
const DUMMY_SPAWNS = [
  { x: 1.5, y: 0, z: 5 },
  { x: -0.6, y: 0, z: 8 },
  { x: 3.2, y: 0, z: 8.6 },
] as const;
const DUMMY_RESPAWN_TICKS = 3 * SIM_HZ;
const EVENT_LOG_SIZE = 5;

interface Dummy {
  entity: Entity;
  spawn: { x: number; y: number; z: number };
  deadTicks: number;
}

export function describeEvent(e: SimEvent): string | null {
  switch (e.type) {
    case "hit":
      return `hit → #${e.payload.target} ${e.payload.damage.toFixed(1)}${e.payload.backAttack ? " (백어택)" : ""}${e.payload.staggered ? " 경직" : ""}`;
    case "weapon_bounce":
      return `weapon_bounce #${e.payload.attacker}`;
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

export class GameSession {
  /** sim → render 이벤트. 타격감 시스템 등이 구독한다 (고정 스텝 중 enqueue, 렌더 프레임에서 flush) */
  readonly events = new EventBus<GameEventMap>();
  readonly views = new Map<EntityId, CharacterView>();
  readonly hero: Entity;
  private readonly materials: ViewMaterials;
  private readonly dummies: Dummy[] = [];
  private readonly physicsDebug: PhysicsDebugView;
  private readonly sweepDebug: SweepDebugView;
  private readonly marker: LockOnMarker;
  private readonly panel = new DebugPanel("top-right");
  private readonly fps = new FpsMeter();
  private readonly frame = createInputFrame();
  private readonly look = { x: 0, y: 0 };
  private readonly drained: SimEvent[] = [];
  private readonly eventLog: string[] = [];
  private readonly chest = { x: 0, y: 0, z: 0 };
  private readonly markerPos: MarkerPosition = { visible: false, x: 0, y: 0 };
  private lanternOn = true;
  private inTrigger = false;

  private constructor(
    readonly scene: Scene,
    readonly physics: PhysicsWorld,
    readonly characters: CharacterSystem,
    readonly hitQuery: HavokHitQuery,
    readonly sim: SimWorld,
    readonly camera: ThirdPersonCamera,
    readonly lockOn: LockOnSystem,
    private readonly lantern: PointLight,
    private readonly input: InputManager,
    canvas: HTMLCanvasElement,
    private readonly options: SessionOptions,
    hero: Entity,
  ) {
    this.hero = hero;
    this.materials = new ViewMaterials(scene);
    for (const spawn of DUMMY_SPAWNS) {
      const entity = sim.spawn("training_dummy", "enemy", spawn, Math.PI);
      this.dummies.push({ entity, spawn: { ...spawn }, deadTicks: 0 });
    }
    const heroView = this.viewFor(hero);
    lantern.parent = heroView.body;

    this.physicsDebug = new PhysicsDebugView(physics);
    this.sweepDebug = new SweepDebugView(scene, hitQuery);
    this.setDebug(options.physicsDebugOnStart);
    bindDebugKey("F3", () => this.setDebug(!this.physicsDebug.enabled));

    physics.onTriggerEnter.add((e) => {
      if (e.other === characters.bodyOf(hero.id)) this.inTrigger = true;
    });
    physics.onTriggerExit.add((e) => {
      if (e.other === characters.bodyOf(hero.id)) this.inTrigger = false;
    });

    this.marker = new LockOnMarker(canvas);
  }

  static async create(engine: AbstractEngine, canvas: HTMLCanvasElement, input: InputManager, options: SessionOptions): Promise<GameSession> {
    const { scene, lantern } = createTestScene(engine);
    // 물리 → 캐릭터 컨트롤러(이동 포트) → 무기 스윕(HitQuery) → sim
    const physics = await PhysicsWorld.create(scene);
    createTestSceneColliders(physics, scene);
    const characters = new CharacterSystem(physics);
    const hitQuery = new HavokHitQuery(physics, characters, placeholderSockets);
    const sim = new SimWorld({ movement: characters, hitQuery });
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 }, 0);
    const camera = new ThirdPersonCamera(scene, new SpringArmProbe(physics));
    camera.snapTo(0);
    // 락온 위치 조회는 렌더 보간 위치 (화면에 보이는 위치)
    let session: GameSession | null = null;
    const lockOn = new LockOnSystem(scene, camera.camera, physics, sim, hero.id, (id) => session?.views.get(id)?.display.position ?? sim.get(id)?.position ?? null);
    session = new GameSession(scene, physics, characters, hitQuery, sim, camera, lockOn, lantern, input, canvas, options, hero);
    return session;
  }

  /** 고정 스텝 (60Hz) */
  fixedUpdate(dt: number): void {
    const f = this.input.sampleFrame(this.sim.tick + 1, this.camera.viewYaw, this.frame, this.lockOn.targetId ?? 0);
    this.options.inputDebug?.recordFrame(f, performance.now());
    if (wasPressed(f, "lock_on")) f.lockTarget = this.lockOn.toggle() ?? 0;
    if (wasPressed(f, "toggle_lantern")) this.lanternOn = !this.lanternOn; // TODO(gameplay): 등불을 sim 상태로

    for (const e of this.sim.entities) this.viewFor(e).capturePrevious(e);
    this.sim.players.setInput(this.hero.id, f);
    this.sim.step(); // 상태 머신(의도) → 캐릭터 컨트롤러(이동) → 무기 스윕(전투)
    this.physics.step(dt);

    this.drained.length = 0;
    this.sim.drainEvents(this.drained);
    for (const ev of this.drained) {
      // SimEvent는 type/payload가 짝지어진 유니온이지만 TS가 제네릭 인자로 연관을 추론하지 못해 캐스트한다
      this.events.enqueue(ev.type, ev.payload as never);
      const text = describeEvent(ev);
      if (text) {
        this.eventLog.unshift(`[${ev.tick}] ${text}`);
        if (this.eventLog.length > EVENT_LOG_SIZE) this.eventLog.length = EVENT_LOG_SIZE;
      }
    }
    this.respawnDummies();
  }

  /** 렌더 프레임 */
  render(alpha: number, frameSeconds: number): void {
    const dt = frameSeconds;
    this.fps.update(dt);
    this.input.consumeLook(this.look);
    this.events.flush();

    const t = this.options.interpolate ? alpha : 1;
    const weaponTick = this.sim.tick - 1 + t;
    for (const e of this.sim.entities) this.viewFor(e).sync(e, t, this.colorOf(e), this.attackOf(e.id), weaponTick);
    this.cleanupViews();

    const heroView = this.viewFor(this.hero);
    const lockChest = this.lockOn.targetChest(this.chest);
    this.camera.update(dt, { look: this.look, follow: heroView.display.position, lockTarget: lockChest });
    this.lockOn.update(dt, this.lockOn.targetId === null ? 0 : this.look.x);

    const engine = this.scene.getEngine();
    this.lockOn.marker(this.markerPos);
    this.marker.update(this.markerPos.visible, this.markerPos.x, this.markerPos.y, engine.getRenderWidth(), engine.getRenderHeight());
    this.sweepDebug.update();
    // freeze()된 재질에는 setEnabled 변화가 반영되지 않으므로 intensity로 끈다 (testScene.ts 참고)
    this.lantern.intensity = this.lanternOn ? LANTERN_INTENSITY : 0;

    this.updatePanel();
    this.options.inputDebug?.update(
      this.frame,
      { device: this.input.activeDevice, pointerLocked: this.input.isPointerLocked, gamepad: this.input.gamepadConnected, lanternOn: this.lanternOn },
      performance.now(),
    );
    this.scene.render();
  }

  viewFor(e: Readonly<Entity>): CharacterView {
    let v = this.views.get(e.id);
    if (!v) {
      v = new CharacterView(this.scene, this.materials, e);
      this.views.set(e.id, v);
    }
    return v;
  }

  private setDebug(on: boolean): void {
    this.physicsDebug.setEnabled(on);
    this.sweepDebug.setEnabled(on);
  }

  private colorOf(e: Readonly<Entity>): ViewColorKey {
    const p = this.sim.players.get(e.id);
    if (p) return playerColorKey(p.state, p.action);
    if (isDead(e)) return "death";
    if (isStaggered(e)) return "stagger";
    return e.archetype === "training_dummy" ? "dummy" : "enemy";
  }

  private attackOf(id: EntityId): AttackInstance | null {
    for (const a of this.sim.combat.active) if (a.attackerId === id) return a;
    return null;
  }

  private cleanupViews(): void {
    for (const [id, v] of this.views) {
      if (!this.sim.get(id)) {
        v.dispose();
        this.views.delete(id);
      }
    }
  }

  /** 테스트 씬 편의: 허수아비는 죽으면 잠시 뒤 제자리에서 부활 */
  private respawnDummies(): void {
    for (const d of this.dummies) {
      if (!isDead(d.entity)) continue;
      if (++d.deadTicks < DUMMY_RESPAWN_TICKS) continue;
      revive(d.entity);
      this.characters.teleport(d.entity, d.spawn);
      d.entity.yaw = Math.PI;
      this.viewFor(d.entity).capturePrevious(d.entity);
      d.deadTicks = 0;
    }
  }

  private updatePanel(): void {
    const h = this.hero;
    const p = this.sim.players.get(h.id);
    const lockId = this.lockOn.targetId;
    const lockEntity = lockId !== null ? this.sim.get(lockId) : undefined;
    const release = this.lockOn.controller.lastReleaseReason;
    this.panel.setLines([
      `FPS ${this.fps.fps.toFixed(0).padStart(3)}  (최악 ${this.fps.worstFrameMs.toFixed(1)}ms)`,
      `상태     ${p?.state ?? "-"}${p?.action ? ` · ${p.action}` : ""}${p ? `  [${p.stateTick}]` : ""}`,
      `버퍼     ${p?.reserved ?? "-"}`,
      `체력     ${textBar(h.health / h.maxHealth)} ${h.health.toFixed(0)}`,
      `스태미나 ${textBar(h.stamina / h.maxStamina)} ${h.stamina.toFixed(0)}`,
      `락온     ${lockEntity ? `#${lockEntity.id} ${lockEntity.archetype} (${lockEntity.health.toFixed(0)})` : "-"}${!lockEntity && release ? `  해제: ${release}` : ""}`,
      `접지     ${this.characters.get(h.id)?.groundState ?? "-"}  트리거 ${this.inTrigger ? "안" : "밖"}`,
      `F3 물리 디버그 ${this.physicsDebug.enabled ? "켜짐" : "꺼짐"}  등불 ${this.lanternOn ? "켜짐" : "꺼짐"}`,
      `마우스   ${this.input.isPointerLocked ? "잠금됨 (Esc 해제)" : "화면 클릭 → 잠금"}`,
      "",
      ...this.eventLog,
    ]);
  }

  dispose(): void {
    this.panel.dispose();
    this.marker.dispose();
    this.sweepDebug.dispose();
    this.physicsDebug.dispose();
  }
}
