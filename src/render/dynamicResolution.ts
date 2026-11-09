/**
 * 동적 해상도 제어 (Babylon 비의존): GPU 프레임 시간을 보고 렌더 해상도 배율을 조절해 목표 fps에 맞춘다.
 *
 *  - 비용 모델: 화면 픽셀에 비례하는 패스(씬, SSAO, 블룸, 안개)가 대부분이라 비용 ∝ 배율².
 *    원하는 배율 = 지금 배율 × √(예산 / 측정값).
 *  - 해상도를 바꾸면 후처리 렌더 타깃을 모두 다시 만들므로 자주 바꾸지 않는다:
 *    0.05 단위로만, 내릴 때는 최소 1초, 올릴 때는 최소 3초 간격, 바꾼 직후 1초는 측정값을 버린다(안정화).
 *  - 측정값은 GPU 프레임 시간(가능할 때). 없으면(Safari 등) 프레임 시간 — 이때는 수직 동기화로 16.7ms에 묶이므로
 *    목표 fps보다 확실히 느릴 때만 내리고, 목표에 붙어 있으면 천천히 올려 본다.
 */

export interface DynamicResolutionSettings {
  enabled: boolean;
  targetFps: number;
  /** 하한 (0.5 ~ 1) */
  minScale: number;
}

export const DEFAULT_DYNAMIC_RESOLUTION: DynamicResolutionSettings = {
  enabled: true,
  targetFps: 60,
  minScale: 0.6,
};

export type MeasureSource = "gpu" | "frame";

const STEP = 0.05;
const DOWN_INTERVAL = 1;
const UP_INTERVAL = 3;
const SETTLE = 1;
/** GPU 측정: 예산 = 목표 프레임 시간의 90% (CPU·합성 여유) */
const GPU_BUDGET = 0.9;

const quantize = (v: number): number => Math.round(v / STEP) * STEP;

export class DynamicResolution {
  readonly settings: DynamicResolutionSettings;
  /** 지금 배율 */
  scale = 1;
  private sinceChange = 99;
  private avg = 0;
  private samples = 0;

  constructor(settings: Partial<DynamicResolutionSettings> = {}) {
    this.settings = { ...DEFAULT_DYNAMIC_RESOLUTION, ...settings };
  }

  /**
   * 렌더 프레임마다.
   * @param ms 측정값 (GPU 프레임 시간 또는 프레임 시간, ms). 없으면 null
   * @param maxScale 상한 (품질 프리셋의 렌더 스케일)
   * @returns 바뀌었으면 새 배율, 아니면 null
   */
  update(ms: number | null, source: MeasureSource, dt: number, maxScale: number): number | null {
    const s = this.settings;
    const hi = Math.min(1, Math.max(0.25, maxScale));
    const lo = Math.min(hi, Math.max(0.25, s.minScale));
    if (!s.enabled) return this.set(hi);
    // 상한/하한이 바뀌면 즉시 범위 안으로
    if (this.scale > hi + 1e-6 || this.scale < lo - 1e-6) return this.set(Math.min(hi, Math.max(lo, this.scale)));

    this.sinceChange += dt;
    if (ms === null || !(ms > 0) || this.sinceChange < SETTLE) return null;
    // 짧은 지수 평균 (튀는 프레임 완화)
    this.avg = this.samples === 0 ? ms : this.avg + (ms - this.avg) * 0.1;
    this.samples++;
    if (this.samples < 10) return null;

    const frameBudget = 1000 / Math.max(10, s.targetFps);
    let want = this.scale;
    if (source === "gpu") {
      const budget = frameBudget * GPU_BUDGET;
      want = this.scale * Math.sqrt(budget / this.avg);
      // 히스테리시스: 예산 ±8% 안이면 그대로
      if (this.avg > budget * 0.92 && this.avg < budget * 1.08) want = this.scale;
    } else {
      if (this.avg > frameBudget * 1.15) want = this.scale * Math.sqrt((frameBudget * 1.05) / this.avg);
      else if (this.avg < frameBudget * 1.03) want = this.scale + STEP; // 목표에 붙어 있음 → 조금씩 올려 본다
    }
    want = Math.min(hi, Math.max(lo, quantize(want)));
    if (Math.abs(want - this.scale) < STEP / 2) return null;
    if (want < this.scale && this.sinceChange < DOWN_INTERVAL) return null;
    if (want > this.scale) {
      if (this.sinceChange < UP_INTERVAL) return null;
      want = Math.min(want, this.scale + STEP); // 올릴 때는 한 단계씩
    }
    return this.set(want);
  }

  private set(v: number): number | null {
    const q = Math.min(1, Math.max(0.25, Math.round(v * 100) / 100));
    if (Math.abs(q - this.scale) < 1e-6) return null;
    this.scale = q;
    this.sinceChange = 0;
    this.samples = 0;
    return q;
  }
}
