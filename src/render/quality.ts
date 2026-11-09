/**
 * 품질 프리셋 (Low / Medium / High / Ultra)과 런타임 변경 구독 (Babylon 비의존).
 *
 * 무거운 기능은 모두 여기 값으로 켜고 끈다 (CLAUDE.md "품질 프리셋"). 각 기능은 자기가 쓰는 항목만 구독하고,
 * 프리셋이 바뀌면 그 항목 값이 실제로 달라졌을 때만 콜백을 받아 즉시 반영한다.
 *  - 지금 반영: 그림자(해상도/캐스케이드/필터/원거리 갱신/등불 그림자·갱신 간격), 렌더 스케일,
 *    후처리(SSAO/SSR/볼류메트릭/TAA·FXAA/모션 블러/블룸/DOF — render/postfx)
 *  - 값만 있음 (기능을 만들 때 구독): 식생 밀도
 */

export const QUALITY_LEVELS = ["low", "medium", "high", "ultra"] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export interface EffectQuality {
  enabled: boolean;
  /** 샘플/스텝 수 (꺼져 있으면 의미 없음) */
  samples: number;
}

export interface QualityPreset {
  level: QualityLevel;
  /** 태양 그림자 맵 해상도 (캐스케이드 한 장) */
  shadowMapSize: number;
  /** 태양 그림자 캐스케이드 수 (2~4) */
  shadowCascades: number;
  /** pcf: 가벼운 부드러운 그림자 / pcss: 접촉점은 선명하고 멀어질수록 퍼지는 그림자 (비싸다 — Ultra만) */
  shadowFilter: "pcf" | "pcss";
  shadowFilterQuality: "low" | "medium" | "high";
  /** 원거리 캐스케이드(3, 4번) 갱신 간격 (프레임). 1 = 매 프레임 */
  farCascadeInterval: number;
  /** 등불(포인트 라이트) 그림자 — 큐브맵이라 비싸다 */
  lanternShadow: boolean;
  lanternShadowMapSize: number;
  /** 등불 그림자 갱신 간격 (프레임). 1 = 매 프레임 — 큐브맵 6면이라 2면 비용이 절반 */
  lanternShadowInterval: number;
  ssao: EffectQuality;
  /** SSAO 계산 해상도 배율 (0.5 = 절반) */
  ssaoRatio: number;
  /** 반사할 젖은 면이 거의 없는 지역이 많아 Ultra 전용 */
  ssr: EffectQuality;
  /** 등불 볼류메트릭 산란. samples는 그림자 반영 레이마칭용 예약값 (지금은 해석적 적분이라 샘플을 쓰지 않는다) */
  volumetric: EffectQuality;
  /** 후처리를 쓰면 화면 MSAA가 적용되지 않으므로 항상 둘 중 하나 */
  antiAliasing: "fxaa" | "taa";
  /** 카메라 움직임 기준 모션 블러 (strength 0~1). 소울라이크는 끄고 하는 경우가 많아 Ultra 전용 */
  motionBlur: EffectQuality & { strength: number };
  /** kernel: 블룸 블러 크기, scale: 블룸 계산 해상도 배율 */
  bloom: { enabled: boolean; kernel: number; scale: number };
  /** blurLevel 0 낮음 ~ 2 높음. 전투 시야를 흐리지 않게 Ultra에만 약하게 */
  dof: { enabled: boolean; blurLevel: 0 | 1 | 2 };
  /** 식생 밀도 배율 (0~1) */
  vegetationDensity: number;
  /** 렌더 해상도 배율 (1 = 화면 해상도) */
  renderScale: number;
}

export type QualityKey = Exclude<keyof QualityPreset, "level">;

const fx = (enabled: boolean, samples: number): EffectQuality => ({ enabled, samples });

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, Readonly<QualityPreset>>> = {
  low: {
    level: "low",
    shadowMapSize: 1024,
    shadowCascades: 2,
    shadowFilter: "pcf",
    shadowFilterQuality: "low",
    farCascadeInterval: 4,
    lanternShadow: false,
    lanternShadowMapSize: 256,
    lanternShadowInterval: 2,
    ssao: fx(false, 0),
    ssaoRatio: 0.5,
    ssr: fx(false, 0),
    volumetric: fx(false, 0),
    antiAliasing: "fxaa",
    motionBlur: { enabled: false, samples: 0, strength: 0 },
    bloom: { enabled: true, kernel: 32, scale: 0.25 },
    dof: { enabled: false, blurLevel: 0 },
    vegetationDensity: 0.35,
    renderScale: 0.75,
  },
  medium: {
    level: "medium",
    shadowMapSize: 2048,
    shadowCascades: 3,
    shadowFilter: "pcf",
    shadowFilterQuality: "medium",
    farCascadeInterval: 3,
    lanternShadow: false,
    lanternShadowMapSize: 256,
    lanternShadowInterval: 2,
    ssao: fx(true, 8),
    ssaoRatio: 0.5,
    ssr: fx(false, 0),
    volumetric: fx(false, 0),
    antiAliasing: "fxaa",
    motionBlur: { enabled: false, samples: 0, strength: 0 },
    bloom: { enabled: true, kernel: 48, scale: 0.5 },
    dof: { enabled: false, blurLevel: 0 },
    vegetationDensity: 0.6,
    renderScale: 0.9,
  },
  high: {
    level: "high",
    shadowMapSize: 2048,
    shadowCascades: 4,
    shadowFilter: "pcf",
    shadowFilterQuality: "high",
    farCascadeInterval: 2,
    lanternShadow: true,
    lanternShadowMapSize: 512,
    lanternShadowInterval: 2,
    ssao: fx(true, 8),
    ssaoRatio: 0.5,
    ssr: fx(false, 0),
    volumetric: fx(true, 32),
    antiAliasing: "taa",
    motionBlur: { enabled: false, samples: 0, strength: 0 },
    bloom: { enabled: true, kernel: 64, scale: 0.5 },
    dof: { enabled: false, blurLevel: 0 },
    vegetationDensity: 0.85,
    renderScale: 1,
  },
  ultra: {
    level: "ultra",
    shadowMapSize: 4096,
    shadowCascades: 4,
    shadowFilter: "pcss",
    shadowFilterQuality: "high",
    farCascadeInterval: 1,
    lanternShadow: true,
    lanternShadowMapSize: 1024,
    lanternShadowInterval: 1,
    ssao: fx(true, 32),
    ssaoRatio: 1,
    ssr: fx(true, 32),
    volumetric: fx(true, 64),
    antiAliasing: "taa",
    motionBlur: { enabled: true, samples: 32, strength: 0.6 },
    bloom: { enabled: true, kernel: 64, scale: 0.5 },
    dof: { enabled: true, blurLevel: 0 },
    vegetationDensity: 1,
    renderScale: 1,
  },
};

