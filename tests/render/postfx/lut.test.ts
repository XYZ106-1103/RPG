import { describe, expect, it } from "vitest";
import { NEUTRAL_LUT_PARAMS, generateLut, gradeColor, identityLut, lerpLut, luminance, lutToRgba8, parseCubeLut, resampleLut, sampleLut } from "../../../src/render/postfx/lut";
import { ASHEN_PLAINS } from "../../../src/render/postfx/regions";

const sample = (lut: ReturnType<typeof identityLut>, r: number, g: number, b: number): number[] => {
  const o: [number, number, number] = [0, 0, 0];
  sampleLut(lut, r, g, b, o);
  return o;
};

describe("LUT 생성", () => {
  it("중립 파라미터 = 항등 (R이 가장 빠른 인덱스)", () => {
    const lut = identityLut(4);
    expect(lut.data.length).toBe(4 * 4 * 4 * 3);
    // 인덱스 (r=1, g=2, b=3) → 1/3, 2/3, 1
    const i = (1 + 2 * 4 + 3 * 16) * 3;
    expect([...lut.data.slice(i, i + 3)].map((v) => +v.toFixed(4))).toEqual([0.3333, 0.6667, 1]);
    for (const [r, g, b] of [[0.1, 0.5, 0.9], [0.77, 0.2, 0.33]] as const) {
      sample(lut, r, g, b).forEach((v, k) => expect(v).toBeCloseTo([r, g, b][k] as number, 5));
    }
  });

  it("재의 평원: 채도가 낮아지고 회색은 거의 그대로", () => {
    const o: [number, number, number] = [0, 0, 0];
    gradeColor(ASHEN_PLAINS.lutParams, 0.8, 0.3, 0.2, o);
    const spread = Math.max(...o) - Math.min(...o);
    expect(spread).toBeLessThan(0.6 * 0.7); // 원본 차이 0.6 → 채도 55% + 색조·대비
    gradeColor(ASHEN_PLAINS.lutParams, 0.5, 0.5, 0.5, o);
    expect(Math.abs(luminance(...o) - 0.5)).toBeLessThan(0.05);
  });

  it("값은 항상 0~1", () => {
    const lut = generateLut({ ...NEUTRAL_LUT_PARAMS, contrast: 3, brightness: 0.3, saturation: 2 }, 8);
    expect(Math.min(...lut.data)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...lut.data)).toBeLessThanOrEqual(1);
  });
});

describe(".cube 파서", () => {
  const cube2 = (map: (r: number, g: number, b: number) => [number, number, number]): string => {
    const lines = ["# 주석", 'TITLE "test"', "LUT_3D_SIZE 2", ""];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(map(r, g, b).join(" "));
    return lines.join("\n");
  };

  it("항등 .cube → 항등 LUT", () => {
    const lut = parseCubeLut(cube2((r, g, b) => [r, g, b]));
    expect(lut.size).toBe(2);
    expect(sample(lut, 0.25, 0.5, 0.75).map((v) => +v.toFixed(5))).toEqual([0.25, 0.5, 0.75]);
  });

  it("DOMAIN_MIN/MAX를 0~1로 정규화, CRLF 허용", () => {
    const text = cube2((r, g, b) => [r * 2, g * 2, b * 2]).replace("LUT_3D_SIZE 2", "LUT_3D_SIZE 2\r\nDOMAIN_MIN 0 0 0\r\nDOMAIN_MAX 2 2 2");
    const lut = parseCubeLut(text);
    expect(sample(lut, 1, 1, 1)).toEqual([1, 1, 1]);
  });

  it("잘못된 파일은 이유와 함께 거부", () => {
    expect(() => parseCubeLut("LUT_3D_SIZE 2\n0 0 0")).toThrow(/데이터 개수/);
    expect(() => parseCubeLut("0 0 0")).toThrow(/LUT_3D_SIZE/);
    expect(() => parseCubeLut("LUT_1D_SIZE 4")).toThrow(/1D/);
    expect(() => parseCubeLut(cube2(() => [0, 0, 0]).replace("0 0 0", "0 x 0"))).toThrow(/숫자/);
  });
});

describe("리샘플/보간/업로드", () => {
  it("리샘플은 색 대응을 유지", () => {
    const src = generateLut(ASHEN_PLAINS.lutParams, 17);
    const dst = resampleLut(src, 32);
    expect(dst.size).toBe(32);
    const a = sample(src, 0.6, 0.4, 0.2);
    sample(dst, 0.6, 0.4, 0.2).forEach((v, k) => expect(v).toBeCloseTo(a[k] as number, 2));
  });

  it("lerp 0 = a, 1 = b, 0.5 = 중간", () => {
    const a = identityLut(4);
    const b = generateLut({ ...NEUTRAL_LUT_PARAMS, saturation: 0 }, 4);
    const out = identityLut(4);
    lerpLut(a, b, 0, out);
    expect([...out.data]).toEqual([...a.data]);
    lerpLut(a, b, 1, out);
    expect([...out.data]).toEqual([...b.data]);
    lerpLut(a, b, 0.5, out);
    expect(out.data[5]).toBeCloseTo(((a.data[5] as number) + (b.data[5] as number)) / 2, 6);
    expect(() => lerpLut(a, identityLut(8), 0.5, out)).toThrow();
  });

  it("RGBA8: 알파 255, 버퍼 재사용", () => {
    const lut = identityLut(2);
    const buf = lutToRgba8(lut);
    expect(buf.length).toBe(32);
    expect([...buf.slice(4, 8)]).toEqual([255, 0, 0, 255]);
    expect(lutToRgba8(lut, buf)).toBe(buf);
  });
});
