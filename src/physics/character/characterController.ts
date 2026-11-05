/**
 * 캡슐 캐릭터 컨트롤러 — Babylon PhysicsCharacterController 기반 + 셰이프캐스트 보강.
 *
 * Babylon 컨트롤러를 그대로 쓰는 부분:
 *  - 셰이프캐스트 기반 충돌 해결 (벽을 따라 미끄러지기, 캐릭터끼리 밀기)
 *  - 경사 한계 (maxSlopeCosine) 와 접지 판정 (checkSupport: SUPPORTED / SLIDING / UNSUPPORTED)
 *
 * 셰이프캐스트로 직접 구현한 부분 (Babylon 9.33 내장 기능이 이 게임 조건에서 동작하지 않아서):
 *  1. 계단/턱 오르기 — 내장 maxStepHeight는 스텝업 때 "이번 틱 수평 이동량"만큼만 앞으로 나간 뒤 아래로 캐스트한다.
 *     60Hz에서 틱당 이동량(걷기 3m/s ≈ 0.05m)은 캡슐 반경(0.35m)보다 훨씬 작아, 캡슐의 둥근 바닥이 아직 모서리 앞에 있고
 *     아래 캐스트가 모서리를 비스듬히(법선 y≈0.44) 맞혀 "걸을 수 없는 면"으로 거부된다 → 0.2m 계단도 못 오른다.
 *     그래서 내장 기능은 끄고, 막혔을 때 위 → 앞(반경만큼) → 아래 순서로 직접 탐색해 착지면이 걸을 수 있으면 들어 올린다.
 *  2. 지면 붙이기 — 낙하 후 솔버가 접촉 허용 거리 안에서 멈춰 발이 ~8cm 떠 있는 채로 접지 판정된다.
 *     접지 상태에서는 아래로 캐스트해 간격을 메우고, 계단/내리막을 내려갈 때도 땅에 붙인다.
 *
 * 그 위의 게임 규칙: 중력(공중/미끄러짐), 이동 모드 2가지(속도/루트 모션), 충돌 레이어.
 * 가파른 경사에서 오르막으로 못 가는 것은 Babylon 솔버의 최대 경사 제약이 처리한다.
 * 좌표는 발밑 중앙 (sim 엔티티 위치와 같은 기준).
 */
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { IPhysicsShapeCastQuery } from "@babylonjs/core/Physics/physicsShapeCastQuery";
import { ShapeCastResult } from "@babylonjs/core/Physics/shapeCastResult";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import {
  CharacterSupportedState,
  PhysicsCharacterController,
  type CharacterSurfaceInfo,
} from "@babylonjs/core/Physics/v2/characterController";
import type { LayerName } from "../layers";
import { applyLayer, type PhysicsWorld } from "../physicsWorld";

export const CHARACTER_DEFAULTS = {
  /** 오를 수 있는 최대 경사 (도) */
  maxSlopeDeg: 45,
  /** 자동으로 올라가는 최대 턱 높이 (m) — 계단 0.2m, 턱 0.25m는 오르고 0.5m 턱은 막힌다 */
  maxStepHeight: 0.35,
  /** 공중에서 입력이 수평 속도에 미치는 정도 (0=없음, 1=지상과 같음) */
  airControl: 0.15,
  /** 미끄러지는 동안 옆/내리막 입력의 가속도 배율 (1/s) */
  slideSteer: 3,
  /** 표면과 유지하는 간격 (m) — 발이 뜨어 보이는 간격. Babylon 기본 0.05 */
  keepDistance: 0.02,
  /** 막혔다고 보는 기준: 실제 수평 이동이 원하는 이동의 이 비율 미만 */
  blockedRatio: 0.5,
} as const;

export interface CharacterControllerOptions {
  height: number;
  radius: number;
  layer: Extract<LayerName, "PLAYER" | "ENEMY">;
  maxSlopeDeg?: number;
  maxStepHeight?: number;
}

export type GroundState = "grounded" | "sliding" | "airborne";

export interface FootPosition {
  x: number;
  y: number;
  z: number;
}

const DOWN = new Vector3(0, -1, 0);

