import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "../../src/sim/data/archetypes";
import { POISE_RULES } from "../../src/sim/data/poise";
import { STAMINA_ACTIONS, STAMINA_RULES } from "../../src/sim/data/stamina";
import { ATTACKS } from "../../src/sim/data/attacks";
import { COMBAT_RULES } from "../../src/sim/data/combat";
import { PLAYER_TIMELINES } from "../../src/sim/data/playerTimelines";

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

describe("플레이어 타임라인 (PLAYER_TIMELINES)", () => {
  it.each(Object.entries(PLAYER_TIMELINES))("%s 구간이 길이 안에 있고 순서가 맞다", (id, tl) => {
    expect(Number.isInteger(tl.length) && tl.length > 0).toBe(true);
    for (const w of [tl.hit, tl.iframes, tl.superArmor, tl.buffer]) {
      if (!w) continue;
      expect(w.start).toBeGreaterThanOrEqual(0);
      expect(w.end).toBeGreaterThan(w.start);
      expect(w.end).toBeLessThanOrEqual(tl.length);
    }
    expect(tl.cancel).toBeGreaterThan(0);
    expect(tl.cancel).toBeLessThanOrEqual(tl.length);
    // 버퍼는 캔슬 전에 열려야 예약이 의미가 있다
    if (tl.buffer) expect(tl.buffer.start).toBeLessThan(tl.cancel);
    // 판정이 끝나기 전에 캔슬되면 공격이 잘린다
    if (tl.hit) expect(tl.cancel).toBeGreaterThanOrEqual(tl.hit.end);
    // 공격 행동은 판정 구간과 공격 데이터가 있어야 한다
    if (id.startsWith("attack_")) {
      expect(tl.hit).toBeDefined();
      expect(Object.keys(ATTACKS)).toContain(id);
    }
    if (tl.effect !== undefined) expect(tl.effect).toBeLessThan(tl.length);
    if (tl.rootMotion) {
      expect(tl.rootMotion.distance).toBeGreaterThan(0);
      expect(tl.rootMotion.start).toBeGreaterThanOrEqual(0);
      expect(tl.rootMotion.end).toBeGreaterThan(tl.rootMotion.start);
      expect(tl.rootMotion.end).toBeLessThanOrEqual(tl.length);
    }
  });

  it("구르기/백스텝은 무적 구간이 있다", () => {
    expect(PLAYER_TIMELINES.roll.iframes).toBeDefined();
    expect(PLAYER_TIMELINES.backstep.iframes).toBeDefined();
  });
});
