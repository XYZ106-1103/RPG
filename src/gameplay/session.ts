/**
 * 게임 세션: 입력 → sim 상태 머신 → 캐릭터 컨트롤러 → 렌더 메시(보간) → 카메라/락온 → UI 를 한 곳에서 연결한다.
 *
 *  고정 스텝(60Hz):  입력 샘플(카메라 yaw, 락온 대상) → sim.step()(상태 머신 → 이동 → 전투) → physics.step() → 이벤트 큐
 *  렌더 프레임:      이벤트 전달 → 메시 보간 → 카메라(스프링 암, 셰이크) → 락온 해제/전환 → 마커/패널
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Scene } from "@babylonjs/core/scene";
import { CharacterAnimator } from "../anim/animator";
import { HERO_PROFILE } from "../anim/characters/hero";
import { ClipLibrary } from "../anim/clipLibrary";
import { attachWeapon, bakeSocketTracks } from "../anim/sockets";
import { animEventsTimelineLoader } from "../anim/timelineLoader";
import { CharacterAsset, type CharacterModel } from "../assets/characterAsset";
import { bindDebugKey } from "../core/debugKeys";
import { EventBus } from "../core/eventBus";
import type { InputManager } from "../core/input";
import { CharacterSystem } from "../physics/character/characterSystem";
import { BakedSocketProvider, type SocketTrack } from "../physics/combat/bakedSockets";
import { HavokHitQuery } from "../physics/combat/havokHitQuery";
import { placeholderSockets } from "../physics/combat/placeholderSockets";
import { SweepDebugView } from "../physics/combat/sweepDebugView";
import { PhysicsDebugView } from "../physics/debugView";
import { PhysicsWorld } from "../physics/physicsWorld";
import { createTestSceneColliders } from "../physics/testSceneColliders";
import { Lighting } from "../render/lighting";
import { QUALITY_STORAGE_KEY, QualityManager, initialQualityLevel } from "../render/quality";
import { ShadowSystem } from "../render/shadows";
import { TEST_COLD_REGION, TEST_COLD_VOLUME, createTestScene } from "../render/testScene";
import { RegionFx } from "../render/postfx/regionFx";
import { PostFxSystem } from "../render/postfx/postFx";
import { ASHEN_PLAINS } from "../render/postfx/regions";
import type { AttackInstance } from "../sim/combat/types";
import { PLAYER_TIMELINES } from "../sim/data/playerTimelines";
import { isDead, isStaggered, type Entity, type EntityId } from "../sim/entity";
import type { GameEventMap, SimEvent } from "../sim/events";
import { createInputFrame, wasPressed } from "../sim/inputFrame";
import { revive } from "../sim/stats";
import { SIM_HZ } from "../sim/time";
import { SimWorld } from "../sim/world";
import { DebugPanel, textBar } from "../ui/debugPanel";
import { FpsMeter } from "../ui/fpsMeter";
import { PerfProbe } from "../render/perfProbe";
import { PassTimer } from "../render/passTimer";
import { DynamicResolution } from "../render/dynamicResolution";
import { AdaptiveQuality, adaptPatch } from "../render/adaptiveQuality";
import type { InputDebugOverlay } from "../ui/inputDebug";
import { LockOnMarker } from "../ui/lockOnMarker";
import { PointerLockHint } from "../ui/pointerLockHint";
import { LockOnSystem, type MarkerPosition } from "./camera/lockOnSystem";
import { SpringArmProbe } from "./camera/springArmProbe";
import { ThirdPersonCamera } from "./camera/thirdPersonCamera";
import { createFeelSettings, type FeelSettings } from "./feel/feelSettings";
import { HitFeedback } from "./feel/hitFeedback";
import { CharacterView, ViewMaterials } from "./player/characterView";
import { ModelCharacterView } from "./player/modelCharacterView";
import { playerColorKey, type ViewColorKey } from "./player/stateColors";

/** 플레이어 캐릭터 모델 (hero.glb). 로드에 실패하면 null → 캡슐로 표시 */
interface HeroModelParts {
  model: CharacterModel;
  lib: ClipLibrary;
  tracks: Map<string, SocketTrack>;
  weapon: ReturnType<typeof attachWeapon>;
}

