/**
 * 카메라 스프링 암 — 실제 Havok으로 검증 (Node, NullEngine)
 */
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpringArmProbe } from "../../src/gameplay/camera/springArmProbe";
import { ThirdPersonCamera } from "../../src/gameplay/camera/thirdPersonCamera";
import { CharacterController } from "../../src/physics/character/characterController";
import { createStaticBox } from "../../src/physics/testGeometry";
import { createPhysicsFixture, type PhysicsFixture } from "../physics/havokTestUtil";

let fx: PhysicsFixture;
beforeEach(async () => {
  fx = await createPhysicsFixture();
});
afterEach(() => fx.dispose());

describe("스프링 암 셰이프캐스트", () => {
  it("벽이 있으면 벽 앞(반경만큼 떨어진)까지의 거리, 없으면 null", () => {
    const probe = new SpringArmProbe(fx.world, 0.25);
    createStaticBox(fx.world, fx.scene, { center: new Vector3(0, 1.5, -2), size: new Vector3(4, 3, 0.2) }); // 면 z=-1.9
    fx.world.step();
    const d = probe.cast({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 1.5, z: -4 });
    expect(d).not.toBeNull();
    expect(d ?? 0).toBeCloseTo(1.9 - 0.25, 1);
    expect(probe.cast({ x: 5, y: 1.5, z: 0 }, { x: 5, y: 1.5, z: -4 })).toBeNull();
  });

  it("캐릭터(적/플레이어 캡슐)는 막지 않는다", () => {
    const probe = new SpringArmProbe(fx.world);
    new CharacterController(fx.world, { x: 0, y: 0, z: -2 }, { height: 1.8, radius: 0.4, layer: "ENEMY" });
    new CharacterController(fx.world, { x: 0, y: 0, z: -3 }, { height: 1.8, radius: 0.4, layer: "PLAYER" });
    fx.world.step();
    expect(probe.cast({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 1.2, z: -4 })).toBeNull();
  });
});

