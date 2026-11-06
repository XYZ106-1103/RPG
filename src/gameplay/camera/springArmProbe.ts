/**
 * 스프링 암 셰이프캐스트: 기준점(캐릭터 어깨)에서 원하는 카메라 위치까지 구를 쏴서
 * 환경(ENVIRONMENT)에 막히는 거리를 구한다. 캐릭터/트리거는 무시한다.
 */
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { IPhysicsShapeCastQuery } from "@babylonjs/core/Physics/physicsShapeCastQuery";
import { ShapeCastResult } from "@babylonjs/core/Physics/shapeCastResult";
import { PhysicsShapeSphere } from "@babylonjs/core/Physics/v2/physicsShape";
import { LAYER } from "../../physics/layers";
import type { PhysicsWorld } from "../../physics/physicsWorld";

export class SpringArmProbe {
  private readonly shape: PhysicsShapeSphere;
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private readonly inputHit = new ShapeCastResult();
  private readonly hit = new ShapeCastResult();
  private readonly query: IPhysicsShapeCastQuery;

  constructor(
    private readonly world: PhysicsWorld,
    /** 카메라 구 반경 (m) — 근평면이 벽을 뚫지 않을 만큼 */
    readonly radius = 0.25,
  ) {
    this.shape = new PhysicsShapeSphere(Vector3.Zero(), radius, world.scene);
    // 환경만 본다: membership은 PLAYER(환경이 받아 주는 레이어), collide는 ENVIRONMENT만 → 캐릭터/투사체 무시
    this.shape.filterMembershipMask = LAYER.PLAYER;
    this.shape.filterCollideMask = LAYER.ENVIRONMENT;
    this.query = { shape: this.shape, rotation: Quaternion.Identity(), startPosition: this.from, endPosition: this.to, shouldHitTriggers: false };
  }

  /**
   * from → to 사이에서 막히는 거리 (m). 막히지 않으면 null.
   * 반환값은 구 중심이 멈출 수 있는 거리 (벽과 반경만큼 떨어진 위치)
   */
  cast(from: Readonly<{ x: number; y: number; z: number }>, to: Readonly<{ x: number; y: number; z: number }>): number | null {
    this.from.set(from.x, from.y, from.z);
    this.to.set(to.x, to.y, to.z);
    const len = Vector3.Distance(this.from, this.to);
    if (len < 1e-4) return null;
    this.world.plugin.shapeCast(this.query, this.inputHit, this.hit);
    if (!this.hit.hasHit) return null;
    return this.hit.hitFraction * len;
  }

  dispose(): void {
    this.shape.dispose();
  }
}
