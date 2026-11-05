/**
 * 엔티티: 플레이어/적 공통 상태. 순수 데이터(평범한 객체)만 담아 그대로 직렬화할 수 있게 한다.
 * 로직은 stats/ 등 별도 모듈의 함수가 다룬다.
 */
import { ARCHETYPES, type ArchetypeId } from "./data/archetypes";
import { vec3, type ReadonlyVec3, type Vec3 } from "./math/vec3";

export type EntityId = number;

export type Team = "player" | "enemy" | "neutral";

export const TEAMS: readonly Team[] = ["player", "enemy", "neutral"];

/** 상태 플래그 (비트마스크) */
export const FLAG = {
  /** 사망 — 모든 행동/회복/피해 무시 */
  DEAD: 1 << 0,
  /** 강인도 붕괴 경직 중 — 행동 불가 */
  STAGGERED: 1 << 1,
  /** 가드 중 — 스태미나 회복 감소 */
  GUARDING: 1 << 2,
  /** 스프린트 중 — 스태미나 지속 소모 */
  SPRINTING: 1 << 3,
  /** 무적 (구르기 i-frame 등) — 피해 무시 */
  INVULNERABLE: 1 << 4,
  /** 슈퍼아머 (강공격 등) — 강인도 피해 감소 */
  SUPER_ARMOR: 1 << 5,
  /** 패리 윈도우 — 이 동안 정면에서 패리 가능한 공격을 받으면 상대가 경직된다 (액션/애니메이션이 켜고 끈다) */
  PARRY: 1 << 6,
} as const;

export type FlagName = keyof typeof FLAG;

/** 정의된 모든 플래그 비트 (역직렬화 검증용) */
export const ALL_FLAGS = Object.values(FLAG).reduce((a, b) => a | b, 0);

export interface Entity {
  id: EntityId;
  archetype: ArchetypeId;
  team: Team;

  /** 발밑 중앙 (m) */
  position: Vec3;
  /** 바라보는 방향 (라디안, +Z=0, +X 쪽으로 증가) */
  yaw: number;

  health: number;
  maxHealth: number;

  stamina: number;
  maxStamina: number;
  /** 남은 스태미나 회복 지연 (틱) */
  staminaRegenDelay: number;

  poise: number;
  maxPoise: number;
  /** 남은 강인도 회복 지연 (틱) */
  poiseRegenDelay: number;
  /** 남은 경직 시간 (틱) */
  staggerTicks: number;

  /** FLAG 비트마스크 */
  flags: number;
}

export function createEntity(id: EntityId, archetype: ArchetypeId, team: Team, position: ReadonlyVec3, yaw = 0): Entity {
  const a = ARCHETYPES[archetype];
  return {
    id,
    archetype,
    team,
    position: vec3(position.x, position.y, position.z),
    yaw,
    health: a.maxHealth,
    maxHealth: a.maxHealth,
    stamina: a.maxStamina,
    maxStamina: a.maxStamina,
    staminaRegenDelay: 0,
    poise: a.maxPoise,
    maxPoise: a.maxPoise,
    poiseRegenDelay: 0,
    staggerTicks: 0,
    flags: 0,
  };
}

export function hasFlag(e: Readonly<Entity>, flag: number): boolean {
  return (e.flags & flag) !== 0;
}

export function setFlag(e: Entity, flag: number, on: boolean): void {
  e.flags = on ? e.flags | flag : e.flags & ~flag;
}

export function isDead(e: Readonly<Entity>): boolean {
  return (e.flags & FLAG.DEAD) !== 0;
}

export function isStaggered(e: Readonly<Entity>): boolean {
  return (e.flags & FLAG.STAGGERED) !== 0;
}

/** 행동 가능한 상태인가 (스태미나와 무관한 조건: 사망/경직 아님) */
export function isActionable(e: Readonly<Entity>): boolean {
  return (e.flags & (FLAG.DEAD | FLAG.STAGGERED)) === 0;
}