export class CharacterController {
  readonly cc: PhysicsCharacterController;
  readonly height: number;
  readonly radius: number;
  readonly maxStepHeight: number;
  private readonly world: PhysicsWorld;
  private readonly gravity = new Vector3();
  private readonly support: CharacterSurfaceInfo = {
    isSurfaceDynamic: false,
    supportedState: CharacterSupportedState.UNSUPPORTED,
    averageSurfaceNormal: new Vector3(),
    averageSurfaceVelocity: new Vector3(),
    averageAngularSurfaceVelocity: new Vector3(),
  };
  private readonly velocity = new Vector3();
  private readonly desired = new Vector3();
  private readonly start = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly castFrom = new Vector3();
  private readonly castTo = new Vector3();
  private readonly probeA = new Vector3();
  private readonly probeB = new Vector3();
  private readonly castInput = new ShapeCastResult();
  private readonly castHit = new ShapeCastResult();
  private readonly query: IPhysicsShapeCastQuery;
  private state: GroundState = "airborne";
  private steppedThisTick = false;
  /**
   * 턱 위로 들어 올린 직후 남은 "턱 넘기" 거리 (m). 들어 올린 순간에는 캡슐 중심이 아직 모서리 앞이라
   * 아래에 지면이 없어 공중으로 판정되는데, 이 거리만큼 수평으로 나아갈 때까지는 중력을 멈추고 앞으로 미끄러뜨린다.
   */
  private stepHold = 0;
  /** 턱 넘기 중 유지할 캡슐 중심 높이 — 모서리를 타고 더 올라가지 않게 */
  private stepHoldY = 0;

  constructor(world: PhysicsWorld, foot: FootPosition, options: CharacterControllerOptions) {
    this.world = world;
    this.height = options.height;
    this.radius = options.radius;
    this.maxStepHeight = options.maxStepHeight ?? CHARACTER_DEFAULTS.maxStepHeight;
    const center = new Vector3(foot.x, foot.y + options.height / 2, foot.z);
    this.cc = new PhysicsCharacterController(center, { capsuleHeight: options.height, capsuleRadius: options.radius }, world.scene);
    this.cc.maxSlopeCosine = Math.cos(((options.maxSlopeDeg ?? CHARACTER_DEFAULTS.maxSlopeDeg) * Math.PI) / 180);
    this.cc.maxStepHeight = 0; // 내장 스텝업은 끄고 tryStepUp()으로 대신한다 (파일 머리말 참고)
    this.cc.keepDistance = CHARACTER_DEFAULTS.keepDistance;
    // 내부 바디와 셰이프가 같은 객체라 마스크가 컨트롤러의 셰이프캐스트와 다른 쿼리 모두에 적용된다
    applyLayer(this.cc.shape, options.layer);
    world.registerExternalBody(this.body, options.layer);
    this.query = {
      shape: this.cc.shape,
      rotation: Quaternion.Identity(),
      startPosition: this.castFrom,
      endPosition: this.castTo,
      shouldHitTriggers: false,
      ignoreBody: this.body,
    };
  }

  /** 컨트롤러 내부 캡슐 바디 — 다른 캐릭터/무기 판정이 이 바디와 부딪힌다 (피격 판정 형상) */
  get body(): PhysicsBody {
    // Babylon이 내부 바디를 공개하지 않아 요소 접근으로 꺼낸다 (Babylon 업데이트 시 tests/physics/character.test.ts가 감시)
    return this.cc["_body"];
  }

  get groundState(): GroundState {
    return this.state;
  }

  get grounded(): boolean {
    return this.state === "grounded";
  }

  /** 이번 틱에 계단/턱을 올랐는가 (렌더에서 수직 튐을 부드럽게 할 때 참고) */
  get stepped(): boolean {
    return this.steppedThisTick;
  }

  getVelocity(out: Vector3): Vector3 {
    return out.copyFrom(this.velocity);
  }

  getFootPosition(out: FootPosition): FootPosition {
    const p = this.cc.getPosition();
    out.x = p.x;
    out.y = p.y - this.height / 2;
    out.z = p.z;
    return out;
  }

  teleport(foot: FootPosition): void {
    this.tmp.set(foot.x, foot.y + this.height / 2, foot.z);
    this.cc.setPosition(this.tmp);
    this.velocity.setAll(0);
    this.cc.setVelocity(this.velocity);
    this.state = "airborne";
    this.stepHold = 0;
    this.syncBody();
  }

  /** 속도 모드: 원하는 수평 속도(m/s)로 걷는다 */
  moveVelocity(vx: number, vz: number, dt: number): void {
    this.step(vx, vz, dt, CHARACTER_DEFAULTS.airControl);
  }

