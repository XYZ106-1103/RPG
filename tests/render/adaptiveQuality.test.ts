import { describe, expect, it } from "vitest";
import { AdaptiveQuality, adaptPreset, nextEffectiveStep, type AdaptiveContext } from "../../src/render/adaptiveQuality";
import { QUALITY_PRESETS } from "../../src/render/quality";

const ctx = (over: Partial<AdaptiveContext> = {}): AdaptiveContext => ({ level: "high", atFloor: true, atMax: false, targetFps: 60, ...over });
const run = (aq: AdaptiveQuality, ms: number, seconds: number, c: AdaptiveContext): number[] => {
  const out: number[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    const r = aq.update(ms, "gpu", 1 / 60, c);
    if (r !== null) out.push(r);
  }
  return out;
};

describe("자동 품질: 프리셋 계산", () => {
  it("단계 0 = 사용자 프리셋 그대로", () => {
    expect(adaptPreset("high", 0)).toEqual(QUALITY_PRESETS.high);
  });

  it("High: 1 볼류메트릭 끔 → 2 SSAO 끔 → 3 블룸 저해상도 → 4 Medium 값 (레벨 이름은 high 유지)", () => {
    expect(adaptPreset("high", 1).volumetric.enabled).toBe(false);
    expect(adaptPreset("high", 1).ssao.enabled).toBe(true);
    expect(adaptPreset("high", 2).ssao.enabled).toBe(false);
    expect(adaptPreset("high", 3).bloom).toEqual({ enabled: true, kernel: 32, scale: 0.25 });
    const s4 = adaptPreset("high", 4);
    expect(s4.level).toBe("high");
    expect(s4.shadowCascades).toBe(QUALITY_PRESETS.medium.shadowCascades);
    expect(s4.ssao.enabled).toBe(false);
  });

  it("바뀌는 것이 없는 단계는 건너뛴다 (Medium은 볼류메트릭이 원래 꺼짐)", () => {
    expect(nextEffectiveStep("medium", 0, 1)).toBe(2);
    expect(nextEffectiveStep("medium", 2, -1)).toBe(0);
    expect(nextEffectiveStep("high", 0, 1)).toBe(1);
    // Low에서 4단계(한 단계 아래 = Low 그대로)는 3단계와 같다
    expect(nextEffectiveStep("low", 3, 1)).toBe(3);
  });
});

describe("자동 품질: 제어", () => {
  it("해상도 하한 + 예산 초과가 3초 이어지면 한 단계 내림, 이후 4초는 판단 보류", () => {
    const aq = new AdaptiveQuality();
    const changes = run(aq, 20, 8.5, ctx());
    expect(changes[0]).toBe(1);
    // 첫 내림: 4초 안정화(시작) + 3초 → 약 7초
    expect(changes.length).toBe(1);
  });

  it("해상도가 하한이 아니면 예산을 넘어도 내리지 않는다 (해상도가 먼저)", () => {
    const aq = new AdaptiveQuality();
    expect(run(aq, 25, 20, ctx({ atFloor: false }))).toEqual([]);
  });

  it("계속 무거우면 끝까지(4) 내려가고 더는 없음", () => {
    const aq = new AdaptiveQuality();
    run(aq, 30, 60, ctx());
    expect(aq.step).toBe(4);
    expect(aq.describe("high")).toBe("자동 품질 −4 (볼류메트릭 끔·SSAO 끔·블룸 저해상도·프리셋 한 단계 아래)");
  });

  it("상한 해상도 + 여유(예산 75% 미만)가 20초 이어지면 한 단계씩 복귀", () => {
    const aq = new AdaptiveQuality();
    aq.step = 2;
    const changes = run(aq, 8, 60, ctx({ atFloor: false, atMax: true }));
    expect(changes).toEqual([1, 0]);
  });

  it("출렁임 방지: 되돌린 뒤 곧 다시 무거워지면 그 단계에 고정하고 더는 올리지 않는다", () => {
    const aq = new AdaptiveQuality();
    aq.step = 2;
    // 여유 → 1단계로 되돌림
    expect(run(aq, 8, 30, ctx({ atFloor: false, atMax: true }))).toEqual([1]);
    // 되돌리자마자 무거움 → 다시 2단계 (고정)
    expect(run(aq, 20, 10, ctx())).toEqual([2]);
    expect(aq.describe("high")).toMatch(/고정$/);
    // 이후 여유가 길어도 올리지 않는다
    expect(run(aq, 8, 120, ctx({ atFloor: false, atMax: true }))).toEqual([]);
    // 사용자가 프리셋을 바꾸면 고정 해제
    aq.reset();
    aq.step = 2;
    expect(run(aq, 8, 30, ctx({ atFloor: false, atMax: true }))).toEqual([1]);
  });

  it("예산 근처(75~105%)에서는 오르내리지 않는다", () => {
    const aq = new AdaptiveQuality();
    aq.step = 1;
    expect(run(aq, 13.5, 60, ctx({ atFloor: true, atMax: true }))).toEqual([]);
  });

  it("끄면 즉시 0단계, reset은 0단계에서 다시 시작", () => {
    const aq = new AdaptiveQuality({ enabled: false });
    aq.step = 3;
    expect(aq.update(30, "gpu", 1 / 60, ctx())).toBe(0);
    const b = new AdaptiveQuality();
    b.step = 2;
    b.reset();
    expect(b.step).toBe(0);
  });
});
