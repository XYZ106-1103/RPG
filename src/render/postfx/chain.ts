/**
 * 후처리 순서와 지원 판정 (Babylon 비의존). CLAUDE.md "후처리 순서":
 *   SSAO → SSR → 볼류메트릭 라이트 → TAA → 모션 블러 → 블룸 → DOF → ACES 톤매핑 → LUT 그레이딩 → 비네팅/그레인
 * ACES와 LUT는 Babylon 이미지 처리 한 패스(imageProcessing)에서, 비네팅/그레인은 마지막 패스(finish)에서 한다.
 * TAA를 쓰지 않는 프리셋은 FXAA (후처리를 쓰면 화면 MSAA가 적용되지 않으므로 안티앨리어싱은 항상 하나).
 * FXAA는 밝기 차이로 가장자리를 찾으므로 HDR(등불처럼 1을 넘는 값)에서는 오검출이 많아 톤매핑 뒤(그레인 앞)에 둔다.
 */
import type { QualityPreset } from "../quality";

export const POSTFX_ORDER = [
  "ssao",
  "ssr",
  "volumetric",
  "taa",
  "motionBlur",
  "bloom",
  "dof",
  "imageProcessing",
  "fxaa",
  "finish",
] as const;
export type PostFxId = (typeof POSTFX_ORDER)[number];

export const POSTFX_LABELS: Readonly<Record<PostFxId, string>> = {
  ssao: "SSAO",
  ssr: "SSR",
  volumetric: "볼류메트릭",
  taa: "TAA",
  fxaa: "FXAA",
  motionBlur: "모션 블러",
  bloom: "블룸",
  dof: "DOF",
  imageProcessing: "ACES+LUT",
  finish: "비네팅/그레인",
};

/** 렌더 백엔드 기능 (엔진 caps에서 채운다) */
export interface GpuCaps {
  backend: "WebGPU" | "WebGL2";
  /** 반정밀 부동소수 렌더 타깃 (HDR 후처리) */
  halfFloatRender: boolean;
  /** 다중 렌더 타깃 (프리패스: 깊이/노멀/속도) */
  multiRenderTargets: boolean;
  /** 3D 텍스처 (LUT) */
  texture3D: boolean;
  /** 속도 버퍼 프리패스가 정상 동작 (TAA 이력 재투영) */
  velocityPrePass: boolean;
}

/** Babylon 효과별 자체 지원 검사 결과 (IsSupported 등) */
export interface EffectProbes {
  ssao2: boolean;
  ssr: boolean;
  taa: boolean;
  motionBlur: boolean;
}

export interface Support {
  ok: boolean;
  /** 미지원 이유 (ok면 빈 문자열) */
  reason: string;
}

const yes: Support = { ok: true, reason: "" };
const no = (reason: string): Support => ({ ok: false, reason });

export function resolveSupport(
  caps: GpuCaps,
  probes: EffectProbes,
): Record<PostFxId, Support> {
  const be = caps.backend;
  const mrt = caps.multiRenderTargets ? yes : no(`${be}: 다중 렌더 타깃 없음`);
  return {
    ssao: !caps.multiRenderTargets
      ? mrt
      : probes.ssao2
        ? yes
        : no(`${be}: SSAO2 미지원`),
    ssr: !caps.multiRenderTargets
      ? mrt
      : !caps.halfFloatRender
        ? no(`${be}: 반정밀 렌더 타깃 없음`)
        : probes.ssr
          ? yes
          : no(`${be}: SSR 미지원`),
    volumetric: mrt,
    // WebGL2(Safari 등)는 같은 GPU에서도 더 무겁다 — 속도 버퍼 프리패스가 드는 TAA 대신 FXAA (경량화)
    taa:
      be === "WebGL2"
        ? no("WebGL2: 경량화 — FXAA로 대체")
        : !caps.halfFloatRender
          ? no(`${be}: 반정밀 렌더 타깃 없음`)
          : !caps.velocityPrePass
            ? no(`${be}: 속도 버퍼 오류(Babylon)`)
            : probes.taa
              ? yes
              : no(`${be}: TAA 미지원`),
    fxaa: yes,
    motionBlur: !caps.multiRenderTargets
      ? mrt
      : probes.motionBlur
        ? yes
        : no(`${be}: 모션 블러 미지원`),
    bloom: yes,
    dof: yes,
    imageProcessing: yes,
    finish: yes,
  };
}

/** 프리셋이 켜라고 한 효과 */
export function wantedEffects(p: Readonly<QualityPreset>): Set<PostFxId> {
  const s = new Set<PostFxId>(["imageProcessing", "finish"]);
  if (p.ssao.enabled) s.add("ssao");
  if (p.ssr.enabled) s.add("ssr");
  if (p.volumetric.enabled) s.add("volumetric");
  s.add(p.antiAliasing === "taa" ? "taa" : "fxaa");
  if (p.motionBlur.enabled) s.add("motionBlur");
  if (p.bloom.enabled) s.add("bloom");
  if (p.dof.enabled) s.add("dof");
  return s;
}

export interface ChainPlan {
  /** 실제로 켤 효과 (정해진 순서) */
  active: PostFxId[];
  /** 프리셋은 켜라고 했지만 미지원이라 끈 효과 */
  disabled: { id: PostFxId; reason: string }[];
}

/** 프리셋 + 지원 여부 → 실제 체인. TAA가 안 되면 FXAA로 대체한다 */
export function planChain(
  p: Readonly<QualityPreset>,
  support: Readonly<Record<PostFxId, Support>>,
): ChainPlan {
  const want = wantedEffects(p);
  const disabled: ChainPlan["disabled"] = [];
  for (const id of want) {
    if (!support[id].ok) {
      disabled.push({ id, reason: support[id].reason });
      want.delete(id);
    }
  }
  if (disabled.some((d) => d.id === "taa")) want.add("fxaa");
  return { active: POSTFX_ORDER.filter((id) => want.has(id)), disabled };
}