  /** 루트 모션 모드: 이번 틱 수평 이동량(m)을 적용한다. 공중에서도 그대로 (구르다 떨어지는 경우) */
  moveRootMotion(dx: number, dz: number, dt: number): void {
    this.step(dx / dt, dz / dt, dt, 1);
  }

  dispose(): void {
    this.world.unregisterExternalBody(this.body);
    this.cc.dispose();
  }

  private step(vx: number, vz: number, dt: number, airControl: number): void {
    const s = this.support;
    this.steppedThisTick = false;
    this.cc.checkSupportToRef(dt, DOWN, s);
    const g = this.world.getGravity(this.gravity);
    const v = this.velocity;
    const d = this.desired.set(vx, 0, vz);
    const n = s.averageSurfaceNormal;
    const wasGrounded = this.state === "grounded";

    if (this.stepHold > 0) {
      // 턱 넘기 중: 높이를 유지한 채 원하는 방향으로 나아간다 (모서리 접촉은 무시)
      this.state = "grounded";
      v.set(d.x, 0, d.z);
    } else if (s.supportedState === CharacterSupportedState.SUPPORTED) {
      this.state = "grounded";
      // 원하는 속도를 지면 평면에 투영 (경사로를 따라 오르내림) 하고 수평 속력은 유지
      const speed = d.length();
      v.copyFrom(d).subtractInPlace(this.tmp.copyFrom(n).scaleInPlace(Vector3.Dot(d, n)));
      const len = v.length();
      if (len > 1e-6) v.scaleInPlace(speed / len);
      v.addInPlace(s.averageSurfaceVelocity);
    } else if (s.supportedState === CharacterSupportedState.SLIDING) {
      this.state = "sliding";
      // 너무 가파른 경사: 중력의 경사면 성분으로 미끄러진다
      const gSlope = this.tmp.copyFrom(g).subtractInPlace(this.tmp2.copyFrom(n).scaleInPlace(Vector3.Dot(g, n)));
      v.addInPlace(gSlope.scaleInPlace(dt));
      // 경사면을 파고드는 성분 제거
      const into = Vector3.Dot(v, n);
      if (into < 0) v.subtractInPlace(this.tmp.copyFrom(n).scaleInPlace(into));
      // 입력은 가속으로만 약하게 반영한다. 오르막 성분은 Babylon 솔버의 최대 경사 평면 제약이 막으므로
      // 따로 걸러내지 않는다 (tests/physics/character.test.ts "미끄러지는 동안 높이를 얻지 못한다"가 검증)
      v.x += d.x * CHARACTER_DEFAULTS.slideSteer * dt;
      v.z += d.z * CHARACTER_DEFAULTS.slideSteer * dt;
    } else {
      this.state = "airborne";
      v.x += (d.x - v.x) * airControl;
      v.z += (d.z - v.z) * airControl;
      v.y += g.y * dt;
    }

    this.start.copyFrom(this.cc.getPosition());
    this.cc.setVelocity(v);
    this.cc.integrate(dt, s, g);
    this.velocity.copyFrom(this.cc.getVelocity());

    if (this.state === "grounded") {
      const want = Math.hypot(d.x, d.z) * dt;
      const p = this.cc.getPosition();
      const achieved = Math.hypot(p.x - this.start.x, p.z - this.start.z);
      if (this.stepHold > 0) {
        // 턱 넘기 진행. 막혔거나 입력이 끊기면 중단 (다음 틱부터 정상 판정)
        this.stepHold = want > 1e-4 && achieved > want * CHARACTER_DEFAULTS.blockedRatio ? this.stepHold - achieved : 0;
        // 솔버가 모서리를 경사처럼 타고 올라가 높이가 넘치면 되돌린다 (넘친 뒤 내려앉는 덜컹거림 방지)
        if (p.y > this.stepHoldY) {
          this.tmp.set(p.x, this.stepHoldY, p.z);
          this.cc.setPosition(this.tmp);
        }
      } else if (want > 1e-4 && achieved < want * CHARACTER_DEFAULTS.blockedRatio) {
        // 계단/턱: 원하는 만큼 못 갔으면 올라설 수 있는지 탐색
        this.steppedThisTick = this.tryStepUp(d.x * dt / want, d.z * dt / want);
        if (this.steppedThisTick) {
          this.stepHold = this.radius + 0.05;
          this.stepHoldY = this.cc.getPosition().y;
        }
      }
      // 지면 붙이기: 막 착지했으면 접촉 간격만, 계속 걷는 중이면 계단 하나 높이까지 끌어내린다 (턱 넘기 중에는 안 함)
      if (!this.steppedThisTick && this.stepHold <= 0) this.snapToGround(wasGrounded ? this.maxStepHeight : this.cc.keepContactTolerance + 0.05);
    }
    this.syncBody();
  }

