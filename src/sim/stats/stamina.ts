/**
 * 스태미나: 행동별 소모, 소모 후 회복 지연, 0일 때 행동 제한, 스프린트 지속 소모.
 *
 * 규칙 (수치는 data/stamina.ts):
 *  - 행동은 스태미나가 0보다 크면 시작할 수 있다. 소모량보다 적게 남았어도 되며, 0에서 멈춘다.
 *  - 소모하면 회복 지연이 걸린다. 지연 N틱 동안은 회복하지 않고, 그다음 틱부터 회복한다.
 *  - 0까지 다 쓰면 탈진 페널티로 회복 지연이 늘어난다.
 *  - 사망/경직 중에는 행동할 수 없다. 사망하면 회복도 멈춘다.
 */
import { ARCHETYPES } from "../data/archetypes";
import { STAMINA_ACTIONS, STAMINA_RULES, type StaminaActionId } from "../data/stamina";
import { FLAG, isActionable, isDead, type Entity } from "../entity";
import { SIM_DT, secondsToTicks } from "../time";

/** 스태미나가 0보다 큰가 (행동 가능 최소치) */
export function hasStaminaToAct(e: Readonly<Entity>): boolean {
  return e.stamina >= STAMINA_RULES.minToAct;
}

/** 이 행동을 지금 시작할 수 있는가 (상태 + 스태미나) */
export function canPerform(e: Readonly<Entity>, action: StaminaActionId): boolean {
  if (!isActionable(e)) return false;
  return STAMINA_ACTIONS[action].cost <= 0 || hasStaminaToAct(e);
}

/**
 * 스태미나를 소모하고 회복 지연을 건다 (기존 지연보다 짧아지지는 않는다).
 * @returns 실제로 줄어든 양
 */
export function spendStamina(e: Entity, amount: number, regenDelaySeconds: number): number {
  if (amount <= 0 || isDead(e)) return 0;
  const before = e.stamina;
  e.stamina = Math.max(0, e.stamina - amount);
  let delay = secondsToTicks(regenDelaySeconds);
  if (e.stamina <= 0) delay = Math.max(delay, secondsToTicks(STAMINA_RULES.exhaustedRegenDelaySeconds));
  e.staminaRegenDelay = Math.max(e.staminaRegenDelay, delay);
  return before - e.stamina;
}

/**
 * 행동 시작 시도: 가능하면 테이블의 소모량만큼 쓰고 true.
 * 불가능하면 상태를 바꾸지 않고 false.
 */
export function tryPerform(e: Entity, action: StaminaActionId): boolean {
  if (!canPerform(e, action)) return false;
  const c = STAMINA_ACTIONS[action];
  spendStamina(e, c.cost, c.regenDelaySeconds);
  return true;
}

/** 스프린트 시작/종료. 스태미나가 없거나 행동 불가면 시작하지 않는다. */
export function setSprinting(e: Entity, on: boolean): boolean {
  if (on && (!isActionable(e) || !hasStaminaToAct(e))) on = false;
  e.flags = on ? e.flags | FLAG.SPRINTING : e.flags & ~FLAG.SPRINTING;
  return on;
}

/** 매 틱: 스프린트 소모 또는 회복 지연 감소 또는 회복 */
export function tickStamina(e: Entity): void {
  if (isDead(e)) return;

  if (e.flags & FLAG.SPRINTING) {
    spendStamina(e, STAMINA_RULES.sprintDrainPerSecond * SIM_DT, STAMINA_RULES.sprintRegenDelaySeconds);
    if (e.stamina <= 0) e.flags &= ~FLAG.SPRINTING; // 다 쓰면 스프린트 강제 종료
    return;
  }

  if (e.staminaRegenDelay > 0) {
    e.staminaRegenDelay--;
    return;
  }

  if (e.stamina < e.maxStamina) {
    const mult = e.flags & FLAG.GUARDING ? STAMINA_RULES.guardRegenMultiplier : 1;
    e.stamina = Math.min(e.maxStamina, e.stamina + ARCHETYPES[e.archetype].staminaRegenPerSecond * mult * SIM_DT);
  }
}
