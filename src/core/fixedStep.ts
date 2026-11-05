/**
 * 고정 타임스텝 누산기 (Babylon 비의존).
 *
 * 렌더 프레임마다 경과 시간을 쌓고, 고정 간격(기본 1/60초)만큼씩 시뮬레이션 스텝을 실행한다.
 * 남은 시간 비율이 보간 계수 alpha(0~1)가 되어, 렌더 쪽은 이전/현재 상태를 alpha로 보간한다.
 *
 * 스파이럴 오브 데스 방지:
 *  1) 한 프레임의 경과 시간을 maxFrameDelta로 자른다 (디버거 정지, 긴 GC, 탭 복귀 등).
 *  2) 한 프레임에 실행하는 스텝 수를 maxStepsPerFrame으로 제한하고, 따라잡지 못한 시간은 버린다.
 */

export interface FixedStepOptions {
  /** 고정 스텝 간격 (초). 기본 1/60 */
  stepSeconds?: number;
  /** 한 프레임에 실행할 최대 스텝 수. 기본 5 (= 60Hz에서 약 83ms 분량) */
  maxStepsPerFrame?: number;
  /** 한 프레임에서 받아들이는 최대 경과 시간 (초). 기본 0.25 */
  maxFrameDelta?: number;
}

export interface AdvanceResult {
  /** 이번 프레임에 실행된 스텝 수 */
  steps: number;
  /** 보간 계수: 마지막 스텝 이후 다음 스텝까지 진행 비율 (0 이상 1 미만) */
  alpha: number;
  /** 클램프/스텝 제한으로 버려진 시간 (초) */
  droppedSeconds: number;
}

export type FixedStepFn = (dt: number, tick: number) => void;

/** 부동소수 누적 오차로 정확히 한 스텝 분량이 1e-9초 모자라 스텝을 건너뛰는 것을 막는다. */
const EPSILON = 1e-9;

export class FixedStepAccumulator {
  readonly stepSeconds: number;
  readonly maxStepsPerFrame: number;
  readonly maxFrameDelta: number;

  private accumulator = 0;
  private tickCount = 0;
  /** advance()가 반환하는 결과 객체 (매 프레임 할당을 피하기 위해 재사용) */
  private readonly result: AdvanceResult = { steps: 0, alpha: 0, droppedSeconds: 0 };

  constructor(options: FixedStepOptions = {}) {
    this.stepSeconds = options.stepSeconds ?? 1 / 60;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? 5;
    this.maxFrameDelta = options.maxFrameDelta ?? 0.25;
    if (!(this.stepSeconds > 0)) throw new RangeError("stepSeconds는 0보다 커야 합니다.");
    if (!Number.isInteger(this.maxStepsPerFrame) || this.maxStepsPerFrame < 1) {
      throw new RangeError("maxStepsPerFrame은 1 이상의 정수여야 합니다.");
    }
    if (!(this.maxFrameDelta > 0)) throw new RangeError("maxFrameDelta는 0보다 커야 합니다.");
  }

  /** 지금까지 실행된 총 스텝 수 */
  get tick(): number {
    return this.tickCount;
  }

  /** 현재 보간 계수 */
  get alpha(): number {
    return Math.min(this.accumulator / this.stepSeconds, 1 - Number.EPSILON);
  }

  /**
   * 경과 시간을 반영하고 필요한 만큼 step을 호출한다.
   * 반환 객체는 내부에서 재사용되므로 다음 호출 전까지만 유효하다.
   */
  advance(frameSeconds: number, step: FixedStepFn): Readonly<AdvanceResult> {
    const res = this.result;
    res.steps = 0;
    res.droppedSeconds = 0;

    let dt = Number.isFinite(frameSeconds) && frameSeconds > 0 ? frameSeconds : 0;
    if (dt > this.maxFrameDelta) {
      res.droppedSeconds += dt - this.maxFrameDelta;
      dt = this.maxFrameDelta;
    }
    this.accumulator += dt;

    while (this.accumulator + EPSILON >= this.stepSeconds) {
      if (res.steps >= this.maxStepsPerFrame) {
        // 따라잡지 못한 스텝은 버리고, 한 스텝 미만의 잔여분만 남겨 alpha 연속성을 유지한다.
        const backlog = Math.floor((this.accumulator + EPSILON) / this.stepSeconds);
        res.droppedSeconds += backlog * this.stepSeconds;
        this.accumulator = Math.max(0, this.accumulator - backlog * this.stepSeconds);
        break;
      }
      this.accumulator = Math.max(0, this.accumulator - this.stepSeconds);
      this.tickCount++;
      res.steps++;
      step(this.stepSeconds, this.tickCount);
    }

    res.alpha = this.alpha;
    return res;
  }

  /** 누적된 시간을 버린다 (탭 복귀, 리스폰 순간이동 등). 틱 카운터는 유지한다. */
  resetAccumulator(): void {
    this.accumulator = 0;
  }
}
