import { describe, expect, it } from "vitest";
import { POSTFX_ORDER, planChain, resolveSupport, type EffectProbes, type GpuCaps } from "../../../src/render/postfx/chain";
import { QUALITY_LEVELS, QUALITY_PRESETS } from "../../../src/render/quality";

const FULL: GpuCaps = { backend: "WebGPU", halfFloatRender: true, multiRenderTargets: true, texture3D: true, velocityPrePass: true };
const ALL: EffectProbes = { ssao2: true, ssr: true, taa: true, motionBlur: true };

describe("후처리 체인", () => {
  it("순서는 CLAUDE.md: SSAO → SSR → 볼류메트릭 → TAA → 모션 블러 → 블룸 → DOF → ACES+LUT → (FXAA) → 비네팅/그레인", () => {
    expect(POSTFX_ORDER).toEqual(["ssao", "ssr", "volumetric", "taa", "motionBlur", "bloom", "dof", "imageProcessing", "fxaa", "finish"]);
  });

  it("프리셋별 체인 (모두 지원)", () => {
    const sup = resolveSupport(FULL, ALL);
    const chains = Object.fromEntries(QUALITY_LEVELS.map((l) => [l, planChain(QUALITY_PRESETS[l], sup).active.join(">")]));
    expect(chains).toEqual({
      low: "bloom>imageProcessing>fxaa>finish",
      medium: "ssao>bloom>imageProcessing>fxaa>finish",
      high: "ssao>volumetric>taa>motionBlur>bloom>imageProcessing>finish",
      ultra: "ssao>ssr>volumetric>taa>motionBlur>bloom>dof>imageProcessing>finish",
    });
  });

  it("안티앨리어싱은 어느 프리셋이든 정확히 하나", () => {
    const sup = resolveSupport(FULL, ALL);
    for (const l of QUALITY_LEVELS) expect(planChain(QUALITY_PRESETS[l], sup).active.filter((i) => i === "taa" || i === "fxaa")).toHaveLength(1);
  });

  it("미지원 효과는 자동으로 빠지고 이유가 남는다, TAA가 안 되면 FXAA로", () => {
    const sup = resolveSupport({ ...FULL, backend: "WebGL2", multiRenderTargets: false }, { ...ALL, taa: false });
    const plan = planChain(QUALITY_PRESETS.ultra, sup);
    expect(plan.active).toEqual(["bloom", "dof", "imageProcessing", "fxaa", "finish"]);
    expect(plan.disabled.map((d) => d.id).sort()).toEqual(["motionBlur", "ssao", "ssr", "taa", "volumetric"]);
    expect(plan.disabled.find((d) => d.id === "ssao")?.reason).toMatch(/WebGL2/);
  });

  it("속도 버퍼가 안 되는 백엔드(Babylon 9.33 WebGPU)는 TAA → FXAA, 모션 블러(카메라 기준)는 유지", () => {
    const plan = planChain(QUALITY_PRESETS.high, resolveSupport({ ...FULL, velocityPrePass: false }, ALL));
    expect(plan.active).toEqual(["ssao", "volumetric", "motionBlur", "bloom", "imageProcessing", "fxaa", "finish"]);
    expect(plan.disabled).toEqual([{ id: "taa", reason: "WebGPU: 속도 버퍼 오류(Babylon)" }]);
  });

  it("Babylon 자체 검사 실패도 반영", () => {
    const plan = planChain(QUALITY_PRESETS.ultra, resolveSupport(FULL, { ...ALL, ssr: false }));
    expect(plan.active).not.toContain("ssr");
    expect(plan.disabled).toEqual([{ id: "ssr", reason: "WebGPU: SSR 미지원" }]);
  });
});
