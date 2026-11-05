/**
 * 전투 판정 타입과 HitQuery 포트.
 *
 * sim은 실제 셰이프캐스트를 하지 않는다. 무기 궤적은 애니메이션(본 위치)이 정하고, 충돌 검사는 물리 엔진이 한다.
 * 그래서 "이번 틱에 이 공격의 판정 캡슐이 누구와 겹쳤는가"만 HitQuery로 물어보고,
 * 그 결과를 받아 규칙(i-frame, 가드, 패리, 백어택, 피해)을 적용하는 것까지가 sim의 몫이다.
 * 클라이언트는 physics/의 Havok 구현을, 서버/테스트는 순수 TS 구현을 주입한다.
 */
import type { AttackDef, AttackId } from "../data/attacks";
import type { Entity, EntityId } from "../entity";
import type { Vec3 } from "../math/vec3";

/** 공격 1회 (콤보의 각 타격이 각각 하나의 인스턴스) */
export interface AttackInstance {
  id: number;
  attackerId: EntityId;
  attack: AttackId;
  startTick: number;
  /** 판정 활성 구간인가 (애니메이션 hit_start ~ hit_end) */
  active: boolean;
  /** 이 공격에 이미 맞은 대상 — 같은 공격으로 두 번 맞지 않는다 */
  hitList: Set<EntityId>;
}

export interface SweepRequest {
  attacker: Readonly<Entity>;
  instance: Readonly<AttackInstance>;
  def: Readonly<AttackDef>;
  /** 현재 sim 틱 */
  tick: number;
}

export interface HitCandidate {
  target: EntityId;
  /** 판정 캡슐과 대상이 처음 닿은 지점 (월드 좌표) */
  point: Vec3;
}

export interface HitQuery {
  /**
   * 이번 틱 동안 무기 판정 캡슐(반경 def.hitbox.radius)이 직전 위치 → 현재 위치로 스윕하며 겹친 엔티티를 out에 넣는다.
   * 필터링(자기 자신, 같은 팀, 이미 맞음, 무적)은 sim이 하므로 구현은 겹친 것을 모두 넣으면 된다. 순서는 상관없다.
   */
  sweep(request: Readonly<SweepRequest>, out: HitCandidate[]): void;
}

/** 아무것도 맞지 않는 기본 구현 (물리가 주입되기 전) */
export const NO_HITS: HitQuery = { sweep: () => {} };

export type HitOutcome = "ignored" | "dodged" | "hit" | "guard" | "guard_break" | "parry";
