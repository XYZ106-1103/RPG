import { readFileSync } from "node:fs";
import HavokPhysics from "@babylonjs/havok";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import type { HavokInstance } from "../../src/physics/havok";
import { PhysicsWorld } from "../../src/physics/physicsWorld";
import { createStaticBox } from "../../src/physics/testGeometry";

let havok: Promise<HavokInstance> | null = null;

/** Node에서 실제 Havok WASM 로드 (파일을 직접 넘김) */
export function loadHavokForTests(): Promise<HavokInstance> {
  if (!havok) {
    const buf = readFileSync("node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm");
    havok = HavokPhysics({ wasmBinary: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  }
  return havok;
}

export interface PhysicsFixture {
  engine: NullEngine;
  scene: Scene;
  world: PhysicsWorld;
  dispose(): void;
}

/** 윗면이 y=0인 넓은 바닥이 있는 물리 월드 */
export async function createPhysicsFixture(withGround = true): Promise<PhysicsFixture> {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const world = await PhysicsWorld.create(scene, { havok: await loadHavokForTests() });
  if (withGround) createStaticBox(world, scene, { center: new Vector3(0, -0.5, 0), size: new Vector3(200, 1, 200), name: "ground" });
  return {
    engine,
    scene,
    world,
    dispose() {
      world.dispose();
      engine.dispose();
    },
  };
}
