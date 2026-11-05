/**
 * Havok(Physics V2) 래퍼.
 *
 * - 물리 스텝은 Babylon의 렌더 프레임 자동 진행을 끄고, 게임 루프 고정 스텝(60Hz)에서 step()으로 직접 진행한다.
 *   (CLAUDE.md 원칙 2: sim과 물리가 같은 박자로 움직인다)
 * - 모든 바디는 충돌 레이어(layers.ts)를 받아 셰이프 필터 마스크를 설정한다.
 * - TRIGGER 레이어는 isTrigger 셰이프로 만들어 충돌 응답 없이 오버랩 이벤트만 낸다.
 */
import { Observable } from "@babylonjs/core/Misc/observable";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PhysicsEventType, PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import type { PhysicsShape } from "@babylonjs/core/Physics/v2/physicsShape";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import type { Scene } from "@babylonjs/core/scene";
// 사이드이펙트 임포트: Babylon 9에서는 scene.enablePhysics가 이 모듈에서 등록된다.
// 빠뜨리면 아무 일도 하지 않는 자리표시 함수가 호출되어 "No Physics Engine available" 오류가 난다.
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";
import { loadHavok, type HavokInstance } from "./havok";
import { LAYER, LAYER_NAMES, collideMaskOf, isOverlapOnly, membershipOf, type LayerName } from "./layers";

export const PHYSICS_STEP = 1 / 60;

export interface PhysicsWorldOptions {
  /** 중력 (m/s²). 기본 (0, -9.81, 0) */
  gravity?: Vector3;
  /** 이미 로드한 Havok 인스턴스 (테스트/서버). 없으면 loadHavok() */
  havok?: HavokInstance;
}

export type BodyMotion = "static" | "animated" | "dynamic";

const MOTION: Record<BodyMotion, PhysicsMotionType> = {
  static: PhysicsMotionType.STATIC,
  animated: PhysicsMotionType.ANIMATED,
  dynamic: PhysicsMotionType.DYNAMIC,
};

export interface CreateBodyOptions {
  layer: LayerName;
  shape: PhysicsShape;
  /** 기본: static */
  motion?: BodyMotion;
  /** dynamic 바디 질량 (kg) */
  mass?: number;
}

export interface TriggerEvent {
  trigger: PhysicsBody;
  other: PhysicsBody;
  otherLayer: LayerName | null;
}

/** 셰이프에 레이어 마스크를 적용한다 (오버랩 전용 레이어면 트리거로) */
export function applyLayer(shape: PhysicsShape, layer: LayerName): void {
  shape.filterMembershipMask = membershipOf(layer);
  shape.filterCollideMask = collideMaskOf(layer);
  shape.isTrigger = isOverlapOnly(layer);
}

/** 셰이프의 membership 마스크로 레이어를 알아낸다 (래퍼 밖에서 만든 바디 분류용) */
export function layerOfShape(shape: PhysicsShape | null): LayerName | null {
  if (!shape) return null;
  const m = shape.filterMembershipMask;
  for (const name of LAYER_NAMES) if (m === LAYER[name]) return name;
  return null;
}

/**
 * Havok 네이티브 바디 id. Babylon이 공개 API로 노출하지 않아 _pluginData에서 읽는다
 * (Babylon 자체 캐릭터 컨트롤러도 같은 방식). 형식이 바뀌면 null — tests/physics/가 감시한다.
 */
export function nativeBodyId(body: PhysicsBody): bigint | null {
  const data: unknown = body._pluginData;
  if (typeof data !== "object" || data === null || !("hpBodyId" in data)) return null;
  const hp: unknown = data.hpBodyId;
  if (!Array.isArray(hp)) return null;
  const id: unknown = hp[0];
  return typeof id === "bigint" ? id : null;
}

export class PhysicsWorld {
  readonly onTriggerEnter = new Observable<TriggerEvent>();
  readonly onTriggerExit = new Observable<TriggerEvent>();
  /** 래퍼로 바디가 추가/제거될 때 (디버그 뷰 갱신용) */
  readonly onBodiesChanged = new Observable<void>();

  private readonly layers = new Map<PhysicsBody, LayerName>();
  /** Havok 네이티브 바디 id → 바디 (네이티브 쿼리 결과를 바디로 되돌릴 때) */
  private readonly byNativeId = new Map<bigint, PhysicsBody>();

  private constructor(
    readonly scene: Scene,
    readonly plugin: HavokPlugin,
    readonly engine: PhysicsEngine,
  ) {
    plugin.onTriggerCollisionObservable.add((e) => {
      // 이벤트의 collider/collidedAgainst 중 어느 쪽이 트리거인지는 정해져 있지 않다 → 레이어로 판별
      const a = e.collider;
      const b = e.collidedAgainst;
      const aTrig = this.isTrigger(a);
      const trigger = aTrig ? a : b;
      const other = aTrig ? b : a;
      if (!this.isTrigger(trigger)) return;
      const ev: TriggerEvent = { trigger, other, otherLayer: this.layerOf(other) };
      if (e.type === PhysicsEventType.TRIGGER_ENTERED) this.onTriggerEnter.notifyObservers(ev);
      else if (e.type === PhysicsEventType.TRIGGER_EXITED) this.onTriggerExit.notifyObservers(ev);
    });
  }

