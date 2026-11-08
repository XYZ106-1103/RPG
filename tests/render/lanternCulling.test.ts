import { describe, expect, it } from "vitest";
import { sphereInCubeFace, sphereWithinRange } from "../../src/render/lanternCulling";
import { AverageMs } from "../../src/ui/fpsMeter";

/** Babylon 포인트 라이트 면 순서: +X, -X, -Y, +Y, +Z, -Z */
const FACES: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const facesOf = (d: [number, number, number], r: number): number[] =>
  FACES.flatMap((a, i) => (sphereInCubeFace(d[0], d[1], d[2], r, a[0], a[1], a[2]) ? [i] : []));

describe("등불 큐브 그림자 컬링", () => {
  it("범위: 구가 조금이라도 걸치면 포함", () => {
    expect(sphereWithinRange(10, 0, 0, 0.5, 14)).toBe(true);
    expect(sphereWithinRange(14.4, 0, 0, 0.5, 14)).toBe(true);
    expect(sphereWithinRange(15, 0, 0, 0.5, 14)).toBe(false);
    expect(sphereWithinRange(9, 9, 9, 0.5, 14)).toBe(false);
  });

  it("축 위의 작은 물체는 그 면 하나에만", () => {
    expect(facesOf([5, 0, 0], 0.2)).toEqual([0]);
    expect(facesOf([0, -3, 0], 0.2)).toEqual([2]);
    expect(facesOf([0, 0, -4], 0.2)).toEqual([5]);
  });

  it("면 경계(대각선)에 걸친 물체는 양쪽 면 모두", () => {
    expect(facesOf([3, 0, 3], 0.2)).toEqual([0, 4]);
    // 바닥 근처 대각선 아래: +X, -Y, +Z 세 면이 만나는 곳
    expect(facesOf([2, -2, 2], 0.3)).toEqual([0, 2, 4]);
  });

  it("광원을 감싸는 큰 물체는 6면 모두", () => {
    expect(facesOf([0.5, 0, 0], 2)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("보수적: 어떤 점이든 그 점이 실제로 속한 면에서는 빠지지 않는다", () => {
    for (let i = 0; i < 2000; i++) {
      const d: [number, number, number] = [Math.sin(i * 1.3) * 8, Math.cos(i * 0.7) * 8, Math.sin(i * 2.1 + 1) * 8];
      const ad = d.map(Math.abs);
      const k = ad.indexOf(Math.max(...ad));
      const face = k * 2 + ((d[k] as number) >= 0 ? 0 : 1);
      // Babylon 순서에서 Y는 -Y(2), +Y(3)
      const babylonFace = k === 1 ? ((d[1] as number) >= 0 ? 3 : 2) : face;
      expect(facesOf(d, 0.01)).toContain(babylonFace);
    }
  });
});

describe("AverageMs", () => {
  it("첫 값은 그대로, 이후 지수 이동 평균, 이상값 무시", () => {
    const a = new AverageMs(0.5);
    a.add(10);
    expect(a.ms).toBe(10);
    a.add(20);
    expect(a.ms).toBe(15);
    a.add(Number.NaN);
    a.add(-1);
    expect(a.ms).toBe(15);
  });
});