/** 태양 그림자 필터 비교용 강제 설정 (디버그 F4 / ?tune) — "preset"이면 프리셋 값 */
export const SHADOW_FILTER_OVERRIDES = ["preset", "pcf", "pcss"] as const;
export type ShadowFilterOverride = (typeof SHADOW_FILTER_OVERRIDES)[number];

/** 실제로 쓸 필터: 강제 설정이 있으면 그것, 없으면 프리셋 (품질 단계는 항상 프리셋) */
export function resolveShadowFilter(preset: Readonly<QualityPreset>, override: ShadowFilterOverride): QualityPreset["shadowFilter"] {
  return override === "preset" ? preset.shadowFilter : override;
}

/** F4 순환: 프리셋 → PCF 강제 → PCSS 강제 → 프리셋 */
export function nextShadowFilterOverride(cur: ShadowFilterOverride): ShadowFilterOverride {
  const i = SHADOW_FILTER_OVERRIDES.indexOf(cur);
  return SHADOW_FILTER_OVERRIDES[(i + 1) % SHADOW_FILTER_OVERRIDES.length] ?? "preset";
}

export const DEFAULT_QUALITY: QualityLevel = "high";
export const QUALITY_STORAGE_KEY = "ashen-lantern.quality.v1";

export function isQualityLevel(v: unknown): v is QualityLevel {
  return typeof v === "string" && (QUALITY_LEVELS as readonly string[]).includes(v);
}

/** 시작 프리셋: URL ?quality= > 저장값 > 기본(High) */
export function initialQualityLevel(search: string, stored: string | null): QualityLevel {
  const q = new URLSearchParams(search).get("quality")?.toLowerCase();
  if (isQualityLevel(q)) return q;
  if (isQualityLevel(stored)) return stored;
  return DEFAULT_QUALITY;
}

type Listener = (preset: Readonly<QualityPreset>, prev: Readonly<QualityPreset> | null) => void;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class QualityManager {
  private preset: QualityPreset;
  private readonly listeners: { keys: readonly QualityKey[] | null; fn: Listener }[] = [];

  constructor(level: QualityLevel = DEFAULT_QUALITY) {
    this.preset = structuredClone(QUALITY_PRESETS[level]);
  }

  get current(): Readonly<QualityPreset> {
    return this.preset;
  }

  get level(): QualityLevel {
    return this.preset.level;
  }

  /**
   * keys 중 하나라도 바뀌면 호출 (null = 모든 변경). 구독 즉시 현재 값으로 한 번 호출한다 (prev = null).
   * @returns 구독 해제
   */
  subscribe(keys: readonly QualityKey[] | null, fn: Listener): () => void {
    const entry = { keys, fn };
    this.listeners.push(entry);
    fn(this.preset, null);
    return () => {
      const i = this.listeners.indexOf(entry);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  setLevel(level: QualityLevel): void {
    this.apply(structuredClone(QUALITY_PRESETS[level]));
  }

  /** 프리셋 일부만 바꾸기 (디버그 GUI 등). level은 그대로 */
  override(patch: Partial<Omit<QualityPreset, "level">>): void {
    this.apply({ ...structuredClone(this.preset), ...structuredClone(patch) });
  }

  private apply(next: QualityPreset): void {
    const prev = this.preset;
    const changed = (Object.keys(next) as (keyof QualityPreset)[]).filter((k) => k !== "level" && !same(prev[k], next[k])) as QualityKey[];
    this.preset = next;
    if (changed.length === 0 && prev.level === next.level) return;
    for (const l of [...this.listeners]) {
      if (l.keys === null ? changed.length > 0 || prev.level !== next.level : l.keys.some((k) => changed.includes(k))) l.fn(next, prev);
    }
  }
}
