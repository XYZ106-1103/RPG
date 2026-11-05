/**
 * 게임 루프 (Babylon 비의존).
 *
 * 렌더 루프(Babylon의 engine.runRenderLoop 등)가 매 프레임 `frame(now)`를 호출하면
 *  - 60Hz 고정 스텝으로 fixedUpdate(dt, tick)을 0~N회 실행하고
 *  - 가변 프레임으로 render(alpha, frameSeconds)를 1회 호출한다.
 * 렌더 쪽은 alpha로 "직전 스텝 상태 → 현재 스텝 상태"를 보간한다.
 *
 * 탭 비활성화 대응: 숨김 동안에는 프레임이 와도 시뮬레이션을 진행하지 않고,
 * 다시 보이게 된 첫 프레임은 경과 시간 0으로 시작한다 (복귀 시 시간 폭주 방지).
 * 일시정지(suspend) 중에도 render는 계속 호출되며 alpha는 고정된다 (일시정지 메뉴 뒤 화면 유지).
 */
import { FixedStepAccumulator, type FixedStepOptions } from "./fixedStep";

export interface GameLoopCallbacks {
  /** 고정 스텝 시뮬레이션 갱신 (dt는 항상 stepSeconds) */
  fixedUpdate(dt: number, tick: number): void;
  /** 가변 프레임 렌더. alpha: 0=직전 스텝 상태, 1에 가까울수록 현재 스텝 상태 */
  render(alpha: number, frameSeconds: number): void;
}

export interface GameLoopStats {
  /** 마지막 프레임에 실행된 스텝 수 */
  lastSteps: number;
  /** 클램프/스텝 제한으로 지금까지 버려진 총 시간 (초) */
  droppedSeconds: number;
  /** 실행된 프레임 수 */
  frames: number;
}

/** document.visibilityState를 흉내낼 수 있는 최소 인터페이스 (테스트에서 가짜 객체 주입) */
export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export class GameLoop {
  readonly accumulator: FixedStepAccumulator;
  readonly stats: GameLoopStats = { lastSteps: 0, droppedSeconds: 0, frames: 0 };

  private lastTimeMs: number | null = null;
  private suspended = false;

  constructor(
    private readonly callbacks: GameLoopCallbacks,
    options: FixedStepOptions = {},
  ) {
    this.accumulator = new FixedStepAccumulator(options);
  }

  get tick(): number {
    return this.accumulator.tick;
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  /**
   * 렌더 프레임마다 호출한다.
   * @param nowMs 단조 증가 시각 (ms) — performance.now() 또는 requestAnimationFrame 타임스탬프
   */
  frame(nowMs: number): void {
    if (this.suspended) {
      this.stats.lastSteps = 0;
      this.stats.frames++;
      this.callbacks.render(this.accumulator.alpha, 0);
      return;
    }

    let frameSeconds = 0;
    if (this.lastTimeMs !== null) {
      // 시계가 뒤로 가는 경우(타임스탬프 소스 교체 등)는 0으로 취급
      frameSeconds = Math.max(0, (nowMs - this.lastTimeMs) / 1000);
    }
    this.lastTimeMs = nowMs;

    const res = this.accumulator.advance(frameSeconds, this.callbacks.fixedUpdate);
    this.stats.lastSteps = res.steps;
    this.stats.droppedSeconds += res.droppedSeconds;
    this.stats.frames++;

    this.callbacks.render(res.alpha, frameSeconds);
  }

  /** 다음 frame()의 경과 시간을 0으로 만들고 누적 시간을 버린다. */
  resetTiming(): void {
    this.lastTimeMs = null;
    this.accumulator.resetAccumulator();
  }

  /** 시뮬레이션 진행을 멈춘다 (탭 숨김, 일시정지 메뉴 등). 렌더는 계속된다. */
  suspend(): void {
    this.suspended = true;
    // 누적 시간은 유지해 alpha가 그대로 고정되게 한다 (리셋하면 화면이 한 스텝 뒤로 튄다)
    this.lastTimeMs = null;
  }

  /** 재개. 첫 프레임은 경과 시간 0으로 시작한다 (숨김/정지 동안의 시간은 반영하지 않음). */
  resume(): void {
    this.suspended = false;
    this.lastTimeMs = null;
  }

  /**
   * 탭 숨김/복귀에 맞춰 suspend/resume을 연결한다. 반환 함수로 해제한다.
   * 참고: 멀티플레이에서는 권위 서버가 시간을 진행하므로, 클라이언트는 복귀 후 서버 스냅샷으로 재동기화한다.
   */
  bindVisibility(source: VisibilitySource): () => void {
    const onChange = (): void => {
      if (source.hidden) this.suspend();
      else this.resume();
    };
    source.addEventListener("visibilitychange", onChange);
    if (source.hidden) this.suspend();
    return () => source.removeEventListener("visibilitychange", onChange);
  }
}
