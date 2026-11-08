/**
 * FPS 측정: windowSeconds마다 (프레임 수 / 경과 시간)으로 갱신한다 (Babylon 비의존).
 */
export class FpsMeter {
  private frames = 0;
  private elapsed = 0;
  private value = 0;
  private worstFrame = 0;
  private worst = 0;

  constructor(private readonly windowSeconds = 0.5) {}

  update(dt: number): void {
    if (!(dt > 0)) return;
    this.frames++;
    this.elapsed += dt;
    this.worstFrame = Math.max(this.worstFrame, dt);
    if (this.elapsed >= this.windowSeconds - 1e-9) {
      this.value = this.frames / this.elapsed;
      this.worst = this.worstFrame;
      this.frames = 0;
      this.elapsed = 0;
      this.worstFrame = 0;
    }
  }

  get fps(): number {
    return this.value;
  }

  /** 직전 측정 구간의 가장 긴 프레임 (ms) — 끊김 확인용 */
  get worstFrameMs(): number {
    return this.worst * 1000;
  }
}

/**
 * 구간 시간(ms)의 지수 이동 평균 — 디버그 패널에서 숫자가 덜 튀게 (Babylon 비의존).
 * smoothing은 새 값의 반영 비율 (0~1).
 */
export class AverageMs {
  private value = 0;
  private started = false;

  constructor(private readonly smoothing = 0.1) {}

  add(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (!this.started) {
      this.value = ms;
      this.started = true;
    } else this.value += (ms - this.value) * this.smoothing;
  }

  get ms(): number {
    return this.value;
  }
}
