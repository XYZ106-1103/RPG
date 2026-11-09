/**
 * 자동 품질 단계 (Babylon 비의존): 동적 해상도를 하한까지 내려도 GPU 예산을 넘으면 효과를 한 단계씩 줄이고,
 * 여유가 오래 이어지면 한 단계씩 되돌린다. 사용자가 고른 프리셋(레벨)은 그대로 두고 그 위에서 임시로만 낮춘다.
 *
 * 단계 (화면 선명도를 덜 해치는 순서)
 *   1 볼류메트릭 끔 → 2 SSAO 끔 → 3 블룸 저해상도 → 4 프리셋 한 단계 아래 (효과는 1~3 유지)
 * 그 프리셋에서 아무것도 바꾸지 못하는 단계(예: Medium의 볼류메트릭은 원래 꺼짐)는 건너뛴다.
 *
 * 내림: 해상도가 하한이고 측정값이 예산을 3초 넘게 넘으면 (단계를 바꾼 뒤 4초는 판단하지 않음 — 효과 재구성·해상도 안정화)
 * 복귀: 해상도가 상한까지 돌아왔고 측정값이 예산의 75% 아래로 10초 넘게 이어지면
 */
import { QUALITY_LEVELS, QUALITY_PRESETS, type QualityLevel, type QualityPreset } from "./quality";
import type { MeasureSource } from "./dynamicResolution";

export interface AdaptiveQualitySettings {
  enabled: boolean;
}

export const DEFAULT_ADAPTIVE_QUALITY: AdaptiveQualitySettings = { enabled: true };

export const ADAPTIVE_STEP_LABELS = ["볼류메트릭 끔", "SSAO 끔", "블룸 저해상도", "프리셋 한 단계 아래"] as const;
export const MAX_ADAPTIVE_STEP = ADAPTIVE_STEP_LABELS.length;

const DOWN_AFTER = 3;
const UP_AFTER = 10;
const SETTLE = 4;
/** GPU 측정 예산 = 목표 프레임 시간의 90% (dynamicResolution.ts와 같은 기준) */
const GPU_BUDGET = 0.9;

function lowerLevel(level: QualityLevel): QualityLevel {
  const i = QUALITY_LEVELS.indexOf(level);
  return QUALITY_LEVELS[Math.max(0, i - 1)] ?? level;
}

/** 사용자 레벨 + 자동 단계 → 실제로 쓸 프리셋 (level 필드는 사용자 레벨 그대로) */
export function adaptPreset(level: QualityLevel, step: number): QualityPreset {
  const base = structuredClone(QUALITY_PRESETS[step >= 4 ? lowerLevel(level) : level]);
  const p: QualityPreset = { ...base, level };
  if (step >= 1) p.volumetric = { enabled: false, samples: 0 };
  if (step >= 2) p.ssao = { enabled: false, samples: 0 };
  if (step >= 3) p.bloom = { ...p.bloom, kernel: Math.min(p.bloom.kernel, 32), scale: Math.min(p.bloom.scale, 0.25) };
  return p;
}

/** QualityManager.override에 넘길 값 (level 제외) */
export function adaptPatch(level: QualityLevel, step: number): Omit<QualityPreset, "level"> {
  const p: Partial<QualityPreset> = adaptPreset(level, step);
  delete p.level;
  return p as Omit<QualityPreset, "level">;
}

const same = (a: QualityPreset, b: QualityPreset): boolean => JSON.stringify(a) === JSON.stringify(b);

/** from에서 dir 방향으로 실제로 무언가 바뀌는 다음 단계 (없으면 from) */
export function nextEffectiveStep(level: QualityLevel, from: number, dir: 1 | -1): number {
  const cur = adaptPreset(level, from);
  for (let s = from + dir; s >= 0 && s <= MAX_ADAPTIVE_STEP; s += dir) {
    if (!same(adaptPreset(level, s), cur)) {
      // 내려갈 때는 바뀌는 첫 단계, 올라갈 때는 같은 결과가 이어지는 가장 낮은 단계까지
      if (dir === -1) {
        let t = s;
        while (t - 1 >= 0 && same(adaptPreset(level, t - 1), adaptPreset(level, s))) t--;
        return t;
      }
      return s;
    }
  }
  return from;
}

export interface AdaptiveContext {
  level: QualityLevel;
  /** 동적 해상도가 하한에 붙어 있나 */
  atFloor: boolean;
  /** 동적 해상도가 상한(프리셋 렌더 스케일)까지 돌아왔나 */
  atMax: boolean;
  targetFps: number;
}

export class AdaptiveQuality {
  readonly settings: AdaptiveQualitySettings;
  step = 0;
  private over = 0;
  private under = 0;
  private sinceChange = 99;

  constructor(settings: Partial<AdaptiveQualitySettings> = {}) {
    this.settings = { ...DEFAULT_ADAPTIVE_QUALITY, ...settings };
  }

  /** 사용자가 프리셋을 바꿨을 때 — 자동 단계 없이 다시 시작 */
  reset(): void {
    this.step = 0;
    this.over = 0;
    this.under = 0;
    this.sinceChange = 0;
  }

  /** @returns 단계가 바뀌었으면 새 단계, 아니면 null */
  update(ms: number | null, source: MeasureSource, dt: number, ctx: AdaptiveContext): number | null {
    if (!this.settings.enabled) {
      if (this.step === 0) return null;
      this.reset();
      return 0;
    }
    this.sinceChange += dt;
    if (ms === null || !(ms > 0) || this.sinceChange < SETTLE) return null;
    const frameBudget = 1000 / Math.max(10, ctx.targetFps);
    const overBudget = source === "gpu" ? ms > frameBudget * GPU_BUDGET * 1.05 : ms > frameBudget * 1.15;
    const roomy = source === "gpu" ? ms < frameBudget * GPU_BUDGET * 0.75 : ms < frameBudget * 1.03;

    this.over = ctx.atFloor && overBudget ? this.over + dt : 0;
    this.under = this.step > 0 && ctx.atMax && roomy ? this.under + dt : 0;

    if (this.over >= DOWN_AFTER) {
      const next = nextEffectiveStep(ctx.level, this.step, 1);
      this.over = 0;
      if (next !== this.step) return this.change(next);
    }
    if (this.under >= UP_AFTER) {
      const next = nextEffectiveStep(ctx.level, this.step, -1);
      this.under = 0;
      if (next !== this.step) return this.change(next);
    }
    return null;
  }

  /** 패널 표시: "자동 품질 −2 (볼류메트릭 끔·SSAO 끔)" */
  describe(level: QualityLevel): string {
    if (!this.settings.enabled) return "자동 품질 꺼짐";
    if (this.step === 0) return "자동 품질 0";
    const labels: string[] = [];
    for (let s = 1; s <= this.step; s++) if (!same(adaptPreset(level, s), adaptPreset(level, s - 1))) labels.push(ADAPTIVE_STEP_LABELS[s - 1] ?? "");
    return `자동 품질 −${labels.length} (${labels.join("·")})`;
  }

  private change(step: number): number {
    this.step = step;
    this.sinceChange = 0;
    this.over = 0;
    this.under = 0;
    return step;
  }
}
