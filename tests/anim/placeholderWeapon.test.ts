import { describe, expect, it } from "vitest";
import { SWING_ARCS, hitWindowOf, samplePlaceholderWeapon } from "../../src/anim/placeholderWeapon";
import type { AttackInstance } from "../../src/sim/combat/types";
import { ATTACKS } from "../../src/sim/data/attacks";
import { createEntity } from "../../src/sim/entity";
import { vec3 } from "../../src/sim/math/vec3";

const hero = createEntity(1, "player", "player", { x: 2, y: 1, z: 3 }, 0);
const inst: AttackInstance = { id: 1, attackerId: 1, attack: "attack_light_1", startTick: 100, active: true, hitList: new Set() };
const pose = () => ({ hilt: vec3(), tip: vec3() });

describe("임시 무기 자세", () => {
  it("모든 공격에 궤적이 있다", () => {
    for (const id of Object.keys(ATTACKS)) expect(SWING_ARCS[id as keyof typeof SWING_ARCS], id).toBeDefined();
  });

  it("판정 구간 시작에는 시작 각도, 마지막 판정 틱(end-1)에는 끝 각도", () => {
    const w = hitWindowOf("attack_light_1");
    const a = SWING_ARCS.attack_light_1;
    const start = samplePlaceholderWeapon(hero, inst, 100 + w.start, pose());
    const end = samplePlaceholderWeapon(hero, inst, 100 + w.end - 1, pose());
    const yawOf = (p: { tip: { x: number; z: number } }) => (Math.atan2(p.tip.x - hero.position.x, p.tip.z - hero.position.z) * 180) / Math.PI;
    expect(yawOf(start)).toBeCloseTo(a.yawFrom, 6);
    expect(yawOf(end)).toBeCloseTo(a.yawTo, 6);
    expect(start.tip.y).toBeCloseTo(hero.position.y + a.heightFrom, 9);
    expect(Math.hypot(end.tip.x - hero.position.x, end.tip.z - hero.position.z)).toBeCloseTo(a.reachTip, 9);
  });

  it("구간 전/후에는 시작/끝 자세에 머물고, 소수 틱은 그 사이", () => {
    const w = hitWindowOf("attack_light_1");
    const before = samplePlaceholderWeapon(hero, inst, 100, pose());
    const atStart = samplePlaceholderWeapon(hero, inst, 100 + w.start, pose());
    expect(before).toEqual(atStart);
    const mid = samplePlaceholderWeapon(hero, inst, 100 + w.start + 0.5, pose());
    expect(mid.tip.x).toBeLessThan(atStart.tip.x);
  });

  it("공격자가 바라보는 방향을 따라 돈다", () => {
    const turned = createEntity(2, "player", "player", { x: 0, y: 0, z: 0 }, Math.PI / 2);
    const w = hitWindowOf("attack_light_1");
    const p = samplePlaceholderWeapon(turned, { ...inst, attackerId: 2 }, 100 + w.start + (w.end - 1 - w.start) / 2, pose());
    // 대략 정면(+X) 근처를 지나는 중
    expect(p.tip.x).toBeGreaterThan(1);
  });
});
