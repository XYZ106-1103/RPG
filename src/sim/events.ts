/**
 * sim → render 이벤트 맵 (CLAUDE.md 아키텍처 원칙 3: 이벤트 기반 연결).
 * 이벤트 이름 → 페이로드 타입. core/eventBus.ts의 EventBus<GameEventMap>로 사용한다.
 *
 * sim이 정의하므로 Babylon 타입을 쓰지 않는다. 페이로드는 나중에 네트워크로 보낼 수 있도록
 * 직렬화 가능한 평범한 객체(숫자 id, {x,y,z})만 담는다.
 *
 * TODO: 지금은 자리만 잡아 둔 상태. 전투/AI 구현 시 필드를 확정하고 이벤트를 추가한다.
 */

import type { EntityId } from "./entity";
import type { Vec3 } from "./math/vec3";

export type { EntityId };

export interface AttackStartEvent {
  attacker: EntityId;
  /** 애니메이션 이름 규칙의 공격 이름 (attack_light_1 등) */
  attack: string;
}

export interface HitEvent {
  attacker: EntityId;
  target: EntityId;
  damage: number;
  /** 타격 지점 (월드 좌표) — 이펙트/카메라 셰이크 기준 */
  point: Vec3;
  /** 가드로 막았는가 */
  blocked: boolean;
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

export interface GameEventMap {
  attack_start: AttackStartEvent;
  hit: HitEvent;
  death: DeathEvent;
  /** 강인도 붕괴로 경직 시작 */
  stagger: StaggerEvent;
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
