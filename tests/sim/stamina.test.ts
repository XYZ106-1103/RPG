import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "../../src/sim/data/archetypes";
import { STAMINA_ACTIONS, STAMINA_RULES } from "../../src/sim/data/stamina";
import { FLAG, hasFlag } from "../../src/sim/entity";
import { breakPoise, canPerform, kill, setSprinting, spendStamina, tryPerform } from "../../src/sim/stats";
import { SIM_DT, secondsToTicks } from "../../src/sim/time";
import { stepN, worldWith } from "./helpers";

const REGEN = ARCHETYPES.player.staminaRegenPerSecond;

describe("스태미나 — 소모와 회복 지연", () => {
  it("행동하면 테이블 소모량만큼 줄어든다", () => {
    const { e } = worldWith();
    expect(tryPerform(e, "roll")).toBe(true);
    expect(e.stamina).toBe(e.maxStamina - STAMINA_ACTIONS.roll.cost);
  });

  it("회복 지연 동안은 회복하지 않고, 지연이 끝난 다음 틱부터 회복한다", () => {
    const { world, e } = worldWith();
    tryPerform(e, "attack_light");
    const after = e.stamina;
    const delay = secondsToTicks(STAMINA_ACTIONS.attack_light.regenDelaySeconds);
    expect(e.staminaRegenDelay).toBe(delay);

    stepN(world, delay);
    expect(e.stamina).toBe(after); // 지연 N틱 동안 그대로
    expect(e.staminaRegenDelay).toBe(0);

    world.step();
    expect(e.stamina).toBeCloseTo(after + REGEN * SIM_DT, 9);
  });

  it("지연 후 초당 회복량대로 회복하고 최대치에서 멈춘다", () => {
    const { world, e } = worldWith();
    tryPerform(e, "attack_heavy");
    const after = e.stamina;
    stepN(world, secondsToTicks(STAMINA_ACTIONS.attack_heavy.regenDelaySeconds) + 60);
    expect(e.stamina).toBeCloseTo(Math.min(e.maxStamina, after + REGEN), 6);
    stepN(world, 600);
    expect(e.stamina).toBe(e.maxStamina);
  });

  it("지연 중 다시 행동하면 지연이 다시 걸린다 (연타 중 회복 없음)", () => {
    const { world, e } = worldWith();
    tryPerform(e, "attack_light");
    stepN(world, 20);
    tryPerform(e, "attack_light");
    expect(e.staminaRegenDelay).toBe(secondsToTicks(STAMINA_ACTIONS.attack_light.regenDelaySeconds));
    const after = e.stamina;
    stepN(world, 30);
    expect(e.stamina).toBe(after);
  });

  it("짧은 지연이 긴 지연을 덮어쓰지 않는다", () => {
    const { e } = worldWith();
    spendStamina(e, 10, 2);
    spendStamina(e, 10, 0.1);
    expect(e.staminaRegenDelay).toBe(secondsToTicks(2));
  });

  it("0까지 다 쓰면 탈진 페널티로 회복 지연이 늘어난다", () => {
    const { e } = worldWith();
    e.stamina = 5;
    tryPerform(e, "roll");
    expect(e.stamina).toBe(0);
    expect(e.staminaRegenDelay).toBe(secondsToTicks(STAMINA_RULES.exhaustedRegenDelaySeconds));
  });
});

describe("스태미나 — 0일 때 행동 제한", () => {
  it("소모량보다 적게 남아도 0보다 크면 행동할 수 있고, 0에서 멈춘다 (음수 없음)", () => {
    const { e } = worldWith();
    e.stamina = 3;
    expect(tryPerform(e, "attack_heavy")).toBe(true);
    expect(e.stamina).toBe(0);
  });

  it("0이면 소모 행동이 막히고 상태가 바뀌지 않는다", () => {
    const { e } = worldWith();
    e.stamina = 0;
    e.staminaRegenDelay = 7;
    for (const a of ["attack_light", "attack_heavy", "attack_run", "roll", "backstep"] as const) {
      expect(canPerform(e, a)).toBe(false);
      expect(tryPerform(e, a)).toBe(false);
    }
    expect(e.staminaRegenDelay).toBe(7);
  });

  it("소모량 0인 행동(회복약)은 스태미나 0이어도 가능", () => {
    const { e } = worldWith();
    e.stamina = 0;
    expect(tryPerform(e, "drink")).toBe(true);
  });

  it("스태미나가 회복되면 다시 행동할 수 있다", () => {
    const { world, e } = worldWith();
    e.stamina = 0;
    e.staminaRegenDelay = 0;
    world.step();
    expect(canPerform(e, "roll")).toBe(true);
  });

  it("경직/사망 중에는 스태미나가 충분해도 행동할 수 없다", () => {
    const { e } = worldWith();
    breakPoise(e);
    expect(canPerform(e, "roll")).toBe(false);
    expect(canPerform(e, "drink")).toBe(false);
    const { e: dead } = worldWith();
    kill(dead, null);
    expect(tryPerform(dead, "attack_light")).toBe(false);
  });
});

describe("스태미나 — 스프린트와 가드", () => {
  it("스프린트는 초당 소모량만큼 줄고, 그동안 회복하지 않는다", () => {
    const { world, e } = worldWith();
    setSprinting(e, true);
    stepN(world, 60);
    expect(e.stamina).toBeCloseTo(e.maxStamina - STAMINA_RULES.sprintDrainPerSecond, 6);
  });

  it("스태미나가 바닥나면 스프린트가 강제로 끝나고 탈진 지연이 걸린다", () => {
    const { world, e } = worldWith();
    e.stamina = 1;
    setSprinting(e, true);
    stepN(world, 10);
    expect(hasFlag(e, FLAG.SPRINTING)).toBe(false);
    expect(e.stamina).toBe(0);
    expect(e.staminaRegenDelay).toBeGreaterThan(0);
  });

  it("스태미나 0이면 스프린트를 시작할 수 없다", () => {
    const { e } = worldWith();
    e.stamina = 0;
    expect(setSprinting(e, true)).toBe(false);
    expect(hasFlag(e, FLAG.SPRINTING)).toBe(false);
  });

  it("가드 중에는 회복이 느리다", () => {
    const { world, e } = worldWith();
    e.stamina = 0;
    e.flags |= FLAG.GUARDING;
    world.step();
    expect(e.stamina).toBeCloseTo(REGEN * STAMINA_RULES.guardRegenMultiplier * SIM_DT, 9);
  });
});
