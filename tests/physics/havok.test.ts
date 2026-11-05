/**
 * 실제 Havok(WASM)을 Node에서 돌려 레이어 마스크와 트리거 동작을 검증한다.
 * (브라우저 없이 NullEngine 사용)
 */
import { readFileSync } from "node:fs";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PhysicsShapeBox, PhysicsShapeCapsule, PhysicsShapeSphere } from "@babylonjs/core/Physics/v2/physicsShape";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import HavokPhysics from "@babylonjs/havok";
import type { HavokInstance } from "../../src/physics/havok";
import { LAYER, LAYER_NAMES, collideMaskOf, shouldCollide, type LayerName } from "../../src/physics/layers";
import { PhysicsWorld, type TriggerEvent } from "../../src/physics/physicsWorld";

let havok: HavokInstance;
let engine: NullEngine;
let scene: Scene;
let world: PhysicsWorld;

beforeAll(async () => {
  const buf = readFileSync("node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm");
  havok = await HavokPhysics({ wasmBinary: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
});

beforeEach(async () => {
  engine = new NullEngine();
  scene = new Scene(engine);
  world = await PhysicsWorld.create(scene, { havok });
});

afterEach(() => {
  world.dispose();
  engine.dispose();
});

const box = (size: number) => new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(size, size, size), scene);
const capsule = () => new PhysicsShapeCapsule(new Vector3(0, -0.5, 0), new Vector3(0, 0.5, 0), 0.3, scene);

function node(x: number, y: number, z: number): TransformNode {
  const n = new TransformNode("n", scene);
  n.position.set(x, y, z);
  return n;
}

describe("PhysicsWorld", () => {
  it("Physics V2(Havok)가 켜지고, 렌더 프레임 자동 스텝은 꺼진다", () => {
    expect(scene.getPhysicsEngine()?.getPluginVersion()).toBe(2);
    expect(scene.physicsEnabled).toBe(false);
    new FreeCamera("cam", new Vector3(0, 0, -10), scene);
    const n = node(0, 10, 0);
    world.createBody(n, { layer: "ENVIRONMENT", shape: box(1), motion: "dynamic" });
    for (let i = 0; i < 30; i++) scene.render();
    expect(n.position.y).toBe(10); // render만으로는 떨어지지 않는다
    for (let i = 0; i < 30; i++) world.step();
    expect(n.position.y).toBeLessThan(10);
  });

  it("바디 셰이프에 레이어 마스크가 적용된다", () => {
    const b = world.createBody(node(0, 0, 0), { layer: "ENEMY", shape: capsule() });
    expect(b.shape?.filterMembershipMask).toBe(LAYER.ENEMY);
    expect(b.shape?.filterCollideMask).toBe(collideMaskOf("ENEMY"));
    expect(b.shape?.isTrigger).toBe(false);
    expect(world.layerOf(b)).toBe("ENEMY");
  });
});

describe("레이어 마스크 — 실제 Havok 충돌", () => {
  /** layer a의 동적 구를 layer b의 정적 박스 위로 떨어뜨려 막히는지 */
  function dropOnto(a: LayerName, b: LayerName): boolean {
    const n = node(0, 2, 0);
    world.createBody(node(0, 0, 0), { layer: b, shape: box(1) });
    world.createBody(n, { layer: a, shape: new PhysicsShapeSphere(Vector3.Zero(), 0.25, scene), motion: "dynamic" });
    for (let i = 0; i < 90; i++) world.step();
    return n.position.y > 0.5; // 박스 윗면(0.5)에 걸렸으면 막힌 것
  }

  const solid = LAYER_NAMES.filter((l) => l !== "TRIGGER");
  for (const a of solid) {
    for (const b of solid) {
      it(`${a} → ${b}: ${shouldCollide(a, b) ? "막힘" : "통과"}`, () => {
        expect(dropOnto(a, b)).toBe(shouldCollide(a, b));
      });
    }
  }
});

describe("TRIGGER — 오버랩 이벤트만", () => {
  function sweepThrough(layer: LayerName, motion: "animated" | "dynamic") {
    const enter: TriggerEvent[] = [];
    const exit: TriggerEvent[] = [];
    world.onTriggerEnter.add((e) => enter.push(e));
    world.onTriggerExit.add((e) => exit.push(e));
    const trigger = world.createTrigger(node(0, 0, 0), box(2));
    const n = node(-5, 0, 0);
    const mover = world.createBody(n, { layer, shape: capsule(), motion });
    for (let i = 0; i < 120; i++) {
      if (motion === "animated") n.position.x = -5 + i * 0.1;
      else mover.setLinearVelocity(new Vector3(6, 0, 0));
      world.step();
    }
    return { enter, exit, trigger, mover, finalX: n.position.x };
  }

  it("트리거 셰이프는 isTrigger, 레이어 TRIGGER", () => {
    const t = world.createTrigger(node(0, 0, 0), box(2));
    expect(t.shape?.isTrigger).toBe(true);
    expect(world.isTrigger(t)).toBe(true);
  });

  it.each(["animated", "dynamic"] as const)("PLAYER(%s)가 지나가면 진입/이탈 이벤트를 한 번씩 받고, 밀려나지 않는다", (motion) => {
    const r = sweepThrough("PLAYER", motion);
    expect(r.enter.length).toBe(1);
    expect(r.exit.length).toBe(1);
    expect(r.enter[0]?.trigger).toBe(r.trigger);
    expect(r.enter[0]?.other).toBe(r.mover);
    expect(r.enter[0]?.otherLayer).toBe("PLAYER");
    expect(r.finalX).toBeGreaterThan(5); // 충돌 응답 없이 통과
  });

  it.each(["ENEMY", "PROJECTILE", "ENVIRONMENT"] as const)("%s는 트리거 이벤트를 만들지 않는다", (layer) => {
    const r = sweepThrough(layer, "dynamic");
    expect(r.enter).toEqual([]);
    expect(r.exit).toEqual([]);
  });
});
