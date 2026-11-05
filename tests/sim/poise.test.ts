import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "../../src/sim/data/archetypes";
import { POISE_RULES } from "../../src/sim/data/poise";
import { FLAG, hasFlag, isActionable, isStaggered } from "../../src/sim/entity";
import { applyPoiseDamage, canPerform, setSprinting } from "../../src/sim/stats";
import { SIM_DT, secondsToTicks } from "../../src/sim/time";
import { stepN, worldWith } from "./helpers";

describe("강인도 — 누적 피해와 붕괴", () => {
  it("피해가 누적되어 0 이하가 되면 붕괴해 경직된다", () => {
    const { world, e } = worldWith("hollow", "enemy"); // maxPoise 25
    expect(applyPoiseDamage(e, 10, world)).toBe(false);
    expect(applyPoiseDamage(e, 10, world)).toBe(false);
    expect(e.poise).toBe(5);
    expect(isStaggered(e)).toBe(false);
    expect(applyPoiseDamage(e, 10, world)).toBe(true);
    expect(isStaggered(e)).toBe(true);
    expect(isActionable(e)).toBe(false);
    expect(canPerform(e, "roll")).toBe(false);
  });

  it("붕괴하면 stagger 이벤트를 내고, 강인도를 최대로 되돌린다", () => {
    const { world, e } = worldWith("hollow", "enemy");
    applyPoiseDamage(e, 999, world);
    const events = world.drainEvents();
    expect(events).toEqual([
      { tick: 0, type: "stagger", payload: { entity: e.id, durationTicks: secondsToTicks(ARCHETYPES.hollow.staggerSeconds) } },
    ]);
    expect(POISE_RULES.resetOnBreak).toBe(true);
    expect(e.poise).toBe(e.maxPoise);
  });

  it("경직은 원형의 staggerSeconds 만큼 지속된 뒤 풀린다", () => {
    const { world, e } = worldWith("hollow", "enemy");
    applyPoiseDamage(e, 999, world);
    const ticks = secondsToTicks(ARCHETYPES.hollow.staggerSeconds);
    stepN(world, ticks - 1);
    expect(isStaggered(e)).toBe(true);
    world.step();
    expect(isStaggered(e)).toBe(false);
    expect(isActionable(e)).toBe(true);
  });

  it("경직이 진행 중이던 스프린트/가드/슈퍼아머를 끊는다", () => {
    const { world, e } = worldWith();
    setSprinting(e, true);
    e.flags |= FLAG.GUARDING | FLAG.SUPER_ARMOR;
    applyPoiseDamage(e, 999, world);
    expect(hasFlag(e, FLAG.SPRINTING)).toBe(false);
    expect(hasFlag(e, FLAG.GUARDING)).toBe(false);
    expect(hasFlag(e, FLAG.SUPER_ARMOR)).toBe(false);
  });

  it("슈퍼아머 중에는 강인도 피해가 줄어든다", () => {
    const { e } = worldWith("hollow", "enemy");
    e.flags |= FLAG.SUPER_ARMOR;
    applyPoiseDamage(e, 20);
    expect(e.poise).toBe(25 - 20 * POISE_RULES.superArmorDamageMultiplier);
    expect(isStaggered(e)).toBe(false);
  });
});

describe("강인도 — 시간 경과 회복", () => {
  it("마지막 피해 후 지연이 지나면 초당 회복량으로 회복한다", () => {
    const { world, e } = worldWith("hollow", "enemy");
    applyPoiseDamage(e, 10);
    const delay = secondsToTicks(ARCHETYPES.hollow.poiseRegenDelaySeconds);
    stepN(world, delay);
    expect(e.poise).toBe(15);
    world.step();
    expect(e.poise).toBeCloseTo(15 + ARCHETYPES.hollow.poiseRegenPerSecond * SIM_DT, 9);
    stepN(world, 600);
    expect(e.poise).toBe(e.maxPoise);
  });

  it("지연 중 다시 맞으면 지연이 처음부터 다시 걸린다 (연속 공격으로 붕괴 가능)", () => {
    const { world, e } = worldWith("hollow", "enemy");
    const delay = secondsToTicks(ARCHETYPES.hollow.poiseRegenDelaySeconds);
    applyPoiseDamage(e, 8);
    stepN(world, delay - 1);
    applyPoiseDamage(e, 8);
    stepN(world, delay - 1);
    expect(e.poise).toBe(9);
    expect(applyPoiseDamage(e, 9, world)).toBe(true);
  });
});
