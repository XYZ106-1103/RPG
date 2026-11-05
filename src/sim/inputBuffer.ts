/**
 * 입력 버퍼: 버튼 눌림을 N틱 동안 보관한다.
 *
 * 소울라이크 조작감의 핵심: 공격 후딜/구르기 도중에 미리 누른 입력이,
 * 행동 가능해지는 순간(캔슬 구간)에 실행되도록 한다. 너무 오래 전에 누른 입력은 버린다.
 *
 * 사용 예 (매 sim 틱):
 *   buffer.record(frame);                       // 이번 틱 InputFrame의 pressed를 기록
 *   if (canAct && buffer.consume("roll", tick)) startRoll();
 *
 * 순수 TypeScript, 고정 크기 배열만 사용 (틱당 할당 없음).
 */
import { BUTTON, BUTTON_ACTIONS, type ButtonAction, type InputFrame } from "./inputFrame";

/** 기본 보관 시간: 60Hz에서 약 0.2초 */
export const DEFAULT_BUFFER_TICKS = 12;

const NONE = -1;
const SLOT_COUNT = 16;

function slotOf(action: ButtonAction): number {
  return 31 - Math.clz32(BUTTON[action]);
}

export class InputBuffer {
  /** 버튼 비트 위치별 마지막(미소비) 눌림 틱. NONE이면 없음 */
  private readonly pressTick = new Int32Array(SLOT_COUNT).fill(NONE);
  private readonly windowTicks: Int32Array;

  /**
   * @param defaultWindowTicks 모든 액션의 기본 보관 틱 수
   * @param windowOverrides 액션별 보관 틱 수 (예: 구르기는 짧게)
   */
  constructor(
    defaultWindowTicks: number = DEFAULT_BUFFER_TICKS,
    windowOverrides: Partial<Record<ButtonAction, number>> = {},
  ) {
    if (!Number.isInteger(defaultWindowTicks) || defaultWindowTicks < 0) {
      throw new RangeError("버퍼 틱 수는 0 이상의 정수여야 합니다.");
    }
    this.windowTicks = new Int32Array(SLOT_COUNT).fill(defaultWindowTicks);
    for (const action of BUTTON_ACTIONS) {
      const w = windowOverrides[action];
      if (w === undefined) continue;
      if (!Number.isInteger(w) || w < 0) throw new RangeError(`'${action}' 버퍼 틱 수는 0 이상의 정수여야 합니다.`);
      this.windowTicks[slotOf(action)] = w;
    }
  }

  /** InputFrame의 pressed 비트를 frame.tick 시점의 눌림으로 기록한다. */
  record(frame: Readonly<InputFrame>): void {
    this.recordMask(frame.pressed, frame.tick);
  }

  /** pressed 비트마스크를 tick 시점의 눌림으로 기록한다. 같은 버튼을 다시 누르면 시각이 갱신된다. */
  recordMask(pressedMask: number, tick: number): void {
    let mask = pressedMask & 0xffff;
    while (mask !== 0) {
      const slot = 31 - Math.clz32(mask);
      this.pressTick[slot] = tick;
      mask &= ~(1 << slot);
    }
  }

  /** 보관 시간 안에 미소비 눌림이 있는가 (소비하지 않음). */
  has(action: ButtonAction, currentTick: number): boolean {
    return this.isLive(slotOf(action), currentTick);
  }

  /** 보관 시간 안의 눌림이 있으면 소비하고 true. 같은 눌림은 한 번만 소비된다. */
  consume(action: ButtonAction, currentTick: number): boolean {
    const slot = slotOf(action);
    if (!this.isLive(slot, currentTick)) return false;
    this.pressTick[slot] = NONE;
    return true;
  }

  /**
   * 후보 중 가장 최근에 눌린 액션을 소비해 반환한다 (없으면 null).
   * 같은 틱에 눌렸다면 candidates 앞쪽이 우선이다.
   * 예: 후딜 중 공격과 구르기를 연달아 눌렀다면 나중에 누른 쪽을 실행.
   */
  consumeLatest(candidates: readonly ButtonAction[], currentTick: number): ButtonAction | null {
    let best: ButtonAction | null = null;
    let bestTick = NONE;
    for (const action of candidates) {
      const slot = slotOf(action);
      if (!this.isLive(slot, currentTick)) continue;
      const t = this.pressTick[slot] ?? NONE;
      if (t > bestTick) {
        bestTick = t;
        best = action;
      }
    }
    if (best !== null) this.pressTick[slotOf(best)] = NONE;
    return best;
  }

  /** 버퍼된 눌림이 몇 틱 전에 발생했는지 (없거나 만료면 -1). */
  age(action: ButtonAction, currentTick: number): number {
    const slot = slotOf(action);
    return this.isLive(slot, currentTick) ? currentTick - (this.pressTick[slot] ?? 0) : -1;
  }

  /** 특정 액션(생략 시 전체)의 버퍼를 비운다. 피격/사망 등으로 행동이 끊길 때 사용 */
  clear(action?: ButtonAction): void {
    if (action) this.pressTick[slotOf(action)] = NONE;
    else this.pressTick.fill(NONE);
  }

  private isLive(slot: number, currentTick: number): boolean {
    const t = this.pressTick[slot] ?? NONE;
    if (t === NONE) return false;
    const age = currentTick - t;
    return age >= 0 && age <= (this.windowTicks[slot] ?? 0);
  }
}
