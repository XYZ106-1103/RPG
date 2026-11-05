import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "../../src/sim/data/archetypes";
import { POISE_RULES } from "../../src/sim/data/poise";
import { STAMINA_ACTIONS, STAMINA_RULES } from "../../src/sim/data/stamina";

/** 밸런스 조정 중 실수(음수, 0, 오타)를 잡는 데이터 검증 */
describe("데이터 테이블", () => {
  it.each(Object.entries(ARCHETYPES))("원형 %s 스탯이 유효하다", (_id, a) => {
    for (const key of ["maxHealth", "maxStamina", "maxPoise", "staminaRegenPerSecond", "poiseRegenPerSecond", "staggerSeconds", "radius", "height"] as const) {
      expect(a[key], key).toBeGreaterThan(0);
    }
    expect(a.poiseRegenDelaySeconds).toBeGreaterThanOrEqual(0);
    expect(a.height).toBeGreaterThan(a.radius * 2);
    expect(a.name.length).toBeGreaterThan(0);
  });

  it.each(Object.entries(STAMINA_ACTIONS))("행동 %s 소모량이 유효하다", (_id, c) => {
    expect(c.cost).toBeGreaterThanOrEqual(0);
    expect(c.regenDelaySeconds).toBeGreaterThanOrEqual(0);
    // 모든 원형이 최대 스태미나로 적어도 한 번은 할 수 있어야 한다
    for (const a of Object.values(ARCHETYPES)) expect(c.cost).toBeLessThanOrEqual(a.maxStamina);
  });

  it("공통 규칙 값의 범위", () => {
    expect(STAMINA_RULES.minToAct).toBeGreaterThan(0);
    expect(STAMINA_RULES.guardRegenMultiplier).toBeGreaterThan(0);
    expect(STAMINA_RULES.guardRegenMultiplier).toBeLessThanOrEqual(1);
    expect(STAMINA_RULES.sprintDrainPerSecond).toBeGreaterThan(0);
    expect(POISE_RULES.superArmorDamageMultiplier).toBeGreaterThan(0);
    expect(POISE_RULES.superArmorDamageMultiplier).toBeLessThanOrEqual(1);
  });
});
