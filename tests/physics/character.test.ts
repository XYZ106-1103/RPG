/**
 * 캡슐 캐릭터 컨트롤러 — 실제 Havok(WASM)으로 검증 (Node, NullEngine)
 */
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHARACTER_DEFAULTS, CharacterController, type GroundState } from "../../src/physics/character/characterController";
import { CharacterSystem } from "../../src/physics/character/characterSystem";
import { LAYER } from "../../src/physics/layers";
import { nativeBodyId } from "../../src/physics/physicsWorld";
import { createRamp, createStairs, createStaticBox } from "../../src/physics/testGeometry";
import { BUTTON, createInputFrame } from "../../src/sim/inputFrame";
import { PLAYER_TIMELINES } from "../../src/sim/data/playerTimelines";
import { SIM_DT } from "../../src/sim/time";
import { SimWorld } from "../../src/sim/world";
import { createPhysicsFixture, type PhysicsFixture } from "./havokTestUtil";

let fx: PhysicsFixture;

beforeEach(async () => {
  fx = await createPhysicsFixture();
});
afterEach(() => fx.dispose());

const foot = { x: 0, y: 0, z: 0 };

function player(x = 0, y = 0, z = 0, layer: "PLAYER" | "ENEMY" = "PLAYER"): CharacterController {
  return new CharacterController(fx.world, { x, y, z }, { height: 1.8, radius: 0.35, layer });
}

/** 속도 모드로 ticks만큼 걷고 물리 스텝 */
function walk(c: CharacterController, vx: number, vz: number, ticks: number, onTick?: (state: GroundState) => void): void {
  for (let i = 0; i < ticks; i++) {
    c.moveVelocity(vx, vz, SIM_DT);
    fx.world.step(SIM_DT);
    onTick?.(c.groundState);
  }
}

function footOf(c: CharacterController) {
  return c.getFootPosition({ ...foot });
}

describe("중력과 접지", () => {
  it("공중에서 떨어져 바닥에 서고, 발 높이가 바닥(0)에 맞는다", () => {
    const c = player(0, 2, 0);
    const states: GroundState[] = [];
    walk(c, 0, 0, 90, (s) => states.push(s));
    expect(states[0]).toBe("airborne");
    expect(c.groundState).toBe("grounded");
    expect(footOf(c).y).toBeCloseTo(0, 1);
  });

  it("평지에서 원하는 속도대로 이동한다", () => {
    const c = player();
    walk(c, 0, 0, 10);
    const start = footOf(c).z;
    walk(c, 0, 4.6, 60);
    expect(footOf(c).z - start).toBeCloseTo(4.6, 0);
    expect(Math.abs(footOf(c).z - start - 4.6)).toBeLessThan(0.2);
  });
});

describe("경사", () => {
  it("30° 경사로는 걸어 올라간다", () => {
    createRamp(fx.world, fx.scene, { start: new Vector3(0, 0, 2), yaw: 0, angleDeg: 30, length: 8, width: 4 });
    const c = player();
    walk(c, 0, 0, 10);
    walk(c, 0, 4, 150);
    expect(footOf(c).y).toBeGreaterThan(2);
    expect(c.groundState).toBe("grounded");
  });

  it(`${CHARACTER_DEFAULTS.maxSlopeDeg}°를 넘는 55° 경사로는 오르지 못한다`, () => {
    createRamp(fx.world, fx.scene, { start: new Vector3(0, 0, 2), yaw: 0, angleDeg: 55, length: 6, width: 4 });
    const c = player();
    walk(c, 0, 0, 10);
    walk(c, 0, 4, 180);
    expect(footOf(c).y).toBeLessThan(0.6);
  });

  it("가파른 경사 위에 놓이면 미끄러져 내려온다 (오르막 입력은 무시)", () => {
    createRamp(fx.world, fx.scene, { start: new Vector3(0, 0, 2), yaw: 0, angleDeg: 55, length: 6, width: 4 });
    // 경사면 중간 높이 위에 놓는다
    const c = player(0, 3.2, 2 + 2.2);
    const states: GroundState[] = [];
    const ys: number[] = [];
    let climbWhileSliding = 0;
    for (let i = 0; i < 180; i++) {
      const before = footOf(c).y;
      c.moveVelocity(0, 3, SIM_DT); // 계속 오르막 입력
      fx.world.step(SIM_DT);
      states.push(c.groundState);
      ys.push(footOf(c).y);
      if (c.groundState === "sliding") climbWhileSliding = Math.max(climbWhileSliding, footOf(c).y - before);
    }
    expect(states).toContain("sliding");
    expect(climbWhileSliding).toBeLessThanOrEqual(1e-3); // 미끄러지는 동안 오르막 입력으로 높이를 얻지 못한다
    expect(ys[ys.length - 1]).toBeLessThan(0.5); // 바닥까지 내려옴
    expect(footOf(c).z).toBeLessThan(2.3); // 경사 아래쪽으로 밀려남
  });
});

