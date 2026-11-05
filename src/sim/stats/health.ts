/**
 * 체력, 피해, 사망 처리.
 */
import { FLAG, isDead, type Entity, type EntityId } from "../entity";
import type { EventSink } from "../events";
import { applyPoiseDamage } from "./poise";

export interface DamageResult {
  /** 실제로 깎인 체력 */
  applied: number;
  /** 이번 피해로 사망했는가 */
  killed: boolean;
}

/**
 * 체력 피해. 이미 사망했거나 무적(i-frame)이면 무시한다.
 * 체력이 0이 되면 사망 처리한다.
 */
export function applyDamage(e: Entity, amount: number, source: EntityId | null, sink?: EventSink): DamageResult {
  if (!(amount > 0) || isDead(e) || e.flags & FLAG.INVULNERABLE) return { applied: 0, killed: false };
  const applied = Math.min(amount, e.health);
  e.health -= applied;
  if (e.health <= 0) {
    kill(e, source, sink);
    return { applied, killed: true };
  }
  return { applied, killed: false };
}

/**
 * 사망 처리: 체력 0, DEAD 외 모든 상태 플래그 해제, 진행 중 타이머 정지.
 * 이미 사망했으면 아무 일도 하지 않는다 (사망 이벤트 중복 방지).
 */
export function kill(e: Entity, source: EntityId | null, sink?: EventSink): void {
  if (isDead(e)) return;
  e.health = 0;
  e.flags = FLAG.DEAD;
  e.staggerTicks = 0;
  e.staminaRegenDelay = 0;
  e.poiseRegenDelay = 0;
  sink?.emit("death", { entity: e.id, killer: source });
}

/** 회복. 사망 상태에서는 회복하지 않는다 (부활은 revive). @returns 실제 회복량 */
export function heal(e: Entity, amount: number): number {
  if (!(amount > 0) || isDead(e)) return 0;
  const before = e.health;
  e.health = Math.min(e.maxHealth, e.health + amount);
  return e.health - before;
}

/** 부활 (제단 휴식/리스폰): 체력·스태미나·강인도를 최대로, 상태 초기화 */
export function revive(e: Entity): void {
  e.health = e.maxHealth;
  e.stamina = e.maxStamina;
  e.poise = e.maxPoise;
  e.staminaRegenDelay = 0;
  e.poiseRegenDelay = 0;
  e.staggerTicks = 0;
  e.flags = 0;
}

export interface HitResult extends DamageResult {
  /** 강인도 붕괴로 경직이 시작되었는가 (사망 시에는 false) */
  staggered: boolean;
}

/** 공격 한 번의 결과 적용: 체력 → (살아 있으면) 강인도 순서 */
export function applyHit(e: Entity, damage: number, poiseDamage: number, source: EntityId | null, sink?: EventSink): HitResult {
  if (e.flags & FLAG.INVULNERABLE) return { applied: 0, killed: false, staggered: false };
  const dmg = applyDamage(e, damage, source, sink);
  const staggered = dmg.killed ? false : applyPoiseDamage(e, poiseDamage, sink);
  return { ...dmg, staggered };
}
