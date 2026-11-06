/**
 * 락온 Babylon 연결 — 실제 Havok + NullEngine (투영, 시야 레이캐스트)
 */
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LockOnSystem, type MarkerPosition } from "../../src/gameplay/camera/lockOnSystem";
import { CharacterSystem } from "../../src/physics/character/characterSystem";
import { createStaticBox } from "../../src/physics/testGeometry";
import { kill } from "../../src/sim/stats";
import { SimWorld } from "../../src/sim/world";
import { createPhysicsFixture, type PhysicsFixture } from "../physics/havokTestUtil";

let fx: PhysicsFixture;
let sim: SimWorld;
let cam: TargetCamera;

beforeEach(async () => {
  fx = await createPhysicsFixture();
  sim = new SimWorld({ movement: new CharacterSystem(fx.world) });
  cam = new TargetCamera("cam", new Vector3(0, 1.6, -4), fx.scene);
  cam.setTarget(new Vector3(0, 1.2, 10));
  fx.scene.activeCamera = cam;
});
afterEach(() => fx.dispose());

function system() {
  const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
  const lock = new LockOnSystem(fx.scene, cam, fx.world, sim, hero.id, (id) => sim.get(id)?.position ?? null);
  return { hero, lock };
}

describe("LockOnSystem", () => {
  it("화면 중앙 근처의 적에게 락온하고, 조준점은 가슴 높이", () => {
    const { lock } = system();
    sim.spawn("training_dummy", "enemy", { x: 4, y: 0, z: 6 });
    const center = sim.spawn("training_dummy", "enemy", { x: 0.2, y: 0, z: 7 });
    fx.world.step();
    expect(lock.toggle()).toBe(center.id);
    const chest = lock.targetChest({ x: 0, y: 0, z: 0 });
    expect(chest?.y).toBeCloseTo(1.8 * 0.65, 6);
  });

  it("카메라 뒤의 적이나 벽 뒤의 적은 고르지 않는다", () => {
    const { lock } = system();
    sim.spawn("training_dummy", "enemy", { x: 0, y: 0, z: -8 }); // 카메라 뒤
    sim.spawn("training_dummy", "enemy", { x: 0, y: 0, z: 8 });
    createStaticBox(fx.world, fx.scene, { center: new Vector3(0, 1.5, 4), size: new Vector3(4, 3, 0.3) });
    fx.world.step();
    expect(lock.toggle()).toBeNull();
  });

  it("같은 팀/죽은 대상은 후보가 아니다", () => {
    const { lock } = system();
    const dead = sim.spawn("training_dummy", "enemy", { x: 0, y: 0, z: 6 });
    kill(dead, null);
    sim.spawnPlayer({ x: 0, y: 0, z: 5 });
    fx.world.step();
    expect(lock.toggle()).toBeNull();
  });

  it("대상이 죽으면 다음 갱신에 해제된다", () => {
    const { lock } = system();
    const foe = sim.spawn("training_dummy", "enemy", { x: 0, y: 0, z: 6 });
    fx.world.step();
    lock.toggle();
    kill(foe, null);
    lock.update(1 / 60, 0);
    expect(lock.targetId).toBeNull();
    expect(lock.controller.lastReleaseReason).toBe("lost");
  });

  it("마커는 화면 안쪽 픽셀 위치에 표시된다", () => {
    const { lock } = system();
    sim.spawn("training_dummy", "enemy", { x: 0, y: 0, z: 6 });
    fx.world.step();
    lock.toggle();
    const m: MarkerPosition = { visible: false, x: 0, y: 0 };
    lock.marker(m);
    const engine = fx.scene.getEngine();
    expect(m.visible).toBe(true);
    expect(m.x).toBeCloseTo(engine.getRenderWidth() / 2, -1);
    expect(m.y).toBeGreaterThan(0);
    expect(m.y).toBeLessThan(engine.getRenderHeight());
  });
});