  /** Havok을 로드하고 씬에 Physics V2를 켠다. 렌더 프레임 자동 스텝은 끈다. */
  static async create(scene: Scene, options: PhysicsWorldOptions = {}): Promise<PhysicsWorld> {
    const havok = options.havok ?? (await loadHavok());
    const plugin = new HavokPlugin(false, havok);
    const gravity = options.gravity ?? new Vector3(0, -9.81, 0);
    if (!scene.enablePhysics(gravity, plugin)) throw new Error("Physics V2 활성화에 실패했습니다.");
    const engine = scene.getPhysicsEngine();
    if (!engine || engine.getPluginVersion() !== 2) throw new Error("Physics V2 엔진을 찾을 수 없습니다.");
    // 렌더 루프의 가변 시간 물리 진행을 끈다 — step()에서만 진행
    scene.physicsEnabled = false;
    return new PhysicsWorld(scene, plugin, engine as PhysicsEngine);
  }

  /** 고정 스텝 진행 (게임 루프 fixedUpdate에서 호출) */
  step(dt = PHYSICS_STEP): void {
    this.scene.onBeforePhysicsObservable.notifyObservers(this.scene);
    this.engine._step(dt);
    this.scene.onAfterPhysicsObservable.notifyObservers(this.scene);
  }

  createBody(node: TransformNode, options: CreateBodyOptions): PhysicsBody {
    const motion = options.motion ?? "static";
    const body = new PhysicsBody(node, MOTION[motion], false, this.scene);
    applyLayer(options.shape, options.layer);
    body.shape = options.shape;
    if (motion === "dynamic") body.setMassProperties({ mass: options.mass ?? 1 });
    // animated 바디는 매 스텝 노드 위치를 따라간다 (게임 로직이 노드를 움직임)
    if (motion === "animated") body.disablePreStep = false;
    this.track(body, options.layer);
    return body;
  }

  /** 래퍼 밖에서 만든 바디(캐릭터 컨트롤러 내부 바디 등)를 레이어와 함께 등록한다 */
  registerExternalBody(body: PhysicsBody, layer: LayerName): void {
    this.track(body, layer);
  }

  unregisterExternalBody(body: PhysicsBody): void {
    this.untrack(body);
  }

  /** Havok 네이티브 바디 id로 바디를 찾는다 (등록된 바디만) */
  bodyFromNativeId(id: bigint): PhysicsBody | undefined {
    return this.byNativeId.get(id);
  }

  getGravity(out: Vector3): Vector3 {
    return out.copyFrom(this.engine.gravity);
  }

  private track(body: PhysicsBody, layer: LayerName): void {
    this.layers.set(body, layer);
    const id = nativeBodyId(body);
    if (id !== null) this.byNativeId.set(id, body);
    this.onBodiesChanged.notifyObservers();
  }

  private untrack(body: PhysicsBody): void {
    this.layers.delete(body);
    const id = nativeBodyId(body);
    if (id !== null) this.byNativeId.delete(id);
    this.onBodiesChanged.notifyObservers();
  }

  /**
   * 트리거 영역 (플레이어 진입/이탈 감지). 충돌 응답은 없다.
   * @param motion 움직이는 트리거면 "animated" (기본 static)
   */
  createTrigger(node: TransformNode, shape: PhysicsShape, motion: Exclude<BodyMotion, "dynamic"> = "static"): PhysicsBody {
    return this.createBody(node, { layer: "TRIGGER", shape, motion });
  }

  removeBody(body: PhysicsBody): void {
    this.untrack(body);
    body.dispose();
  }

  /** 래퍼로 만든 바디는 등록된 레이어, 그 외(예: 캐릭터 컨트롤러 내부 바디)는 셰이프 마스크로 판별 */
  layerOf(body: PhysicsBody): LayerName | null {
    return this.layers.get(body) ?? layerOfShape(body.shape);
  }

  isTrigger(body: PhysicsBody): boolean {
    return this.layerOf(body) === "TRIGGER";
  }

  /** 엔진에 있는 모든 바디 */
  getBodies(): readonly PhysicsBody[] {
    return this.engine.getBodies();
  }

  dispose(): void {
    this.onTriggerEnter.clear();
    this.onTriggerExit.clear();
    this.onBodiesChanged.clear();
    this.layers.clear();
    this.byNativeId.clear();
    this.scene.disablePhysicsEngine();
  }
}
