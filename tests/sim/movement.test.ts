import { describe, expect, it } from "vitest";
import type { HitQuery, SweepRequest } from "../../src/sim/combat/types";
import { PLAYER_MOVEMENT } from "../../src/sim/data/player";
import { PLAYER_TIMELINES } from "../../src/sim/data/playerTimelines";
import type { Entity, EntityId } from "../../src/sim/entity";
import { BUTTON, createInputFrame } from "../../src/sim/inputFrame";
import { FlatMovement, type MovementIntent, type MovementPort } from "../../src/sim/movement";
import { rootMotionDelta, rootMotionProgress } from "../../src/sim/player/timeline";
import { decodeWorld, encodeWorld } from "../../src/sim/serialize";
import { SIM_DT } from "../../src/sim/time";
import { SimWorld } from "../../src/sim/world";

function input(o: { press?: number; moveX?: number; moveY?: number; viewYaw?: number } = {}) {
  const f = createInputFrame();
  f.pressed = o.press ?? 0;
  f.moveX = o.moveX ?? 0;
  f.moveY = o.moveY ?? 0;
  f.viewYaw = o.viewYaw ?? 0;
  return f;
}

describe("루트 모션 곡선", () => {
  it("구간 동안 누적 이동량 합이 정확히 distance", () => {
    for (const [id, tl] of Object.entries(PLAYER_TIMELINES)) {
      const rm = tl.rootMotion;
      if (!rm) continue;
      let sum = 0;
      for (let t = 0; t < tl.length; t++) sum += rootMotionDelta(rm, t);
      expect(sum, id).toBeCloseTo(rm.distance, 9);
    }
  });

  it("easeOut은 앞쪽이 빠르고, 구간 밖에서는 움직이지 않는다", () => {
    const rm = { distance: 3, start: 4, end: 20, curve: "easeOut" as const };
    expect(rootMotionDelta(rm, 2)).toBe(0);
    expect(rootMotionDelta(rm, 5)).toBeGreaterThan(rootMotionDelta(rm, 19));
    expect(rootMotionDelta(rm, 25)).toBe(0);
    expect(rootMotionProgress(rm, 20)).toBe(1);
  });
});

describe("이동 포트 연동 (기본 FlatMovement)", () => {
  it("이동 입력은 속도 모드로 runSpeed만큼 이동", () => {
    const w = new SimWorld();
    const p = w.spawnPlayer({ x: 0, y: 0, z: 0 });
    for (let i = 0; i < 60; i++) {
      w.players.setInput(p.id, input({ moveY: 1 }));
      w.step();
    }
    // 첫 틱에 방향 전환만 하고 속도는 바로 runSpeed (가속 없음)
    expect(p.position.z).toBeCloseTo(PLAYER_MOVEMENT.runSpeed * 60 * SIM_DT, 6);
    expect(p.position.x).toBeCloseTo(0, 9);
    expect(p.grounded).toBe(true);
  });

  it("구르기는 루트 모션 모드로 입력 방향으로 정확히 roll.distance 이동", () => {
    const w = new SimWorld();
    const p = w.spawnPlayer({ x: 1, y: 0, z: 1 });
    w.players.setInput(p.id, input({ press: BUTTON.roll, moveX: 1 }));
    w.step();
    expect(w.players.get(p.id)?.moveMode).toBe("rootMotion");
    for (let i = 0; i < PLAYER_TIMELINES.roll.length; i++) w.step();
    expect(p.position.x).toBeCloseTo(1 + (PLAYER_TIMELINES.roll.rootMotion?.distance ?? 0), 9);
    expect(p.position.z).toBeCloseTo(1, 9);
  });

  it("백스텝은 바라보는 반대 방향으로 이동", () => {
    const w = new SimWorld();
    const p = w.spawnPlayer({ x: 0, y: 0, z: 0 }, 0);
    w.players.setInput(p.id, input({ press: BUTTON.roll }));
    for (let i = 0; i < PLAYER_TIMELINES.backstep.length + 1; i++) w.step();
    expect(p.position.z).toBeCloseTo(-(PLAYER_TIMELINES.backstep.rootMotion?.distance ?? 0), 9);
    expect(p.yaw).toBe(0);
  });

  it("공격은 바라보는 방향으로 조금 전진", () => {
    const w = new SimWorld();
    const p = w.spawnPlayer({ x: 0, y: 0, z: 0 }, Math.PI / 2);
    w.players.setInput(p.id, input({ press: BUTTON.attack_light }));
    for (let i = 0; i < PLAYER_TIMELINES.attack_light_1.length; i++) w.step();
    expect(p.position.x).toBeCloseTo(PLAYER_TIMELINES.attack_light_1.rootMotion?.distance ?? 0, 9);
  });

  it("플레이어가 아닌 엔티티는 정지 의도(속도 0)를 받는다", () => {
    const calls: [EntityId, MovementIntent][] = [];
    const port: MovementPort = {
      add: () => {},
      remove: () => {},
      move: (e, intent) => calls.push([e.id, { ...intent }]),
    };
    const w = new SimWorld({ movement: port });
    const enemy = w.spawn("hollow", "enemy", { x: 0, y: 0, z: 0 });
    w.step();
    expect(calls).toEqual([[enemy.id, { mode: "velocity", velX: 0, velZ: 0, dx: 0, dz: 0 }]]);
  });
});

describe("틱 순서: 상태 머신 → 이동 → 전투", () => {
  it("이동 포트는 상태 머신 다음, 전투 판정 전에 호출되어 판정은 이동 후 위치로 한다", () => {
    const order: string[] = [];
    let positionAtSweep = Number.NaN;
    const flat = new FlatMovement();
    const movement: MovementPort = {
      add: (e) => flat.add(e),
      remove: () => flat.remove(),
      move: (e, i, dt) => {
        order.push(`move:${e.id}`);
        flat.move(e, i, dt);
      },
    };
    const hitQuery: HitQuery = {
      sweep: (req: Readonly<SweepRequest>) => {
        order.push("sweep");
        positionAtSweep = req.attacker.position.z;
      },
    };
    const w = new SimWorld({ movement, hitQuery });
    const attacker: Entity = w.spawnPlayer({ x: 0, y: 0, z: 0 });
    w.players.setInput(attacker.id, input({ press: BUTTON.attack_light }));
    const hitStart = PLAYER_TIMELINES.attack_light_1.hit?.start ?? 0;
    for (let i = 0; i <= hitStart; i++) w.step();
    expect(order.slice(-2)).toEqual([`move:${attacker.id}`, "sweep"]);
    expect(positionAtSweep).toBe(attacker.position.z); // 같은 틱 이동이 반영된 위치
    expect(positionAtSweep).toBeGreaterThan(0);
  });
});

describe("이동 포트 생명주기", () => {
  it("spawn/remove/복원 시 add/remove가 호출된다", () => {
    const log: string[] = [];
    const port: MovementPort = { add: (e) => log.push(`add:${e.id}`), remove: (id) => log.push(`remove:${id}`), move: () => {} };
    const w = new SimWorld({ movement: port });
    const a = w.spawnPlayer({ x: 0, y: 0, z: 0 });
    const b = w.spawn("hollow", "enemy", { x: 1, y: 0, z: 0 });
    w.remove(a.id);
    expect(log).toEqual([`add:${a.id}`, `add:${b.id}`, `remove:${a.id}`]);
    log.length = 0;
    decodeWorld(encodeWorld(w), { movement: port });
    expect(log).toEqual([`add:${b.id}`]);
  });
});