describe("3인칭 카메라", () => {
  const still = { x: 0, y: 0 };

  it("벽에 파묻히지 않는다: 뒤에 벽이 있으면 카메라가 벽 앞에 선다", () => {
    createStaticBox(fx.world, fx.scene, { center: new Vector3(0, 2, -1.6), size: new Vector3(6, 4, 0.2) });
    fx.world.step();
    const cam = new ThirdPersonCamera(fx.scene, new SpringArmProbe(fx.world));
    cam.snapTo(0, 0);
    for (let i = 0; i < 30; i++) cam.update(1 / 60, { look: still, follow: { x: 0, y: 0, z: 0 }, lockTarget: null });
    expect(cam.camera.position.z).toBeGreaterThan(-1.5);
    expect(cam.armLength).toBeLessThan(cam.settings.distance);
  });

  it("벽이 없으면 설정 거리만큼 뒤에 선다", () => {
    const cam = new ThirdPersonCamera(fx.scene, new SpringArmProbe(fx.world));
    cam.snapTo(0, 0);
    for (let i = 0; i < 30; i++) cam.update(1 / 60, { look: still, follow: { x: 0, y: 0, z: 0 }, lockTarget: null });
    expect(cam.armLength).toBeCloseTo(cam.settings.distance, 1);
    expect(cam.camera.position.z).toBeLessThan(-3);
    // 오른쪽 어깨 너머
    expect(cam.camera.position.x).toBeGreaterThan(0.2);
  });

  it("시작 직후 카메라가 서서히 기어가지 않는다 (첫 프레임에 실제 암 길이로 맞춤)", () => {
    const cam = new ThirdPersonCamera(fx.scene, new SpringArmProbe(fx.world));
    cam.snapTo(0, 0);
    const frame = { look: still, follow: { x: 0, y: 0, z: 0 }, lockTarget: null };
    cam.update(1 / 60, frame);
    const first = cam.camera.position.clone();
    for (let i = 0; i < 60; i++) cam.update(1 / 60, frame);
    expect(cam.camera.position.subtract(first).length()).toBeLessThan(1e-6);
  });

  it("회전 입력(마우스/스틱)만큼 카메라가 돈다", () => {
    const cam = new ThirdPersonCamera(fx.scene, null);
    cam.snapTo(0, 0);
    cam.update(1 / 60, { look: { x: 0.5, y: 0.2 }, follow: { x: 0, y: 0, z: 0 }, lockTarget: null });
    for (let i = 0; i < 60; i++) cam.update(1 / 60, { look: still, follow: { x: 0, y: 0, z: 0 }, lockTarget: null });
    expect(cam.viewYaw).toBeCloseTo(0.5, 6);
    expect(cam.viewPitch).toBeCloseTo(-0.2, 6); // 위를 보면 pitch 감소
  });

  it("상하 각도는 제한된다", () => {
    const cam = new ThirdPersonCamera(fx.scene, null);
    cam.update(1 / 60, { look: { x: 0, y: -10 }, follow: { x: 0, y: 0, z: 0 }, lockTarget: null });
    expect(cam.getTargetRotation().pitch).toBeCloseTo((cam.settings.pitchMaxDeg * Math.PI) / 180, 9);
    cam.update(1 / 60, { look: { x: 0, y: 10 }, follow: { x: 0, y: 0, z: 0 }, lockTarget: null });
    expect(cam.getTargetRotation().pitch).toBeCloseTo((cam.settings.pitchMinDeg * Math.PI) / 180, 9);
  });

  it("락온 중에는 회전 입력을 무시하고 대상 쪽으로 돈다", () => {
    const cam = new ThirdPersonCamera(fx.scene, null);
    cam.snapTo(0, 0);
    for (let i = 0; i < 120; i++) cam.update(1 / 60, { look: { x: 0.3, y: 0 }, follow: { x: 0, y: 0, z: 0 }, lockTarget: { x: 10, y: 1.3, z: 0 } });
    expect(cam.viewYaw).toBeCloseTo(Math.PI / 2, 1);
  });

  it("회전 스무딩은 프레임 독립적이다", () => {
    const a = new ThirdPersonCamera(fx.scene, null);
    const b = new ThirdPersonCamera(fx.scene, null);
    a.snapTo(0, 0);
    b.snapTo(0, 0);
    a.update(1 / 30, { look: { x: 1, y: 0 }, follow: { x: 0, y: 0, z: 0 }, lockTarget: null });
    for (let i = 0; i < 4; i++) b.update(1 / 120, { look: { x: i === 0 ? 1 : 0, y: 0 }, follow: { x: 0, y: 0, z: 0 }, lockTarget: null });
    for (let i = 0; i < 9; i++) a.update(1 / 30, { look: still, follow: { x: 0, y: 0, z: 0 }, lockTarget: null });
    for (let i = 0; i < 36; i++) b.update(1 / 120, { look: still, follow: { x: 0, y: 0, z: 0 }, lockTarget: null });
    expect(a.viewYaw).toBeCloseTo(b.viewYaw, 6);
  });

  it("셰이크가 카메라를 흔들고 끝나면 원래대로 돌아온다", () => {
    const cam = new ThirdPersonCamera(fx.scene, null);
    cam.snapTo(0, 0);
    const frame = { look: still, follow: { x: 0, y: 0, z: 0 }, lockTarget: null };
    for (let i = 0; i < 30; i++) cam.update(1 / 60, frame);
    const rest = cam.camera.position.clone();
    cam.shake.add({ amplitude: 1, duration: 0.2 });
    cam.update(1 / 60, frame);
    cam.update(1 / 60, frame);
    expect(cam.camera.position.equalsWithEpsilon(rest, 1e-4)).toBe(false);
    for (let i = 0; i < 30; i++) cam.update(1 / 60, frame);
    expect(cam.camera.position.subtract(rest).length(), `rest=${rest} now=${cam.camera.position}`).toBeLessThan(1e-6);
  });
});
