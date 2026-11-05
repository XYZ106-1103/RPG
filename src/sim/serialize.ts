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
import { ALL_FLAGS, TEAMS, type Entity, type Team } from "./entity";
import { SimWorld, type SimWorldOptions, type WorldState } from "./world";

/** 1: 엔티티만 / 2: 진행 중인 공격(combat) 추가 */
export const SNAPSHOT_VERSION = 2;

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
  return { tick, nextId, rngState, entities, combat: parseCombat(data.combat, seen) };
}
