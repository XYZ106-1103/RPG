import { describe, expect, it } from "vitest";
import { BakedSocketProvider, sampleTrack, type SocketTrack } from "../../src/physics/combat/bakedSockets";
import type { WeaponSocketProvider, WeaponSockets } from "../../src/physics/combat/havokHitQuery";
import type { AttackInstance } from "../../src/sim/combat/types";
import { createEntity } from "../../src/sim/entity";
import { vec3 } from "../../src/sim/math/vec3";

// 틱 0: 손잡이 (0,1,0.5) 칼끝 (0,1,1.5) → 틱 2: 손잡이 (0.5,1,0) 칼끝 (1.5,1,0)
const track: SocketTrack = { ticks: 2, data: new Float32Array([0, 1, 0.5, 0, 1, 1.5, 0.25, 1, 0.25, 0.75, 1, 0.75, 0.5, 1, 0, 1.5, 1, 0]) };
const inst = (attack: string, startTick = 10): AttackInstance => ({ id: 1, attackerId: 1, attack: attack as AttackInstance["attack"], startTick, active: true, hitList: new Set() });
const sockets = (): WeaponSockets => ({ hilt: vec3(), tip: vec3() });

describe("미리 구운 소켓 궤적", () => {
  it("소수 틱은 선형 보간, 범위 밖은 끝값", () => {
    const out = new Array<number>(6);
    sampleTrack(track, 0.5, out);
    expect(out.map((v) => +v.toFixed(4))).toEqual([0.125, 1, 0.375, 0.375, 1, 1.125]);
    sampleTrack(track, -3, out);
    expect(out[2]).toBeCloseTo(0.5, 6);
    sampleTrack(track, 99, out);
    expect(out[3]).toBeCloseTo(1.5, 6);
  });

  it("캐릭터 기준 → 월드: 위치 + yaw 회전 (+Z 정면, +X 오른쪽)", () => {
    const fallback: WeaponSocketProvider = { sample: () => false };
    const p = new BakedSocketProvider(new Map([["player", new Map([["attack_light_1", track]])]]), fallback);
    const e = createEntity(1, "player", "player", { x: 10, y: 2, z: -3 }, Math.PI / 2); // +X를 본다
    const out = sockets();
    expect(p.sample(e, inst("attack_light_1"), 10, out)).toBe(true); // 공격 시작 틱 = 궤적 틱 0
    // 정면(+Z 0.5/1.5)이 월드 +X로
    expect([out.hilt.x, out.hilt.y, out.hilt.z].map((v) => +v.toFixed(5))).toEqual([10.5, 3, -3]);
    expect([out.tip.x, out.tip.y, out.tip.z].map((v) => +v.toFixed(5))).toEqual([11.5, 3, -3]);
    p.sample(e, inst("attack_light_1"), 12, out); // 틱 2: 캐릭터 오른쪽(+X)은 yaw 90°에서 월드 -Z
    expect([out.tip.x, out.tip.z].map((v) => +v.toFixed(5))).toEqual([10, -4.5]);
  });

  it("궤적이 없는 아키타입/공격은 fallback", () => {
    let called = 0;
    const fallback: WeaponSocketProvider = { sample: () => (called++, true) };
    const p = new BakedSocketProvider(new Map([["player", new Map([["attack_light_1", track]])]]), fallback);
    const dummy = createEntity(2, "training_dummy", "enemy", { x: 0, y: 0, z: 0 }, 0);
    p.sample(dummy, inst("attack_light_1"), 10, sockets());
    const hero = createEntity(1, "player", "player", { x: 0, y: 0, z: 0 }, 0);
    p.sample(hero, inst("attack_heavy"), 10, sockets());
    expect(called).toBe(2);
    expect(p.has("player", "attack_light_1")).toBe(true);
    expect(p.has("player", "attack_heavy")).toBe(false);
  });
});
