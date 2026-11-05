/**
 * 강인도(poise): 누적 피해로 깎이고, 0 이하가 되면 경직(STAGGERED). 피해가 끊기면 지연 후 회복.
 * 수치는 data/archetypes.ts(원형별)와 data/poise.ts(공통 규칙).
 */
import { ARCHETYPES } from "../data/archetypes";
import { POISE_RULES } from "../data/poise";
import { FLAG, isDead, type Entity } from "../entity";
import type { EventSink } from "../events";
import { SIM_DT, secondsToTicks } from "../time";

/**
 * 강인도 피해를 준다. 슈퍼아머 중이면 감소한다.
 * @returns 이번 피해로 강인도가 붕괴(경직 시작)했는가
 */
export function applyPoiseDamage(e: Entity, amount: number, sink?: EventSink): boolean {
  if (amount <= 0 || isDead(e)) return false;
  const mult = e.flags & FLAG.SUPER_ARMOR ? POISE_RULES.superArmorDamageMultiplier : 1;
  e.poise -= amount * mult;
  e.poiseRegenDelay = secondsToTicks(ARCHETYPES[e.archetype].poiseRegenDelaySeconds);
  if (e.poise > 0) return false;
  breakPoise(e, sink);
  return true;
}

/** 강인도 붕괴: 경직 시작. 진행 중이던 스프린트/가드/슈퍼아머는 끊긴다. */
export function breakPoise(e: Entity, sink?: EventSink): void {
  const a = ARCHETYPES[e.archetype];
  e.poise = POISE_RULES.resetOnBreak ? e.maxPoise : 0;
  e.staggerTicks = Math.max(1, secondsToTicks(a.staggerSeconds));
  e.flags = (e.flags | FLAG.STAGGERED) & ~(FLAG.SPRINTING | FLAG.GUARDING | FLAG.SUPER_ARMOR);
  sink?.emit("stagger", { entity: e.id, durationTicks: e.staggerTicks });
}

/** 매 틱: 경직 시간 감소, 회복 지연 감소 또는 회복 */
export function tickPoise(e: Entity): void {
  if (isDead(e)) return;

  if (e.flags & FLAG.STAGGERED) {
    if (--e.staggerTicks <= 0) {
      e.staggerTicks = 0;
      e.flags &= ~FLAG.STAGGERED;
    }
  }

  if (e.poiseRegenDelay > 0) {
    e.poiseRegenDelay--;
    return;
  }
  if (e.poise < e.maxPoise) {
    e.poise = Math.min(e.maxPoise, e.poise + ARCHETYPES[e.archetype].poiseRegenPerSecond * SIM_DT);
  }
}