describe("계단과 턱", () => {
  it("0.2m × 5단 계단을 올라간다", () => {
    createStairs(fx.world, fx.scene, { start: new Vector3(0, 0, 2), steps: 5, stepHeight: 0.2, stepDepth: 0.45, width: 3 });
    // 계단 위 층계참 (높이 1.0, z 4.25~8.25) — 다 올라간 뒤 떨어지지 않게
    createStaticBox(fx.world, fx.scene, { center: new Vector3(0, 0.5, 6.25), size: new Vector3(3, 1, 4) });
    const c = player();
    walk(c, 0, 0, 10);
    walk(c, 0, 3, 120);
    expect(footOf(c).y).toBeCloseTo(1.0, 1);
  });

  it("걷기 속도(2m/s)로도 계단을 오른다 (60Hz에서 틱당 3cm)", () => {
    createStairs(fx.world, fx.scene, { start: new Vector3(0, 0, 2), steps: 5, stepHeight: 0.2, stepDepth: 0.45, width: 3 });
    createStaticBox(fx.world, fx.scene, { center: new Vector3(0, 0.5, 6.25), size: new Vector3(3, 1, 4) });
    const c = player();
    walk(c, 0, 0, 10);
    // 오르는 동안 아래로 떨어졌다 다시 오르는 덜컹거림이 없어야 한다 (턱 넘기 홀드)
    let prevY = footOf(c).y;
    let maxDip = 0;
    walk(c, 0, 2, 200, () => {
      const y = footOf(c).y;
      maxDip = Math.max(maxDip, prevY - y);
      prevY = y;
    });
    expect(footOf(c).y).toBeCloseTo(1.0, 1);
    expect(maxDip).toBeLessThan(0.02);
  });

  it("계단을 내려갈 때 공중에 뜨지 않고 지면에 붙는다", () => {
    createStairs(fx.world, fx.scene, { start: new Vector3(0, 0, 2), steps: 5, stepHeight: 0.2, stepDepth: 0.45, width: 3 });
    createStaticBox(fx.world, fx.scene, { center: new Vector3(0, 0.5, 6.25), size: new Vector3(3, 1, 4) });
    const c = player(0, 1.05, 6);
    walk(c, 0, 0, 30);
    expect(footOf(c).y).toBeCloseTo(1.0, 1);
    let airborne = 0;
    walk(c, 0, -3, 90, (st) => {
      if (st === "airborne") airborne++;
    });
    expect(footOf(c).y).toBeLessThan(0.1);
    expect(airborne).toBeLessThanOrEqual(3);
  });

  it("0.25m 턱은 넘어가고, 0.5m 턱은 막힌다", () => {
    // 턱은 z 2~8로 길게 — 올라선 뒤 반대편으로 떨어지지 않게
    createStaticBox(fx.world, fx.scene, { center: new Vector3(-3, 0.125, 5), size: new Vector3(2, 0.25, 6) });
    createStaticBox(fx.world, fx.scene, { center: new Vector3(3, 0.25, 5), size: new Vector3(2, 0.5, 6) });
    const low = player(-3, 0, 0);
    const high = player(3, 0, 0);
    for (let i = 0; i < 100; i++) {
      low.moveVelocity(0, 3, SIM_DT);
      high.moveVelocity(0, 3, SIM_DT);
      fx.world.step(SIM_DT);
    }
    expect(footOf(low).y).toBeCloseTo(0.25, 1);
    expect(footOf(low).z).toBeGreaterThan(2.5);
    expect(footOf(high).y).toBeLessThan(0.1);
    expect(footOf(high).z).toBeLessThan(2 - 0.3);
  });

  it("벽에 막힌다", () => {
    createStaticBox(fx.world, fx.scene, { center: new Vector3(0, 1.5, 3.25), size: new Vector3(6, 3, 0.5) });
    const c = player();
    walk(c, 0, 5, 120);
    expect(footOf(c).z).toBeLessThan(3 - 0.3);
    expect(footOf(c).z).toBeGreaterThan(3 - 0.5);
  });
});

