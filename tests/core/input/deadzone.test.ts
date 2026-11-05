import { describe, expect, it } from "vitest";
import { applyRadialDeadzone, clampLength } from "../../../src/core/input/deadzone";

const out = { x: 0, y: 0 };

describe("applyRadialDeadzone", () => {
  it("안쪽 데드존 이하는 0 (스틱 드리프트 제거)", () => {
    applyRadialDeadzone(0.1, 0.05, 0.15, 0.95, out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it("바깥쪽 데드존 이상은 크기 1", () => {
    applyRadialDeadzone(0.97, 0, 0.15, 0.95, out);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1, 9);
  });

  it("데드존 경계에서 값이 튀지 않고 0부터 다시 늘어난다", () => {
    applyRadialDeadzone(0.16, 0, 0.15, 0.95, out);
    expect(out.x).toBeCloseTo(0.0125, 6);
  });

  it("원형 데드존은 방향을 보존한다 (대각선이 축으로 끌려가지 않음)", () => {
    applyRadialDeadzone(0.4, 0.3, 0.15, 0.95, out);
    expect(Math.atan2(out.y, out.x)).toBeCloseTo(Math.atan2(0.3, 0.4), 9);
    // 축별 데드존이었다면 y=0.3은 거의 0이 됐을 값
    expect(out.y).toBeGreaterThan(0.2);
  });

  it("응답 곡선 지수는 크기에만 적용된다", () => {
    applyRadialDeadzone(0, 0.55, 0.15, 0.95, out, 2);
    expect(out.y).toBeCloseTo(0.25, 9); // (0.4/0.8)^2
    expect(out.x).toBe(0);
  });

  it("NaN 입력은 0", () => {
    applyRadialDeadzone(Number.NaN, 0.5, 0.1, 0.9, out);
    expect(out).toEqual({ x: 0, y: 0 });
  });
});

describe("clampLength", () => {
  it("키보드 대각선(1,1)은 길이 1로 정규화", () => {
    const v = clampLength({ x: 1, y: 1 });
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 9);
    expect(v.x).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it("길이 1 이하는 그대로", () => {
    expect(clampLength({ x: 0.3, y: 0.4 })).toEqual({ x: 0.3, y: 0.4 });
  });
});
