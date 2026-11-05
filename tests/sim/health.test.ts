import { describe, expect, it } from "vitest";
import { FLAG, isActionable, isDead } from "../../src/sim/entity";
import { applyDamage, applyHit, applyPoiseDamage, heal, kill, revive, setSprinting, tryPerform } from "../../src/sim/stats";
import { stepN, worldWith } from "./helpers";

describe("체력과 사망 처리", () => {
  it("피해만큼 체력이 줄고, 남은 체력보다 큰 피해는 남은 만큼만 적용된다", () => {
    const { e } = worldWith();
    expect(applyDamage(e, 30, null)).toEqual({ applied: 30, killed: false });
    expect(e.health).toBe(70);
    expect(applyDamage(e, 500, 7)).toEqual({ applied: 70, killed: true });
    expect(e.health).toBe(0);
  });

  it("체력이 0이 되면 사망: DEAD 외 모든 플래그 해제, death 이벤트 1회", () => {
    const { world, e } = worldWith();
    setSprinting(e, true);
    e.flags |= FLAG.GUARDING | FLAG.SUPER_ARMOR;
    applyDamage(e, 1000, 9, world);
    expect(isDead(e)).toBe(true);
    expect(e.flags).toBe(FLAG.DEAD);
    expect(isActionable(e)).toBe(false);
    expect(world.drainEvents()).toEqual([{ tick: 0, type: "death", payload: { entity: e.id, killer: 9 } }]);
  });

  it("사망한 엔티티는 추가 피해/강인도 피해/사망 이벤트가 없다", () => {
    const { world, e } = worldWith();
    kill(e, null, world);
    world.drainEvents();
    expect(applyDamage(e, 10, 1, world)).toEqual({ applied: 0, killed: false });
    expect(applyPoiseDamage(e, 999, world)).toBe(false);
    kill(e, 1, world);
    expect(world.drainEvents()).toEqual([]);
    expect(e.flags).toBe(FLAG.DEAD);
  });

  it("사망하면 스태미나/강인도 회복이 멈추고 행동할 수 없다", () => {
    const { world, e } = worldWith();
    tryPerform(e, "roll");
    applyPoiseDamage(e, 10);
    const stamina = e.stamina;
    const poise = e.poise;
    kill(e, null);
    stepN(world, 600);
    expect(e.stamina).toBe(stamina);
    expect(e.poise).toBe(poise);
    expect(tryPerform(e, "attack_light")).toBe(false);
  });

  it("치명타가 된 공격은 경직을 일으키지 않는다 (사망이 우선)", () => {
    const { world, e } = worldWith("hollow", "enemy");
    const r = applyHit(e, 999, 999, 1, world);
    expect(r).toEqual({ applied: 90, killed: true, staggered: false });
    expect(world.drainEvents().map((ev) => ev.type)).toEqual(["death"]);
  });

  it("살아남은 공격은 체력과 강인도를 모두 깎는다", () => {
    const { world, e } = worldWith("hollow", "enemy");
    const r = applyHit(e, 20, 30, 1, world);
    expect(r).toEqual({ applied: 20, killed: false, staggered: true });
    expect(e.health).toBe(70);
  });

  it("무적(i-frame) 중에는 피해도 강인도 피해도 받지 않는다", () => {
    const { e } = worldWith();
    e.flags |= FLAG.INVULNERABLE;
    expect(applyHit(e, 50, 50, 1)).toEqual({ applied: 0, killed: false, staggered: false });
    expect(e.health).toBe(e.maxHealth);
    expect(e.poise).toBe(e.maxPoise);
  });

  it("0, 음수, NaN 피해는 무시한다", () => {
    const { e } = worldWith();
    for (const v of [0, -10, Number.NaN]) expect(applyDamage(e, v, null).applied).toBe(0);
    expect(e.health).toBe(e.maxHealth);
  });

  it("회복은 최대치까지만, 사망 상태에서는 회복하지 않는다. revive로 부활", () => {
    const { e } = worldWith();
    applyDamage(e, 50, null);
    expect(heal(e, 80)).toBe(50);
    kill(e, null);
    expect(heal(e, 10)).toBe(0);
    revive(e);
    expect(isDead(e)).toBe(false);
    expect(e.health).toBe(e.maxHealth);
    expect(e.stamina).toBe(e.maxStamina);
    expect(e.flags).toBe(0);
  });
});
