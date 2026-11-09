import { describe, expect, it } from "vitest";
import { cascadeUpdates } from "../../src/render/cascadeSchedule";
import { lanternFlicker } from "../../src/render/lanternFlicker";
import { QUALITY_LEVELS, QUALITY_PRESETS, QualityManager, initialQualityLevel, nextShadowFilterOverride, resolveShadowFilter, type QualityPreset } from "../../src/render/quality";

describe("품질 프리셋", () => {
  it("Low → Ultra로 갈수록 그림자/효과가 같거나 좋아진다", () => {
    const order = QUALITY_LEVELS.map((l) => QUALITY_PRESETS[l]);
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1] as QualityPreset;
      const b = order[i] as QualityPreset;
      expect(b.shadowMapSize).toBeGreaterThanOrEqual(a.shadowMapSize);
      expect(b.shadowCascades).toBeGreaterThanOrEqual(a.shadowCascades);
      expect(b.farCascadeInterval).toBeLessThanOrEqual(a.farCascadeInterval);
      expect(b.lanternShadowInterval).toBeLessThanOrEqual(a.lanternShadowInterval);
      expect(b.ssao.samples).toBeGreaterThanOrEqual(a.ssao.samples);
      expect(b.vegetationDensity).toBeGreaterThanOrEqual(a.vegetationDensity);
      expect(b.renderScale).toBeGreaterThanOrEqual(a.renderScale);
    }
    for (const p of order) expect(p.shadowCascades).toBeGreaterThanOrEqual(2);
    expect(QUALITY_PRESETS.ultra.shadowCascades).toBe(4);
  });

  it("태양 그림자 필터: Low~High는 PCF(저·중·고), Ultra만 PCSS", () => {
    expect(QUALITY_LEVELS.map((l) => `${QUALITY_PRESETS[l].shadowFilter}/${QUALITY_PRESETS[l].shadowFilterQuality}`)).toEqual([
      "pcf/low",
      "pcf/medium",
      "pcf/high",
      "pcss/high",
    ]);
  });

  it("필터 강제(F4): 프리셋 → PCF → PCSS → 프리셋 순환, 강제하면 프리셋과 무관", () => {
    expect(nextShadowFilterOverride("preset")).toBe("pcf");
    expect(nextShadowFilterOverride("pcf")).toBe("pcss");
    expect(nextShadowFilterOverride("pcss")).toBe("preset");
    expect(resolveShadowFilter(QUALITY_PRESETS.high, "preset")).toBe("pcf");
    expect(resolveShadowFilter(QUALITY_PRESETS.high, "pcss")).toBe("pcss");
    expect(resolveShadowFilter(QUALITY_PRESETS.ultra, "preset")).toBe("pcss");
    expect(resolveShadowFilter(QUALITY_PRESETS.ultra, "pcf")).toBe("pcf");
  });

  it("등불 그림자는 High 이상에서만", () => {
    expect(QUALITY_LEVELS.filter((l) => QUALITY_PRESETS[l].lanternShadow)).toEqual(["high", "ultra"]);
  });

  it("시작 프리셋: URL > 저장값 > High", () => {
    expect(initialQualityLevel("", null)).toBe("high");
    expect(initialQualityLevel("", "low")).toBe("low");
    expect(initialQualityLevel("?quality=Ultra", "low")).toBe("ultra");
    expect(initialQualityLevel("?quality=bogus", "medium")).toBe("medium");
    expect(initialQualityLevel("", "bogus")).toBe("high");
  });
});

describe("QualityManager", () => {
  it("구독하면 현재 값으로 한 번 호출, 이후에는 구독한 항목이 실제로 바뀔 때만", () => {
    const q = new QualityManager("high");
    const shadow: string[] = [];
    const scale: number[] = [];
    q.subscribe(["shadowMapSize", "shadowCascades"], (p, prev) => shadow.push(`${prev?.level ?? "init"}→${p.level}`));
    q.subscribe(["renderScale"], (p) => scale.push(p.renderScale));
    expect(shadow).toEqual(["init→high"]);
    q.setLevel("ultra"); // 그림자 해상도 바뀜, 렌더 스케일은 1 그대로
    expect(shadow).toEqual(["init→high", "high→ultra"]);
    expect(scale).toEqual([1]);
    q.setLevel("low");
    expect(scale).toEqual([1, 0.75]);
    q.setLevel("low"); // 같은 값이면 아무도 안 불림
    expect(shadow).toHaveLength(3);
  });

  it("override: 일부 항목만 바꾸고 level은 그대로, 해제하면 더 안 불림", () => {
    const q = new QualityManager("medium");
    const calls: number[] = [];
    const off = q.subscribe(["farCascadeInterval"], (p) => calls.push(p.farCascadeInterval));
    q.override({ farCascadeInterval: 1 });
    expect(q.level).toBe("medium");
    expect(calls).toEqual([3, 1]);
    off();
    q.override({ farCascadeInterval: 5 });
    expect(calls).toEqual([3, 1]);
  });

  it("중첩 값(ssao)도 내용으로 비교", () => {
    const q = new QualityManager("high");
    let n = 0;
    q.subscribe(["ssao"], () => n++);
    q.override({ ssao: { ...QUALITY_PRESETS.high.ssao } }); // 같은 내용 (다른 객체)
    expect(n).toBe(1);
    q.override({ ssao: { enabled: true, samples: QUALITY_PRESETS.high.ssao.samples + 4 } });
    expect(n).toBe(2);
  });
});

describe("캐스케이드 갱신 스케줄", () => {
  it("근거리(0,1)는 매 프레임, 원거리(2,3)는 interval마다, 두 장은 다른 프레임에", () => {
    const rows = Array.from({ length: 4 }, (_, f) => cascadeUpdates(f, 4, 2).map(Number).join(""));
    expect(rows).toEqual(["1110", "1101", "1110", "1101"]);
    const counts = [0, 0, 0, 0];
    for (let f = 0; f < 60; f++) cascadeUpdates(f, 4, 3).forEach((u, i) => (counts[i] = (counts[i] ?? 0) + Number(u)));
    expect(counts).toEqual([60, 60, 20, 20]);
  });

  it("interval 1이면 전부 매 프레임, 캐스케이드가 2장이면 원거리 없음", () => {
    expect(cascadeUpdates(7, 4, 1)).toEqual([true, true, true, true]);
    expect(cascadeUpdates(1, 2, 4)).toEqual([true, true]);
    expect(cascadeUpdates(1, 3, 4)).toEqual([true, true, false]);
  });
});

describe("등불 깜빡임", () => {
  it("배율은 1 ± amount 안, amount 0이면 1, 시간에 따라 실제로 변한다", () => {
    let lo = 9;
    let hi = -9;
    for (let t = 0; t < 30; t += 1 / 60) {
      const v = lanternFlicker(t, 0.05);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThanOrEqual(0.95 - 1e-9);
    expect(hi).toBeLessThanOrEqual(1.05 + 1e-9);
    expect(hi - lo).toBeGreaterThan(0.05);
    expect(lanternFlicker(3.3, 0)).toBe(1);
  });

  it("프레임 사이 변화는 작다 (번쩍이지 않고 일렁임)", () => {
    let maxStep = 0;
    for (let t = 0; t < 30; t += 1 / 60) maxStep = Math.max(maxStep, Math.abs(lanternFlicker(t + 1 / 60, 0.05) - lanternFlicker(t, 0.05)));
    expect(maxStep).toBeLessThan(0.02);
  });
});
