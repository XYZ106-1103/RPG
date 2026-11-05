/**
 * sim → render 이벤트 맵 (CLAUDE.md 아키텍처 원칙 3: 이벤트 기반 연결).
 * 이벤트 이름 → 페이로드 타입. core/eventBus.ts의 EventBus<GameEventMap>로 사용한다.
 *
 * sim이 정의하므로 Babylon 타입을 쓰지 않는다. 페이로드는 나중에 네트워크로 보낼 수 있도록
 * 직렬화 가능한 평범한 객체(숫자 id, {x,y,z})만 담는다.
 *
 * TODO: AI/아이템 구현 시 이벤트를 추가한다.
 */

import type { EntityId } from "./entity";
import type { Vec3 } from "./math/vec3";

export type { EntityId };

export interface AttackStartEvent {
  attacker: EntityId;
  /** 공격 데이터 id (data/attacks.ts) */
  attack: string;
  /** 공격 인스턴스 id */
  instance: number;
}

export interface HitEvent {
  attacker: EntityId;
  target: EntityId;
  attack: string;
  /** 실제로 깎인 체력 */
  damage: number;
  /** 타격 지점 (월드 좌표) — 이펙트/카메라 셰이크 기준 */
  point: Vec3;
  /** 등 뒤에서 맞았는가 (피격 리액션 hit_back, 가드/패리 불가) */
  backAttack: boolean;
  /** 히트스톱 프레임 (2~4) */
  hitstopFrames: number;
  /** 넉백 속도 벡터 (m/s, 수평) */
  knockback: Vec3;
  /** 이 공격으로 강인도가 붕괴했는가 */
  staggered: boolean;
  /** 이 공격으로 사망했는가 (뒤이어 death 이벤트가 온다) */
  killed: boolean;
}

export interface GuardEvent {
  attacker: EntityId;
  /** 가드한 쪽 */
  target: EntityId;
  attack: string;
  /** 가드를 뚫고 들어온 체력 피해 */
  chipDamage: number;
  /** 깎인 스태미나 */
  staminaDamage: number;
  /** 스태미나가 바닥나 가드가 깨졌는가 (가드한 쪽이 경직된다) */
  broken: boolean;
  point: Vec3;
  hitstopFrames: number;
  knockback: Vec3;
}

export interface ParryEvent {
  /** 패리에 성공한 쪽 */
  parrier: EntityId;
  /** 패리당해 경직된 공격자 */
  attacker: EntityId;
  attack: string;
  point: Vec3;
}

export interface DeathEvent {
  entity: EntityId;
  killer: EntityId | null;
}

export interface StaggerEvent {
  entity: EntityId;
  /** 경직 지속 (틱) */
  durationTicks: number;
}

export interface StateChangeEvent {
  entity: EntityId;
  from: string;
  to: string;
  /** 행동 상태면 행동 id (attack_light_2, roll 등) — 애니메이션 선택용 */
  action: string | null;
}

export interface ActionRejectedEvent {
  entity: EntityId;
  action: string;
  /** stamina: 스태미나 부족 / no_flask: 회복약 없음 */
  reason: "stamina" | "no_flask";
}

export interface HealEvent {
  entity: EntityId;
  amount: number;
}

export interface GameEventMap {
  attack_start: AttackStartEvent;
  hit: HitEvent;
  guard: GuardEvent;
  parry: ParryEvent;
  death: DeathEvent;
  /** 강인도 붕괴로 경직 시작 */
  stagger: StaggerEvent;
  /** 행동 상태 전이 (애니메이션 상태 머신이 따라간다) */
  state_change: StateChangeEvent;
  /** 입력은 들어왔지만 실행하지 못한 행동 (UI: 스태미나 바 깜빡임 등) */
  action_rejected: ActionRejectedEvent;
  heal: HealEvent;
}

/** sim이 쌓아 두는 이벤트 레코드 (틱 번호 포함 — 리플레이/네트워크 순서 보장) */
export type SimEvent = {
  [K in keyof GameEventMap]: { tick: number; type: K; payload: GameEventMap[K] };
}[keyof GameEventMap];

/** 스탯 함수들이 이벤트를 내보내는 대상 (SimWorld가 구현) */
export interface EventSink {
  emit<K extends keyof GameEventMap>(type: K, payload: GameEventMap[K]): void;
}

export type GameEventName = keyof GameEventMap;