  /** 캡슐 셰이프캐스트 (자기 바디 제외). 맞으면 이동 비율 0~1, 아니면 -1. 법선은 castHit.hitNormal */
  private cast(from: Vector3, to: Vector3): number {
    this.castFrom.copyFrom(from);
    this.castTo.copyFrom(to);
    this.world.plugin.shapeCast(this.query, this.castInput, this.castHit);
    return this.castHit.hasHit ? this.castHit.hitFraction : -1;
  }

  /**
   * 위 → 앞 → 아래 탐색으로 올라설 턱을 찾는다. 착지면이 걸을 수 있고 높이가 maxStepHeight 이하면
   * 수평 위치는 그대로 두고 그만큼 들어 올린다 (다음 틱 이동에서 둥근 바닥이 모서리 위로 넘어간다).
   */
  private tryStepUp(dirX: number, dirZ: number): boolean {
    const keep = this.cc.keepDistance;
    const maxStep = this.maxStepHeight;
    const c = this.tmp.copyFrom(this.cc.getPosition());

    // 1. 위: 머리 위 공간
    const up = this.tmp2.copyFrom(c);
    up.y += maxStep;
    const fUp = this.cast(c, up);
    const clear = fUp < 0 ? maxStep : Math.max(0, fUp * maxStep - keep);
    if (clear < 0.05) return false;

    // 2. 앞: 들어 올린 높이에서 반경만큼 (둥근 바닥이 모서리를 넘을 만큼) 나아갈 수 있는가
    const raised = this.tmp2.copyFrom(c);
    raised.y += clear;
    const probe = this.radius;
    const ahead = this.probeA.set(raised.x + dirX * probe, raised.y, raised.z + dirZ * probe);
    const fFwd = this.cast(raised, ahead);
    if (fFwd >= 0 && fFwd * probe < this.radius * 0.5) return false; // 들어 올려도 벽 — 높은 턱
    const adv = fFwd < 0 ? probe : fFwd * probe - keep;

    // 3. 아래: 착지면 찾기
    const fwdPos = ahead.set(raised.x + dirX * adv, raised.y, raised.z + dirZ * adv);
    const downDist = clear + 0.05;
    const below = this.probeB.set(fwdPos.x, fwdPos.y - downDist, fwdPos.z);
    const fDown = this.cast(fwdPos, below);
    if (fDown < 0) return false; // 아래가 비어 있음 (난간 너머 등)
    if (this.castHit.hitNormal.y < this.cc.maxSlopeCosine) return false; // 착지면이 걸을 수 없는 경사
    const landY = fwdPos.y - (fDown * downDist - keep);
    const rise = landY - c.y;
    if (rise < 0.01 || rise > maxStep + 1e-3) return false;

    c.y += rise;
    this.cc.setPosition(c);
    return true;
  }

  /** 아래로 캐스트해 지면과의 간격을 keepDistance로 맞춘다 (최대 maxDrop) */
  private snapToGround(maxDrop: number): void {
    const keep = this.cc.keepDistance;
    const c = this.tmp.copyFrom(this.cc.getPosition());
    const to = this.tmp2.copyFrom(c);
    to.y -= maxDrop;
    const f = this.cast(c, to);
    if (f < 0 || this.castHit.hitNormal.y < this.cc.maxSlopeCosine) return;
    const drop = f * maxDrop - keep;
    if (drop <= 1e-3) return;
    c.y -= drop;
    this.cc.setPosition(c);
    if (this.velocity.y < 0) this.velocity.y = 0;
  }

  /** 같은 틱의 다른 쿼리(무기 스윕 등)가 새 위치를 보도록 내부 바디 변환을 즉시 반영한다 */
  private syncBody(): void {
    const body = this.body;
    this.world.plugin.setPhysicsBodyTransformation(body, body.transformNode);
  }
}