describe("루트 모션 모드", () => {
  it("평지에서 이동량 합만큼 정확히 움직인다", () => {
    const c = player();
    walk(c, 0, 0, 10);
    const start = footOf(c);
    for (let i = 0; i < 30; i++) {
      c.moveRootMotion(0.1, 0, SIM_DT);
      fx.world.step(SIM_DT);
    }
    expect(footOf(c).x - start.x).toBeCloseTo(3, 1);
    expect(Math.abs(footOf(c).z - start.z)).toBeLessThan(0.02);
  });

  it("루트 모션도 벽을 뚫지 않는다", () => {
    createStaticBox(fx.world, fx.scene, { center: new Vector3(2.25, 1.5, 0), size: new Vector3(0.5, 3, 6) });
    const c = player();
    for (let i = 0; i < 40; i++) {
      c.moveRootMotion(0.12, 0, SIM_DT);
      fx.world.step(SIM_DT);
    }
    expect(footOf(c).x).toBeLessThan(2 - 0.3);
  });
});

describe("충돌 레이어", () => {
  it("내부 바디에 레이어 마스크가 적용되고 월드에 등록된다 (Babylon 내부 구조 변경 감시)", () => {
    const c = player();
    expect(c.body).toBeDefined();
    expect(c.body.shape?.filterMembershipMask).toBe(LAYER.PLAYER);
    expect(fx.world.layerOf(c.body)).toBe("PLAYER");
    const id = nativeBodyId(c.body);
    expect(id).not.toBeNull();
    if (id !== null) expect(fx.world.bodyFromNativeId(id)).toBe(c.body);
  });

  it("PLAYER는 ENEMY 캐릭터에 막히고, 다른 PLAYER는 통과한다 (레이어 표)", () => {
    const blocker = player(0, 0, 3, "ENEMY");
    const ghost = player(5, 0, 3, "PLAYER");
    const a = player(0, 0, 0);
    const b = player(5, 0, 0);
    for (let i = 0; i < 90; i++) {
      a.moveVelocity(0, 4, SIM_DT);
      b.moveVelocity(0, 4, SIM_DT);
      blocker.moveVelocity(0, 0, SIM_DT);
      ghost.moveVelocity(0, 0, SIM_DT);
      fx.world.step(SIM_DT);
    }
    expect(footOf(a).z).toBeLessThan(3 - 0.6);
    expect(footOf(b).z).toBeGreaterThan(5);
  });
});

describe("CharacterSystem (sim MovementPort)", () => {
  it("sim이 의도를 정하고 컨트롤러 결과 위치가 엔티티에 다시 써진다 (벽에 막힘)", () => {
    createStaticBox(fx.world, fx.scene, { center: new Vector3(0, 1.5, 4.25), size: new Vector3(6, 3, 0.5) });
    const characters = new CharacterSystem(fx.world);
    const sim = new SimWorld({ movement: characters });
    const p = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    const f = createInputFrame();
    f.moveY = 1;
    for (let i = 0; i < 150; i++) {
      sim.players.setInput(p.id, f);
      sim.step();
      fx.world.step(SIM_DT);
    }
    const c = characters.get(p.id);
    if (!c) throw new Error("controller missing");
    const ft = c.getFootPosition({ ...foot });
    expect(p.position).toEqual({ x: ft.x, y: ft.y, z: ft.z });
    expect(p.position.z).toBeLessThan(4 - 0.3);
    expect(p.grounded).toBe(true);
  });

  it("구르기 루트 모션이 컨트롤러로 이동한다", () => {
    const characters = new CharacterSystem(fx.world);
    const sim = new SimWorld({ movement: characters });
    const p = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    for (let i = 0; i < 10; i++) {
      sim.step();
      fx.world.step(SIM_DT);
    }
    const start = p.position.x;
    const f = createInputFrame();
    f.pressed = BUTTON.roll;
    f.moveX = 1;
    sim.players.setInput(p.id, f);
    for (let i = 0; i < PLAYER_TIMELINES.roll.length + 4; i++) {
      sim.step();
      fx.world.step(SIM_DT);
    }
    expect(p.position.x - start).toBeCloseTo(PLAYER_TIMELINES.roll.rootMotion?.distance ?? 0, 0);
  });

  it("remove하면 컨트롤러와 바디가 정리된다", () => {
    const characters = new CharacterSystem(fx.world);
    const sim = new SimWorld({ movement: characters });
    const p = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    const body = characters.bodyOf(p.id);
    sim.remove(p.id);
    expect(characters.get(p.id)).toBeUndefined();
    expect(body && fx.world.layerOf(body)).toBe(null);
  });
});