/** 렌더 시스템 (품질 프리셋, 조명, 그림자) */
export interface RenderSystems {
  quality: QualityManager;
  lighting: Lighting;
  shadows: ShadowSystem;
  postFx: PostFxSystem;
  regions: RegionFx;
}

export interface SessionOptions {
  interpolate: boolean;
  physicsDebugOnStart: boolean;
  inputDebug: InputDebugOverlay | null;
  /** 렌더 백엔드 정보 (디버그 패널 표시) */
  renderInfo?: { backend: string; gpuName: string; fallbackReason: string | null; software: boolean };
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
  /** 타격감 수치 (?tune GUI가 직접 바꾼다) */
  readonly feel: FeelSettings = createFeelSettings();
  readonly hitFeedback: HitFeedback;
  private readonly materials: ViewMaterials;
  private readonly dummies: Dummy[] = [];
  private readonly physicsDebug: PhysicsDebugView;
  private readonly sweepDebug: SweepDebugView;
  private readonly marker: LockOnMarker;
  private readonly lockHint = new PointerLockHint();
  private readonly panel = new DebugPanel("top-left") // 오른쪽 위는 ?tune GUI 자리;
  private readonly fps = new FpsMeter();
  private readonly perf: PerfProbe;
  private readonly passTimer: PassTimer;
  readonly dynRes = new DynamicResolution();
  /** 해상도를 하한까지 내려도 무거우면 효과를 한 단계씩 줄인다 (사용자 프리셋 위에서 임시로) */
  readonly adaptive = new AdaptiveQuality();
  private readonly softwareNotice: HTMLDivElement | null = null;
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
    readonly gfx: RenderSystems,
    private readonly input: InputManager,
    canvas: HTMLCanvasElement,
    private readonly options: SessionOptions,
    hero: Entity,
    private readonly heroModel: HeroModelParts | null,
  ) {
    this.hero = hero;
    this.materials = new ViewMaterials(scene);
    this.perf = new PerfProbe(scene.getEngine(), scene);
    // 동적 해상도: 프리셋 렌더 스케일에서 시작
    this.dynRes.scale = gfx.quality.current.renderScale;
    scene.getEngine().setHardwareScalingLevel(1 / this.dynRes.scale);
    // 사용자가 프리셋을 바꾸면 자동 품질 단계는 처음부터 (setLevel이 프리셋 값을 통째로 되돌린다)
    gfx.quality.subscribe(null, (p, prev) => {
      if (prev && p.level !== prev.level) this.adaptive.reset();
    });
    if (options.renderInfo?.software) {
      // 소프트웨어 렌더링: 브라우저 GPU 가속이 꺼져 있다 (Chrome은 GPU 프로세스가 충돌하면 그 실행 동안 끈다)
      const el = document.createElement("div");
      el.textContent = "⚠ 브라우저 GPU 가속이 꺼져 있습니다 (소프트웨어 렌더링) — 브라우저를 완전히 종료 후 다시 실행해 주세요";
      Object.assign(el.style, {
        position: "fixed", top: "8px", left: "50%", transform: "translateX(-50%)", zIndex: "30",
        padding: "6px 12px", background: "rgba(120,30,20,0.85)", color: "#fff", font: "13px sans-serif", borderRadius: "4px", pointerEvents: "none",
      });
      document.body.appendChild(el);
      this.softwareNotice = el;
    }
    this.passTimer = new PassTimer(scene.getEngine(), scene, camera.camera, {
      groups: () => gfx.postFx.passGroups(),
      shadowMaps: () => [
        { label: "태양 그림자", map: gfx.shadows.sun.getShadowMap() },
        { label: "등불 그림자", map: gfx.shadows.lanternGen?.getShadowMap() ?? null },
      ],
      prePassTarget: () => gfx.postFx.prePassTarget(),
      setFrameCapture: (on) => this.perf.setFrameCapture(on),
      frameGpuMs: () => this.perf.gpuMs,
    });
    for (const spawn of DUMMY_SPAWNS) {
      const entity = sim.spawn("training_dummy", "enemy", spawn, Math.PI);
      this.dummies.push({ entity, spawn: { ...spawn }, deadTicks: 0 });
    }
    const heroView = this.viewFor(hero);
    // 등불: 모델이 있으면 리그의 Lantern 본에, 없으면 캡슐 허리에
    gfx.lighting.attachLantern(heroModel?.model.node(HERO_PROFILE.lanternBone) ?? null, heroView.body);
    // 피격/패리 반응 애니메이션 (sim 이벤트)
    const react = (id: EntityId, r: "hit_front" | "hit_back" | "parry"): void => {
      const v = this.views.get(id);
      if (v instanceof ModelCharacterView) v.react(r);
    };
    this.events.on("hit", (ev) => react(ev.target, ev.backAttack ? "hit_back" : "hit_front"));
    this.events.on("parry", (ev) => react(ev.attacker, "parry"));
    this.events.on("weapon_bounce", (ev) => react(ev.attacker, "parry"));

    this.physicsDebug = new PhysicsDebugView(physics);
    this.sweepDebug = new SweepDebugView(scene, hitQuery);
    this.setDebug(options.physicsDebugOnStart);
    bindDebugKey("F3", () => this.setDebug(!this.physicsDebug.enabled));
    // F4: 태양 그림자 필터 비교 (프리셋 → PCF 강제 → PCSS 강제)
    bindDebugKey("F4", () => gfx.shadows.cycleFilterOverride());
    // F5: 패스별 GPU 시간 (측정 비용이 있어 켰을 때만)
    bindDebugKey("F5", () => this.passTimer.toggle());

    physics.onTriggerEnter.add((e) => {
      if (e.other === characters.bodyOf(hero.id)) this.inTrigger = true;
    });
    physics.onTriggerExit.add((e) => {
      if (e.other === characters.bodyOf(hero.id)) this.inTrigger = false;
    });

    this.marker = new LockOnMarker(canvas);
    this.hitFeedback = new HitFeedback(
      { scene, events: this.events, viewOf: (id) => this.views.get(id), shake: camera.shake, heroId: hero.id },
      this.feel,
    );
  }

  static async create(engine: AbstractEngine, canvas: HTMLCanvasElement, input: InputManager, options: SessionOptions): Promise<GameSession> {
    const { scene, ground } = createTestScene(engine);
    // 품질 프리셋 (URL ?quality= > 저장값 > High) → 조명 → (카메라 뒤) 그림자
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(QUALITY_STORAGE_KEY);
    } catch {
      // 저장소를 못 쓰면 기본값
    }
    const quality = new QualityManager(initialQualityLevel(window.location.search, stored));
    quality.subscribe(null, (p) => {
      try {
        window.localStorage.setItem(QUALITY_STORAGE_KEY, p.level);
      } catch {
        // 무시
      }
    });
    // 렌더 해상도는 동적 해상도(세션)가 프리셋의 renderScale을 상한으로 조절한다
    const lighting = new Lighting(scene);
    await lighting.loadEnvironment(`${import.meta.env.BASE_URL}assets/hdri/night_overcast.env`);
    // 물리 → 캐릭터 컨트롤러(이동 포트) → 무기 스윕(HitQuery) → sim
    const physics = await PhysicsWorld.create(scene);
    createTestSceneColliders(physics, scene);
    const environment = scene.meshes.filter((m) => m !== lighting.sky && m !== ground && m !== lighting.lanternFlame);
    const characters = new CharacterSystem(physics);
    // 애니메이션 이벤트 → 행동 타임라인, 캐릭터 모델 → 무기 소켓 궤적 (sim 생성 전에 끝낸다)
    const timelineOverrides = await animEventsTimelineLoader.load(HERO_PROFILE.name);
    const heroModel = await loadHeroModel(scene, { ...PLAYER_TIMELINES, ...timelineOverrides });
    const sockets = new BakedSocketProvider(new Map(heroModel ? [["player", heroModel.tracks]] : []), placeholderSockets);
    const hitQuery = new HavokHitQuery(physics, characters, sockets);
    const sim = new SimWorld({ movement: characters, hitQuery, playerTimelines: timelineOverrides });
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 }, 0);
    const camera = new ThirdPersonCamera(scene, new SpringArmProbe(physics));
    camera.snapTo(0);
    const shadows = new ShadowSystem(scene, lighting.sun, lighting.lantern, quality, camera.camera);
    // 정적 환경: 그림자를 드리우고 받는다 (바닥은 받기만). TODO(월드): 청크 로드/해제 때 addCaster/해제 함수로
    shadows.addCaster(environment);
    shadows.addReceiver([ground, ...environment]);
    // 지역 볼륨(LUT·안개·노출 보간) → 후처리 (SSAO → … → 비네팅/그레인)
    let postFxRef: PostFxSystem | null = null;
    const regions = new RegionFx(
      scene,
      ASHEN_PLAINS,
      { setExposureScale: (k) => (lighting.exposureScale = k), updateLut: (g) => postFxRef?.updateLut(g.lut) },
      import.meta.env.BASE_URL,
    );
    regions.addProfile(TEST_COLD_REGION);
    regions.addVolume(TEST_COLD_VOLUME);
    const postFx = new PostFxSystem(scene, camera.camera, lighting.lantern, quality, regions.grading.lut);
    postFxRef = postFx;
    // 락온 위치 조회는 렌더 보간 위치 (화면에 보이는 위치)
    let session: GameSession | null = null;
    const lockOn = new LockOnSystem(scene, camera.camera, physics, sim, hero.id, (id) => session?.views.get(id)?.display.position ?? sim.get(id)?.position ?? null);
    session = new GameSession(scene, physics, characters, hitQuery, sim, camera, lockOn, { quality, lighting, shadows, postFx, regions }, input, canvas, options, hero, heroModel);
    return session;
  }

  /** 고정 스텝 (60Hz) */
  fixedUpdate(dt: number): void {
    const t0 = performance.now();
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
    this.perf.addSim(performance.now() - t0);
  }

  /** 렌더 프레임 */
  render(alpha: number, frameSeconds: number): void {
    const t0 = performance.now();
    const dt = frameSeconds;
    this.fps.update(dt);
    this.input.consumeLook(this.look);
    this.events.flush();

    const t = this.options.interpolate ? alpha : 1;
    const weaponTick = this.sim.tick - 1 + t;
    for (const e of this.sim.entities) this.viewFor(e).sync(e, t, this.colorOf(e), this.attackOf(e.id), weaponTick, dt);
    this.cleanupViews();

    const heroView = this.viewFor(this.hero);
    const lockChest = this.lockOn.targetChest(this.chest);
    this.camera.update(dt, { look: this.look, follow: heroView.display.position, lockTarget: lockChest });
    this.lockOn.update(dt, this.lockOn.targetId === null ? 0 : this.look.x);

    const engine = this.scene.getEngine();
    this.lockOn.marker(this.markerPos);
    this.marker.update(this.markerPos.visible, this.markerPos.x, this.markerPos.y, engine.getRenderWidth(), engine.getRenderHeight());
    this.sweepDebug.update();
    this.hitFeedback.update(dt);
    const cp = this.camera.camera.globalPosition;
    const hp = heroView.display.position;
    const look = this.gfx.regions.update(cp, dt);
    // 지역 노출 보정(regions.update) 뒤에. freeze()된 재질에는 setEnabled 변화가 반영되지 않으므로 등불은 intensity로 끈다
    this.gfx.lighting.update(dt, this.lanternOn);
    this.gfx.shadows.update();
    this.gfx.postFx.update(dt, look, Math.hypot(cp.x - hp.x, cp.y - hp.y - 1, cp.z - hp.z)); // DOF 초점 = 카메라 ~ 플레이어 가슴

    // 동적 해상도: GPU 프레임 시간(없으면 프레임 시간)으로 렌더 배율 조절
    const gpuMs = this.perf.gpuMs;
    const nextScale = this.dynRes.update(gpuMs ?? dt * 1000, gpuMs !== null ? "gpu" : "frame", dt, this.gfx.quality.current.renderScale);
    if (nextScale !== null) engine.setHardwareScalingLevel(1 / nextScale);
    this.gfx.postFx.setRenderScale(this.dynRes.scale); // 100% 미만이면 선명화
    // 자동 품질: 해상도가 하한인데도 무거우면 효과를 한 단계 내리고, 상한까지 돌아와 여유가 길면 되돌린다
    const q = this.gfx.quality;
    const d = this.dynRes;
    const step = this.adaptive.update(gpuMs ?? dt * 1000, gpuMs !== null ? "gpu" : "frame", dt, {
      level: q.level,
      atFloor: !d.settings.enabled || d.scale <= Math.min(q.current.renderScale, d.settings.minScale) + 1e-3,
      atMax: d.scale >= q.current.renderScale - 1e-3,
      targetFps: d.settings.targetFps,
    });
    if (step !== null) {
      q.override(adaptPatch(q.level, step));
      console.info(`[render] ${this.adaptive.describe(q.level)}`);
    }

    this.updatePanel();
    this.lockHint.update({ pointerLocked: this.input.isPointerLocked, failed: this.input.pointerLockFailed, usingGamepad: this.input.activeDevice === "gamepad" });
    this.options.inputDebug?.update(
      this.frame,
      { device: this.input.activeDevice, pointerLocked: this.input.isPointerLocked, gamepad: this.input.gamepadConnected, lanternOn: this.lanternOn },
      performance.now(),
    );
    this.scene.render();
    this.passTimer.update();
    this.perf.endFrame(performance.now() - t0);
  }

  viewFor(e: Readonly<Entity>): CharacterView {
    let v = this.views.get(e.id);
    if (!v) {
      const hm = this.heroModel;
      v =
        e.id === this.hero.id && hm
          ? new ModelCharacterView(
              this.scene,
              this.materials,
              e,
              hm.model,
              new CharacterAnimator(hm.lib, HERO_PROFILE),
              {
                player: () => this.sim.players.get(e.id),
                actionLength: (a) => this.sim.players.timelines[a].length,
                simTick: () => this.sim.tick,
                lockedOn: () => this.lockOn.targetId !== null,
              },
              hm.weapon,
            )
          : new CharacterView(this.scene, this.materials, e);
      this.views.set(e.id, v);
      // 캐릭터 그림자: 모델은 LOD0 + 무기만 드리우고(LOD1/2는 같은 자리라 중복) 모든 LOD가 받는다. dispose되면 자동 해제
      // 등불을 든 플레이어 본인은 등불 그림자에서 뺀다 (몸 바로 옆 광원 — 큐브 6면 비용만 들고 그림자가 어색하다)
      const casterOpts = { lantern: e.id !== this.hero.id };
      if (v instanceof ModelCharacterView) {
        const lod0 = v.model.meshes.filter((m) => m.name.endsWith("_LOD0"));
        this.gfx.shadows.addCaster(v.weaponMesh ? [...lod0, v.weaponMesh] : lod0, casterOpts);
        this.gfx.shadows.addReceiver(v.model.meshes);
      } else {
        this.gfx.shadows.addCaster([v.body, v.nose, v.weapon], casterOpts);
        this.gfx.shadows.addReceiver([v.body, v.nose, v.weapon]);
      }
    }
    return v;
  }

  private setDebug(on: boolean): void {
    this.physicsDebug.setEnabled(on);
    this.sweepDebug.setEnabled(on);
    this.gfx.regions.setDebugVisible(on);
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
      `성능     ${this.perf.describe()}`,
      `렌더     ${this.renderLine()}`,
      `상태     ${p?.state ?? "-"}${p?.action ? ` · ${p.action}` : ""}${p ? `  [${p.stateTick}]` : ""}`,
      `버퍼     ${p?.reserved ?? "-"}`,
      `체력     ${textBar(h.health / h.maxHealth)} ${h.health.toFixed(0)}`,
      `스태미나 ${textBar(h.stamina / h.maxStamina)} ${h.stamina.toFixed(0)}`,
      `락온     ${lockEntity ? `#${lockEntity.id} ${lockEntity.archetype} (${lockEntity.health.toFixed(0)})` : "-"}${!lockEntity && release ? `  해제: ${release}` : ""}`,
      `접지     ${this.characters.get(h.id)?.groundState ?? "-"}  트리거 ${this.inTrigger ? "안" : "밖"}`,
      `F3 물리 디버그 ${this.physicsDebug.enabled ? "켜짐" : "꺼짐"}  등불 ${this.lanternOn ? "켜짐" : "꺼짐"}  F4 그림자 필터 비교  F5 패스별 GPU 시간`,
      this.animLine(),
      `그림자   ${this.gfx.shadows.describe()}`,
      `후처리   ${this.gfx.postFx.describe()}`,
      `지역     ${this.gfx.regions.describe()}`,
      ...this.passTimer.lines(),
      `마우스   ${this.input.isPointerLocked ? "잠금됨 (Esc 해제)" : "화면 클릭 → 잠금"}  카메라 ${((this.camera.viewYaw * 180) / Math.PI).toFixed(0)}°`,
      "",
      ...this.eventLog,
    ]);
  }

  private renderLine(): string {
    const ri = this.options.renderInfo;
    const engine = this.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    const d = this.dynRes;
    const res = `해상도 ${Math.round(d.scale * 100)}%${d.settings.enabled ? ` 자동(목표 ${d.settings.targetFps}fps, 하한 ${Math.round(d.settings.minScale * 100)}%)` : ""}`;
    const size = `화면 ${canvas?.clientWidth ?? 0}×${canvas?.clientHeight ?? 0} → 렌더 ${engine.getRenderWidth()}×${engine.getRenderHeight()} (DPR ${dpr})`;
    const why = ri?.fallbackReason ? `  WebGPU 안 씀: ${ri.fallbackReason}` : "";
    return `${ri?.backend ?? "?"} · ${ri?.gpuName ?? "?"}${ri?.software ? " (소프트웨어!)" : ""} · ${size} · ${res} · ${this.adaptive.describe(this.gfx.quality.level)}${why}`;
  }

  private animLine(): string {
    const v = this.views.get(this.hero.id);
    if (!(v instanceof ModelCharacterView)) return "애니     (모델 없음 — 캡슐)";
    const d = v.animator.debug;
    return `애니     ${d.state ?? "-"}  x${d.rate.toFixed(2)}  포즈 ${v.poseMotion.toFixed(0)}°/s  ${d.weights}`;
  }

  dispose(): void {
    this.hitFeedback.dispose();
    this.perf.dispose();
    this.passTimer.dispose();
    this.panel.dispose();
    this.marker.dispose();
    this.lockHint.dispose();
    this.softwareNotice?.remove();
    this.sweepDebug.dispose();
    this.physicsDebug.dispose();
  }
}

/** hero.glb 로드 → 인스턴스 → 클립 → 무기 부착 → 소켓 궤적 굽기. 실패하면 null (캡슐로 계속 진행) */
async function loadHeroModel(scene: Scene, timelines: typeof PLAYER_TIMELINES): Promise<HeroModelParts | null> {
  try {
    const asset = await CharacterAsset.load(scene, HERO_PROFILE);
    const model = asset.instantiate("hero");
    const lib = new ClipLibrary(model.groups, HERO_PROFILE.name);
    const tracks = bakeSocketTracks(model, lib, HERO_PROFILE, timelines);
    const weapon = attachWeapon(scene, model, HERO_PROFILE);
    console.info(`[assets] ${HERO_PROFILE.glb}: 메시 ${model.meshes.length}개, 애니메이션 ${model.groups.length}개, 소켓 궤적 ${tracks.size}개`);
    return { model, lib, tracks, weapon };
  } catch (err) {
    console.error(`[assets] ${HERO_PROFILE.glb} 로드 실패 — 캡슐로 대체`, err);
    return null;
  }
}
