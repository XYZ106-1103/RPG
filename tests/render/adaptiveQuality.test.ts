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

  it("High: 1 등불 그림자 → 2 필터 품질 → 3 캐스케이드 → 4 볼류메트릭 → 5 SSAO → 6 Medium 값 (레벨 이름은 high 유지)", () => {
    expect(adaptPreset("high", 1).lanternShadow).toBe(false);
    expect(adaptPreset("high", 1).shadowFilterQuality).toBe("high");
    expect(adaptPreset("high", 2).shadowFilterQuality).toBe("medium");
    expect(adaptPreset("high", 2).shadowCascades).toBe(4);
    expect(adaptPreset("high", 3).shadowCascades).toBe(3);
    expect(adaptPreset("high", 3).farCascadeInterval).toBe(3);
    expect(adaptPreset("high", 3).volumetric.enabled).toBe(true);
    expect(adaptPreset("high", 4).volumetric.enabled).toBe(false);
    expect(adaptPreset("high", 4).ssao.enabled).toBe(true);
    expect(adaptPreset("high", 5).ssao.enabled).toBe(false);
    const s6 = adaptPreset("high", 6);
    expect(s6.level).toBe("high");
    expect(s6.renderScale).toBe(QUALITY_PRESETS.medium.renderScale);
    expect(s6.shadowFilterQuality).toBe("low"); // Medium(중간)에서 한 단계 더
    expect(s6.ssao.enabled).toBe(false);
  });

  it("바뀌는 것이 없는 단계는 건너뛴다 (Medium은 등불 그림자·볼류메트릭이 원래 꺼짐)", () => {
    expect(nextEffectiveStep("medium", 0, 1)).toBe(2);
    expect(nextEffectiveStep("medium", 3, 1)).toBe(5);
    expect(nextEffectiveStep("medium", 5, -1)).toBe(2); // 2~4는 Medium에서 같은 결과 → 가장 낮은 2로
    expect(nextEffectiveStep("high", 0, 1)).toBe(1);
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

  it("계속 무거우면 끝까지(6) 내려가고 더는 없음", () => {
    const aq = new AdaptiveQuality();
    run(aq, 30, 90, ctx());
    expect(aq.step).toBe(6);
    expect(aq.describe("high")).toBe("자동 품질 −6 (등불 그림자 끔·태양 그림자 필터 ↓·태양 캐스케이드 3·볼류메트릭 끔·SSAO 끔·프리셋 한 단계 아래)");
  });

  it("상한 해상도 + 여유(예산 75% 미만)가 10초 이어지면 한 단계씩 복귀", () => {
    const aq = new AdaptiveQuality();
    aq.step = 2;
    const changes = run(aq, 8, 40, ctx({ atFloor: false, atMax: true }));
    expect(changes).toEqual([1, 0]);
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
