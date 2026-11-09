import { describe, expect, it } from "vitest";
import { DynamicResolution } from "../../src/render/dynamicResolution";

/** GPU 비용 모델: 비용 = 기준 × 배율² */
const simulate = (dr: DynamicResolution, baseMs: number, seconds: number, maxScale = 1, source: "gpu" | "frame" = "gpu"): number[] => {
  const changes: number[] = [];
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const gpu = baseMs * dr.scale * dr.scale;
    const ms = source === "gpu" ? gpu : Math.max(1000 / 60, gpu);
    const r = dr.update(ms, source, dt, maxScale);
    if (r !== null) changes.push(r);
  }
  return changes;
};

describe("동적 해상도", () => {
  it("하한 기본값은 80% (그 밑은 자동 품질이 효과를 줄인다)", () => {
    expect(new DynamicResolution().settings.minScale).toBe(0.8);
  });

  it("GPU 35ms → 예산(15ms)에 맞춰 내려간다 (비용 ∝ 배율²)", () => {
    const dr = new DynamicResolution({ minScale: 0.6 });
    simulate(dr, 35, 20);
    const gpu = 35 * dr.scale * dr.scale;
    expect(dr.scale).toBeLessThan(0.75);
    expect(dr.scale).toBeGreaterThanOrEqual(0.6);
    expect(gpu).toBeLessThan(16.7);
  });

  it("하한 밑으로는 내려가지 않는다", () => {
    const dr = new DynamicResolution({ minScale: 0.7 });
    simulate(dr, 80, 20);
    expect(dr.scale).toBe(0.7);
  });

  it("여유가 있으면 상한(프리셋)까지 천천히 올라가고 넘지 않는다", () => {
    const dr = new DynamicResolution();
    dr.scale = 0.6;
    const changes = simulate(dr, 8, 60, 0.9);
    expect(dr.scale).toBe(0.9);
    // 올릴 때는 한 단계(0.05)씩, 3초 이상 간격
    for (let i = 1; i < changes.length; i++) expect((changes[i] as number) - (changes[i - 1] as number)).toBeCloseTo(0.05, 5);
  });

  it("목표 근처에서 출렁이지 않는다 (안정 후 변경 없음)", () => {
    const dr = new DynamicResolution();
    simulate(dr, 25, 30);
    const after = simulate(dr, 25, 30);
    expect(after.length).toBeLessThanOrEqual(1);
  });

  it("끄면 상한으로 고정", () => {
    const dr = new DynamicResolution({ enabled: false });
    dr.scale = 0.6;
    expect(dr.update(40, "gpu", 1 / 60, 0.9)).toBe(0.9);
    expect(dr.update(40, "gpu", 1 / 60, 0.9)).toBeNull();
  });

  it("프레임 시간 모드(GPU 측정 불가): 수직 동기화(16.7ms)에 붙어 있으면 내리지 않는다", () => {
    const dr = new DynamicResolution();
    simulate(dr, 12, 20, 1, "frame"); // GPU 여유 → 프레임은 16.7ms 고정
    expect(dr.scale).toBe(1);
    const slow = new DynamicResolution({ minScale: 0.6 });
    simulate(slow, 40, 30, 1, "frame");
    expect(slow.scale).toBeLessThan(0.8);
  });

  it("측정값이 없으면 그대로", () => {
    const dr = new DynamicResolution();
    for (let i = 0; i < 600; i++) expect(dr.update(null, "gpu", 1 / 60, 1)).toBeNull();
    expect(dr.scale).toBe(1);
  });
});
