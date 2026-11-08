import { describe, expect, it } from "vitest";
import { ASHEN_PLAINS, RegionGrading, pickVolume, smoothstep01, type RegionProfile, type RegionVolume } from "../../../src/render/postfx/regions";
import { identityLut } from "../../../src/render/postfx/lut";

const COLD: RegionProfile = {
  ...ASHEN_PLAINS,
  id: "cold",
  name: "차가운 시험 지역",
  lutFile: undefined,
  lutParams: { saturation: 0.8, contrast: 1, brightness: 0, shadowTint: [0.85, 0.95, 1.15], highlightTint: [0.95, 1, 1.05] },
  fogColor: [0.02, 0.04, 0.08],
  fogDensity: 0.06,
  exposureEV: -0.5,
};
const box = (id: string, priority: number, blendSeconds = 2, profileId = "cold"): RegionVolume => ({ id, profileId, min: [0, 0, 0], max: [10, 10, 10], priority, blendSeconds });

describe("지역 볼륨 선택", () => {
  it("담는 볼륨 중 priority 최대, 없으면 null", () => {
    const a = box("a", 0);
    const b = { ...box("b", 5), min: [5, 0, 5] as const };
    expect(pickVolume([a, b], 1, 1, 1)).toBe(a);
    expect(pickVolume([a, b], 6, 1, 6)).toBe(b);
    expect(pickVolume([a, b], -1, 1, 1)).toBeNull();
  });

  it("smoothstep: 0, 0.5, 1 그리고 범위 밖은 고정", () => {
    expect([smoothstep01(-1), smoothstep01(0.5), smoothstep01(2)]).toEqual([0, 0.5, 1]);
  });
});

describe("RegionGrading", () => {
  const make = (): RegionGrading => {
    const g = new RegionGrading(ASHEN_PLAINS, 8);
    g.addProfile(COLD);
    g.addVolume(box("cold_box", 1, 2));
    return g;
  };

  it("볼륨 밖이면 기본 지역 값 그대로", () => {
    const g = make();
    g.update(-5, 1, -5, 1 / 60);
    expect(g.current.id).toBe("ashen_plains");
    expect(g.look.fogDensity).toBe(ASHEN_PLAINS.fogDensity);
    expect(g.progress).toBe(1);
  });

  it("들어가면 blendSeconds에 걸쳐 부드럽게 전환 (중간은 정확히 절반), 끝나면 목표 값", () => {
    const g = make();
    g.update(5, 5, 5, 1 / 60); // 진입 프레임: 전환 시작
    expect(g.current.id).toBe("cold");
    expect(g.look.fogDensity).toBe(ASHEN_PLAINS.fogDensity);
    g.update(5, 5, 5, 1); // 1초 = 절반
    expect(g.look.fogDensity).toBeCloseTo((ASHEN_PLAINS.fogDensity + COLD.fogDensity) / 2, 6);
    expect(g.look.exposureEV).toBeCloseTo(-0.25, 6);
    expect(g.lutDirty).toBe(true);
    g.update(5, 5, 5, 1.01);
    expect(g.look.fogDensity).toBe(COLD.fogDensity);
    expect([...g.look.fogColor]).toEqual([...COLD.fogColor]);
    g.update(5, 5, 5, 1 / 60);
    expect(g.lutDirty).toBe(false); // 전환이 끝나면 LUT를 다시 올리지 않는다
  });

  it("전환 도중 나가면 지금 보이는 값에서 되돌아간다 (튀지 않음)", () => {
    const g = make();
    g.update(5, 5, 5, 0);
    g.update(5, 5, 5, 0.5);
    const mid = g.look.fogDensity;
    g.update(-5, 5, 5, 1 / 60); // 나감
    expect(g.current.id).toBe("ashen_plains");
    expect(g.look.fogDensity).toBeCloseTo(mid, 9);
    g.update(-5, 5, 5, 2.1); // 나간 볼륨의 blendSeconds(2초)로 복귀
    expect(g.look.fogDensity).toBe(ASHEN_PLAINS.fogDensity);
  });

  it("LUT 파일을 읽으면 생성값 대신 사용 (크기 맞춤)", () => {
    const g = make();
    g.setProfileLut("ashen_plains", identityLut(4));
    expect(g.lut.size).toBe(8);
    expect(g.lut.data[3]).toBeCloseTo(1 / 7, 5); // 항등: (r=1) → 1/7
    expect(() => g.setProfileLut("nope", identityLut(4))).toThrow();
    expect(() => g.addVolume(box("x", 0, 1, "nope"))).toThrow();
  });
});
