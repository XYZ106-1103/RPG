/**
 * 렌더 로컬 히트스톱 타이머 (Babylon 비의존).
 *
 * sim 틱은 그대로 진행하고, 공격자/피격자의 "표시"만 잠시 멈춘다.
 * 멈춘 동안 sim이 진행한 만큼 표시가 뒤처지므로, 정지가 끝나면 catchUpSeconds에 걸쳐 실제 상태로 따라잡는다.
 *
 *   advance(dt) → 0: 정지(이전 표시 유지) / 0~1: 따라잡는 중(정지 시점 표시 → 실제 표시 보간 비율) / 1: 정상
 */
/** 프레임 수 계산의 부동소수 오차 허용 (3/60초 - 1/60초×3 이 정확히 0이 아니어서 1프레임 더 멈추는 것 방지) */
const EPS = 1e-6;

export class HitstopTimer {
  private frozen = 0;
  private catchUp = 0;
  private catchTotal = 0;
  private justFroze = false;

  /** 정지 시작 (이미 멈춰 있으면 남은 시간과 새 시간 중 긴 쪽) */
  freeze(seconds: number, catchUpSeconds: number): void {
    if (!(seconds > 0)) return;
    if (this.frozen <= 0) this.justFroze = true;
    this.frozen = Math.max(this.frozen, seconds);
    this.catchTotal = Math.max(0, catchUpSeconds);
    this.catchUp = 0;
  }

  get isFrozen(): boolean {
    return this.frozen > EPS;
  }

  /** 이번 advance 직전에 막 멈췄는가 (정지 시점 표시를 저장할 타이밍) — 한 번 읽으면 지워진다 */
  consumeJustFroze(): boolean {
    const v = this.justFroze;
    this.justFroze = false;
    return v;
  }

  advance(dt: number): number {
    if (this.frozen > 0) {
      this.frozen -= dt;
      if (this.frozen > EPS) return 0;
      // 남은 시간만큼 따라잡기를 이미 진행한 것으로 친다 (프레임 독립)
      this.catchUp = this.catchTotal + this.frozen;
      this.frozen = 0;
      if (this.catchUp <= EPS || this.catchTotal <= 0) {
        this.catchUp = 0;
        return 1;
      }
      return clamp01(1 - this.catchUp / this.catchTotal);
    }
    if (this.catchUp > 0) {
      this.catchUp -= dt;
      if (this.catchUp <= EPS) {
        this.catchUp = 0;
        return 1;
      }
      return clamp01(1 - this.catchUp / this.catchTotal);
    }
    return 1;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
