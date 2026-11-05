import { describe, expect, it } from "vitest";
import { angleDelta, approachAngle, wrapAngle } from "../../src/sim/math/scalar";
import * as V from "../../src/sim/math/vec3";

describe("Vec3 (out 파라미터)", () => {
  it("연산 결과를 out에 쓰고 out을 반환한다 (새 객체를 만들지 않음)", () => {
    const out = V.vec3();
    const r = V.add(out, V.vec3(1, 2, 3), V.vec3(4, 5, 6));
    expect(r).toBe(out);
    expect(out).toEqual({ x: 5, y: 7, z: 9 });
  });

  it("out이 입력과 같은 객체여도 안전하다", () => {
    const a = V.vec3(1, 2, 3);
    V.cross(a, a, V.vec3(0, 1, 0));
    expect(a).toEqual({ x: -3, y: 0, z: 1 });
    const b = V.vec3(1, 0, 0);
    V.rotateY(b, b, Math.PI / 2);
    expect(V.equalsApprox(b, V.vec3(0, 0, -1))).toBe(true);
  });

  it("yaw 규약: 0은 +Z, PI/2는 +X — fromYaw/toYaw/rotateY가 일치한다", () => {
    const f = V.fromYaw(V.vec3(), Math.PI / 2);
    expect(V.equalsApprox(f, V.vec3(1, 0, 0))).toBe(true);
    expect(V.toYaw(V.vec3(0, 0, 1))).toBe(0);
    const r = V.rotateY(V.vec3(), V.vec3(0, 0, 1), 0.8);
    expect(V.equalsApprox(r, V.fromYaw(V.vec3(), 0.8))).toBe(true);
  });

  it("normalize: 영벡터는 (0,0,0), 그 외 길이 1", () => {
    expect(V.normalize(V.vec3(), V.vec3())).toEqual({ x: 0, y: 0, z: 0 });
    expect(V.length(V.normalize(V.vec3(), V.vec3(3, 4, 12)))).toBeCloseTo(1, 12);
  });

  it("distanceXZ는 높이를 무시한다", () => {
    expect(V.distanceXZ(V.vec3(0, 0, 0), V.vec3(3, 100, 4))).toBe(5);
    expect(V.distance(V.vec3(0, 0, 0), V.vec3(3, 0, 4))).toBe(5);
  });

  it("scaleAndAdd / lerp", () => {
    expect(V.scaleAndAdd(V.vec3(), V.vec3(1, 1, 1), V.vec3(0, 2, 0), 0.5)).toEqual({ x: 1, y: 2, z: 1 });
    expect(V.lerp(V.vec3(), V.vec3(0, 0, 0), V.vec3(10, 20, 30), 0.25)).toEqual({ x: 2.5, y: 5, z: 7.5 });
  });
});

describe("각도 유틸", () => {
  it("wrapAngle은 (-PI, PI]", () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
  });

  it("angleDelta는 최단 경로", () => {
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 12);
  });

  it("approachAngle은 최대 회전량을 넘지 않는다", () => {
    expect(approachAngle(0, 1, 0.25)).toBeCloseTo(0.25, 12);
    expect(approachAngle(0, 0.1, 0.25)).toBeCloseTo(0.1, 12);
  });
});
