/**
 * 락온 Babylon 연결: sim 적 엔티티를 화면에 투영하고, 카메라→대상 시야를 레이캐스트해
 * LockOnController에 후보로 넘긴다. 마커 UI 위치도 여기서 계산한다.
 */
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PhysicsRaycastResult, type IRaycastQuery } from "@babylonjs/core/Physics/physicsRaycastResult";
import type { Scene } from "@babylonjs/core/scene";
import { LAYER } from "../../physics/layers";
import type { PhysicsWorld } from "../../physics/physicsWorld";
import { ARCHETYPES } from "../../sim/data/archetypes";
import { isDead, type EntityId } from "../../sim/entity";
import type { SimWorld } from "../../sim/world";
import { LockOnController, type LockCandidate } from "./lockOn";

/** 조준점: 키의 이 비율 높이 (가슴) */
export const CHEST_HEIGHT_RATIO = 0.65;

export type PositionLookup = (id: EntityId) => Readonly<{ x: number; y: number; z: number }> | null;

export interface MarkerPosition {
  visible: boolean;
  /** 캔버스 픽셀 좌표 */
  x: number;
  y: number;
}

export class LockOnSystem {
  readonly controller = new LockOnController();
  private readonly candidates: LockCandidate[] = [];
  private readonly pool: LockCandidate[] = [];
  private readonly chest = new Vector3();
  private readonly ndc = new Vector3();
  private readonly viewPos = new Vector3();
  private readonly ray = new PhysicsRaycastResult();
  private readonly rayQuery: IRaycastQuery = { membership: LAYER.PLAYER, collideWith: LAYER.ENVIRONMENT, shouldHitTriggers: false };
  private readonly viewProj = new Matrix();

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly physics: PhysicsWorld,
    private readonly sim: SimWorld,
    private readonly playerId: EntityId,
    /** 렌더 보간 위치 (발밑) */
    private readonly positionOf: PositionLookup,
  ) {}

  get targetId(): EntityId | null {
    return this.controller.target;
  }

  /** 락온 버튼 */
  toggle(): EntityId | null {
    this.refresh();
    return this.controller.toggle(this.candidates);
  }

  /** 렌더 프레임마다 (카메라 갱신 후): 후보 갱신 → 해제/전환 판정 */
  update(dt: number, lookX: number): void {
    this.refresh();
    this.controller.update(dt, this.candidates, lookX);
  }

  /** 대상의 조준점(가슴) 월드 위치. 대상이 없으면 null */
  targetChest(out: { x: number; y: number; z: number }): typeof out | null {
    const id = this.controller.target;
    if (id === null) return null;
    return this.chestOf(id, out) ? out : null;
  }

  /** 마커 UI 위치 */
  marker(out: MarkerPosition): MarkerPosition {
    out.visible = false;
    const id = this.controller.target;
    if (id === null || !this.chestOf(id, this.chest)) return out;
    if (!this.project(this.chest)) return out;
    const engine = this.scene.getEngine();
    out.x = ((this.ndc.x + 1) / 2) * engine.getRenderWidth();
    out.y = ((1 - this.ndc.y) / 2) * engine.getRenderHeight();
    out.visible = true;
    return out;
  }

  private chestOf(id: EntityId, out: { x: number; y: number; z: number }): boolean {
    const e = this.sim.get(id);
    const p = this.positionOf(id);
    if (!e || !p) return false;
    out.x = p.x;
    out.y = p.y + ARCHETYPES[e.archetype].height * CHEST_HEIGHT_RATIO;
    out.z = p.z;
    return true;
  }

  /** 월드 → 정규화 화면 좌표 (this.ndc). 카메라 앞이면 true */
  private project(world: Vector3): boolean {
    Vector3.TransformCoordinatesToRef(world, this.camera.getViewMatrix(), this.viewPos);
    if (this.viewPos.z <= 0.01) return false;
    this.camera.getViewMatrix().multiplyToRef(this.camera.getProjectionMatrix(), this.viewProj);
    Vector3.TransformCoordinatesToRef(world, this.viewProj, this.ndc);
    return true;
  }

  private refresh(): void {
    this.candidates.length = 0;
    const self = this.sim.get(this.playerId);
    if (!self) return;
    const selfPos = this.positionOf(this.playerId) ?? self.position;
    let n = 0;
    for (const e of this.sim.entities) {
      if (e.team === self.team || isDead(e) || !this.chestOf(e.id, this.chest)) continue;
      let c = this.pool[n];
      if (!c) {
        c = { id: 0, screenX: 0, screenY: 0, inFront: false, distance: 0, visible: false };
        this.pool.push(c);
      }
      n++;
      c.id = e.id;
      c.inFront = this.project(this.chest);
      c.screenX = c.inFront ? this.ndc.x : 2;
      c.screenY = c.inFront ? this.ndc.y : 2;
      c.distance = Math.hypot(this.chest.x - selfPos.x, this.chest.z - selfPos.z);
      // 시야: 카메라 → 가슴 사이 환경 레이캐스트
      this.physics.plugin.raycast(this.camera.globalPosition, this.chest, this.ray, this.rayQuery);
      c.visible = !this.ray.hasHit;
      this.candidates.push(c);
    }
  }
}
