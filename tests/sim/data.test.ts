import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "../../src/sim/data/archetypes";
import { POISE_RULES } from "../../src/sim/data/poise";
import { STAMINA_ACTIONS, STAMINA_RULES } from "../../src/sim/data/stamina";
import { ATTACKS } from "../../src/sim/data/attacks";
import { COMBAT_RULES } from "../../src/sim/data/combat";

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

describe("공격 데이터 (AttackDef)", () => {
  it.each(Object.entries(ATTACKS))("공격 %s 수치가 유효하다", (_id, a) => {
    expect(a.damage).toBeGreaterThan(0);
    expect(a.poiseDamage).toBeGreaterThanOrEqual(0);
    expect(a.staminaCost).toBeGreaterThanOrEqual(0);
    expect(a.staminaRegenDelaySeconds).toBeGreaterThanOrEqual(0);
    expect(a.guardStaminaDamage).toBeGreaterThanOrEqual(0);
    expect([2, 3, 4]).toContain(a.hitstopFrames);
    expect(a.knockback).toBeGreaterThanOrEqual(0);
    expect(a.hitbox.radius).toBeGreaterThan(0);
    expect(a.hitbox.radius).toBeLessThan(1);
  });

  it("전투 규칙 범위", () => {
    expect(COMBAT_RULES.guardAbsorb).toBeGreaterThan(0);
    expect(COMBAT_RULES.guardAbsorb).toBeLessThanOrEqual(1);
    // 가드 정면 아크와 백어택 아크가 겹치지 않아야 한다 (같은 공격이 가드 가능하면서 백어택일 수 없음)
    expect(COMBAT_RULES.guardHalfAngleDeg + COMBAT_RULES.backAttackHalfAngleDeg).toBeLessThanOrEqual(180);
    expect(COMBAT_RULES.backAttackDamageMultiplier).toBeGreaterThanOrEqual(1);
  });
});
