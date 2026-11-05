/**
 * 탭/홀드 겸용 버튼 판정 (순수 로직).
 *
 * 소울라이크 표준: 구르기 버튼을 짧게 눌렀다 떼면 "구르기", 계속 누르고 있으면 "스프린트".
 * 구르기는 뗄 때 발동한다 — 눌렀을 때 바로 구르면 스프린트하려 할 때마다 구르기가 나가기 때문.
 */

export type TapHoldResult = "none" | "tap" | "hold_end";

export class TapHoldResolver {
  private downAt: number | null = null;
  private holding = false;

  constructor(public holdMs: number) {}

  /** 눌림 */
  down(nowMs: number): void {
    if (this.downAt !== null) return; // 키 반복(auto-repeat) 무시
    this.downAt = nowMs;
    this.holding = false;
  }

  /** 뗌. 홀드 판정 전에 떼면 "tap" */
  up(nowMs: number): TapHoldResult {
    if (this.downAt === null) return "none";
    this.update(nowMs);
    const wasHolding = this.holding;
    this.downAt = null;
    this.holding = false;
    return wasHolding ? "hold_end" : "tap";
  }

  /** 시간 경과 반영. 홀드가 막 시작되었으면 true */
  update(nowMs: number): boolean {
    if (this.downAt === null || this.holding) return false;
    if (nowMs - this.downAt >= this.holdMs) {
      this.holding = true;
      return true;
    }
    return false;
  }

  /** 홀드 판정 중인가 (스프린트 유지) */
  get isHolding(): boolean {
    return this.holding;
  }

  get isDown(): boolean {
    return this.downAt !== null;
  }

  /** 아무 결과 없이 상태를 초기화 (포커스 상실 등) */
  cancel(): void {
    this.downAt = null;
    this.holding = false;
  }
}
