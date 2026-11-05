/**
 * sim 상태 직렬화/역직렬화 (멀티플레이 스냅샷, 리플레이 저장, 디버그 덤프).
 *
 * 형식: 버전이 붙은 JSON 호환 평범한 객체. JS 숫자는 JSON 왕복 시 비트 단위로 보존되므로
 * 역직렬화한 월드를 같은 입력으로 진행하면 원본과 같은 결과가 나온다.
 * 외부(네트워크/파일)에서 온 데이터이므로 역직렬화 시 모든 필드를 검증한다.
 */
import type { AttackInstanceState, CombatState } from "./combat/system";
import { isArchetypeId } from "./data/archetypes";
import { isAttackId } from "./data/attacks";
import { PLAYER_ACTIONS, type PlayerActionId } from "./data/playerTimelines";
import { PLAYER_STATES, PLAYER_VERBS, type PlayerState, type PlayerStateId, type PlayerVerb } from "./player/types";
import { ALL_FLAGS, TEAMS, type Entity, type Team } from "./entity";
import { SimWorld, type SimWorldOptions, type WorldState } from "./world";

/** 1: 엔티티만 / 2: 진행 중인 공격(combat) 추가 / 3: 플레이어 행동 상태 머신(players) 추가 */
export const SNAPSHOT_VERSION = 3;

export interface WorldSnapshot extends WorldState {
  version: typeof SNAPSHOT_VERSION;
}

export class SnapshotError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`스냅샷 오류 (${path}): ${message}`);
    this.name = "SnapshotError";
  }
}

export function serializeWorld(world: SimWorld): WorldSnapshot {
  return { version: SNAPSHOT_VERSION, ...world.toState() };
}

export function deserializeWorld(data: unknown, options: Omit<SimWorldOptions, "seed"> = {}): SimWorld {
  return SimWorld.fromState(parseSnapshot(data), options);
}

/** JSON 문자열로 */
export function encodeWorld(world: SimWorld): string {
  return JSON.stringify(serializeWorld(world));
}

