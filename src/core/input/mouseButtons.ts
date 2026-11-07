/**
 * 포인터 이벤트의 buttons 비트마스크 → 마우스 버튼 누름/뗌 변환 (DOM 비의존, 단위 테스트 가능).
 *
 * mousedown/mouseup 대신 포인터 이벤트를 쓰는 이유:
 *  - Babylon Scene은 캔버스 pointerdown에서 preventDefault()를 호출하는데, 그러면 브라우저가
 *    호환 마우스 이벤트(mousedown/mouseup)를 아예 보내지 않는다.
 *  - 포인터 이벤트는 두 번째 버튼부터(코드 버튼) pointerdown이 아니라 pointermove로 온다.
 *    그래서 이벤트 종류와 상관없이 매번 buttons 마스크를 이전 값과 비교해 바뀐 비트를 처리한다.
 */

/** buttons 비트 → MouseEvent.button 번호 (왼쪽, 오른쪽, 가운데, 뒤로, 앞으로) */
const BIT_TO_BUTTON = [0, 2, 1, 3, 4] as const;

export type MouseButtonSink = (button: number, down: boolean) => void;

export class MouseButtonTracker {
  /** 마지막으로 본 buttons 마스크 */
  private mask = 0;
  /** 눌렸지만 전달하지 않기로 한 비트 (포인터 락 전에 눌린 버튼 등) — 뗄 때도 전달하지 않는다 */
  private ignored = 0;

  /**
   * @param buttons PointerEvent.buttons
   * @param accept false면 새로 눌린 버튼은 전달하지 않고, 뗄 때까지 무시한다
   */
  update(buttons: number, accept: boolean, sink: MouseButtonSink): void {
    const changed = (buttons ^ this.mask) & 0x1f;
    if (changed === 0) return;
    for (let bit = 0; bit < BIT_TO_BUTTON.length; bit++) {
      const flag = 1 << bit;
      if ((changed & flag) === 0) continue;
      const button = BIT_TO_BUTTON[bit] ?? 0;
      if (buttons & flag) {
        if (accept) sink(button, true);
        else this.ignored |= flag;
      } else if (this.ignored & flag) {
        this.ignored &= ~flag;
      } else {
        sink(button, false);
      }
    }
    this.mask = buttons & 0x1f;
  }

  /** 지금 눌린 버튼을 모두 뗄 때까지 무시한다 (포인터 락 해제 등) */
  ignoreHeld(): void {
    this.ignored = this.mask;
  }

  /** 버튼 상태를 모르게 됐을 때 (포커스 잃음, pointercancel) — 전달 없이 초기화 */
  reset(): void {
    this.mask = 0;
    this.ignored = 0;
  }
}