export function decodeWorld(json: string, options: Omit<SimWorldOptions, "seed"> = {}): SimWorld {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new SnapshotError("$", `JSON 파싱 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
  return deserializeWorld(data, options);
}

// ---------------------------------------------------------------------------
// 검증
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(obj: Record<string, unknown>, key: string, path: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new SnapshotError(`${path}.${key}`, "유한한 숫자가 아닙니다.");
  return v;
}

function nonNeg(obj: Record<string, unknown>, key: string, path: string): number {
  const v = num(obj, key, path);
  if (v < 0) throw new SnapshotError(`${path}.${key}`, "음수일 수 없습니다.");
  return v;
}

function int(obj: Record<string, unknown>, key: string, path: string, min = 0): number {
  const v = num(obj, key, path);
  if (!Number.isInteger(v) || v < min) throw new SnapshotError(`${path}.${key}`, `${min} 이상의 정수여야 합니다.`);
  return v;
}

function parseEntity(raw: unknown, path: string): Entity {
  if (!isRecord(raw)) throw new SnapshotError(path, "객체가 아닙니다.");
  const archetype = raw.archetype;
  if (typeof archetype !== "string" || !isArchetypeId(archetype)) throw new SnapshotError(`${path}.archetype`, `알 수 없는 원형 '${String(archetype)}'`);
  const team = raw.team;
  if (typeof team !== "string" || !TEAMS.includes(team as Team)) throw new SnapshotError(`${path}.team`, `알 수 없는 팀 '${String(team)}'`);
  const pos = raw.position;
  if (!isRecord(pos)) throw new SnapshotError(`${path}.position`, "객체가 아닙니다.");

  const maxHealth = nonNeg(raw, "maxHealth", path);
  const maxStamina = nonNeg(raw, "maxStamina", path);
  const maxPoise = nonNeg(raw, "maxPoise", path);
  const health = nonNeg(raw, "health", path);
  const stamina = nonNeg(raw, "stamina", path);
  if (health > maxHealth) throw new SnapshotError(`${path}.health`, "최대 체력을 넘습니다.");
  if (stamina > maxStamina) throw new SnapshotError(`${path}.stamina`, "최대 스태미나를 넘습니다.");
  const poise = num(raw, "poise", path);
  if (poise > maxPoise) throw new SnapshotError(`${path}.poise`, "최대 강인도를 넘습니다.");
  const flags = int(raw, "flags", path);
  if ((flags & ~ALL_FLAGS) !== 0) throw new SnapshotError(`${path}.flags`, "정의되지 않은 플래그 비트가 있습니다.");

  return {
    id: int(raw, "id", path, 1),
    archetype,
    team: team as Team,
    position: { x: num(pos, "x", `${path}.position`), y: num(pos, "y", `${path}.position`), z: num(pos, "z", `${path}.position`) },
    yaw: num(raw, "yaw", path),
    health,
    maxHealth,
    stamina,
    maxStamina,
    staminaRegenDelay: int(raw, "staminaRegenDelay", path),
    poise,
    maxPoise,
    poiseRegenDelay: int(raw, "poiseRegenDelay", path),
    staggerTicks: int(raw, "staggerTicks", path),
    flags,
  };
}

function parseAttack(raw: unknown, path: string, entityIds: ReadonlySet<number>): AttackInstanceState {
  if (!isRecord(raw)) throw new SnapshotError(path, "객체가 아닙니다.");
  const attack = raw.attack;
  if (typeof attack !== "string" || !isAttackId(attack)) throw new SnapshotError(`${path}.attack`, `알 수 없는 공격 '${String(attack)}'`);
  if (typeof raw.active !== "boolean") throw new SnapshotError(`${path}.active`, "불리언이 아닙니다.");
  const attackerId = int(raw, "attackerId", path, 1);
  if (!entityIds.has(attackerId)) throw new SnapshotError(`${path}.attackerId`, `존재하지 않는 엔티티 ${attackerId}`);
  if (!Array.isArray(raw.hitList)) throw new SnapshotError(`${path}.hitList`, "배열이 아닙니다.");
  const hitList = raw.hitList.map((v: unknown, i: number) => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new SnapshotError(`${path}.hitList[${i}]`, "1 이상의 정수가 아닙니다.");
    return v;
  });
  return { id: int(raw, "id", path, 1), attackerId, attack, startTick: int(raw, "startTick", path), active: raw.active, hitList };
}

function parseCombat(raw: unknown, entityIds: ReadonlySet<number>): CombatState {
  const path = "$.combat";
  if (!isRecord(raw)) throw new SnapshotError(path, "객체가 아닙니다.");
  const nextInstanceId = int(raw, "nextInstanceId", path, 1);
  if (!Array.isArray(raw.attacks)) throw new SnapshotError(`${path}.attacks`, "배열이 아닙니다.");
  const seen = new Set<number>();
  const attacks = raw.attacks.map((a: unknown, i: number) => {
    const p = `${path}.attacks[${i}]`;
    const inst = parseAttack(a, p, entityIds);
    if (seen.has(inst.id)) throw new SnapshotError(`${p}.id`, `중복 id ${inst.id}`);
    if (inst.id >= nextInstanceId) throw new SnapshotError(`${p}.id`, `id ${inst.id}가 nextInstanceId ${nextInstanceId} 이상입니다.`);
    seen.add(inst.id);
    return inst;
  });
  return { nextInstanceId, attacks };
}

function oneOf<T extends string>(obj: Record<string, unknown>, key: string, path: string, allowed: readonly T[]): T {
  const v = obj[key];
  if (typeof v !== "string" || !allowed.includes(v as T)) throw new SnapshotError(`${path}.${key}`, `허용되지 않는 값 '${String(v)}'`);
  return v as T;
}

function oneOfOrNull<T extends string>(obj: Record<string, unknown>, key: string, path: string, allowed: readonly T[]): T | null {
  return obj[key] === null ? null : oneOf(obj, key, path, allowed);
}

function parsePlayers(raw: unknown, entityIds: ReadonlySet<number>, attackIds: ReadonlySet<number>): PlayerState[] {
  if (!Array.isArray(raw)) throw new SnapshotError("$.players", "배열이 아닙니다.");
  const seen = new Set<number>();
  return raw.map((r: unknown, i: number) => {
    const path = `$.players[${i}]`;
    if (!isRecord(r)) throw new SnapshotError(path, "객체가 아닙니다.");
    const entityId = int(r, "entityId", path, 1);
    if (!entityIds.has(entityId)) throw new SnapshotError(`${path}.entityId`, `존재하지 않는 엔티티 ${entityId}`);
    if (seen.has(entityId)) throw new SnapshotError(`${path}.entityId`, `중복 플레이어 ${entityId}`);
    seen.add(entityId);
    const state: PlayerStateId = oneOf(r, "state", path, PLAYER_STATES);
    const action: PlayerActionId | null = oneOfOrNull(r, "action", path, PLAYER_ACTIONS);
    const reserved: PlayerVerb | null = oneOfOrNull(r, "reserved", path, PLAYER_VERBS);
    let attackInstance: number | null = null;
    if (r.attackInstance !== null) {
      attackInstance = int(r, "attackInstance", path, 1);
      if (!attackIds.has(attackInstance)) throw new SnapshotError(`${path}.attackInstance`, `존재하지 않는 공격 ${attackInstance}`);
    }
    return {
      entityId,
      state,
      action,
      stateTick: int(r, "stateTick", path),
      reserved,
      attackInstance,
      flasks: int(r, "flasks", path),
      actionYaw: num(r, "actionYaw", path),
      moveX: num(r, "moveX", path),
      moveZ: num(r, "moveZ", path),
    };
  });
}

/** 알 수 없는 입력을 검증해 WorldState로 바꾼다. 실패하면 SnapshotError. */
export function parseSnapshot(data: unknown): WorldState {
  if (!isRecord(data)) throw new SnapshotError("$", "객체가 아닙니다.");
  if (data.version !== SNAPSHOT_VERSION) {
    throw new SnapshotError("$.version", `지원하지 않는 버전 ${String(data.version)} (현재 ${SNAPSHOT_VERSION})`);
  }
  const tick = int(data, "tick", "$");
  const nextId = int(data, "nextId", "$", 1);
  const rngState = int(data, "rngState", "$");
  if (rngState > 0xffffffff) throw new SnapshotError("$.rngState", "u32 범위를 넘습니다.");
  if (!Array.isArray(data.entities)) throw new SnapshotError("$.entities", "배열이 아닙니다.");

  const seen = new Set<number>();
  const entities = data.entities.map((raw: unknown, i: number) => {
    const e = parseEntity(raw, `$.entities[${i}]`);
    if (seen.has(e.id)) throw new SnapshotError(`$.entities[${i}].id`, `중복 id ${e.id}`);
    if (e.id >= nextId) throw new SnapshotError(`$.entities[${i}].id`, `id ${e.id}가 nextId ${nextId} 이상입니다.`);
    seen.add(e.id);
    return e;
  });
  const combat = parseCombat(data.combat, seen);
  const players = parsePlayers(data.players, seen, new Set(combat.attacks.map((a) => a.id)));
  return { tick, nextId, rngState, entities, combat, players };
}
