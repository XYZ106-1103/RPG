/**
 * 락온 대상 선택/전환/해제 (Babylon 비의존 — 후보 정보는 lockOnSystem.ts가 투영/레이캐스트로 만들어 넘긴다).
 *
 *  - 선택: 화면 중앙에 가깝고 가까운 대상 (점수 = 화면 중앙 거리 + 거리 비율 × distanceWeight)
 *  - 전환: 짧은 시간 안에 시점 입력을 한쪽으로 크게 휙 움직이면(마우스/오른쪽 스틱 공통) 화면에서 그쪽에 있는 다음 대상
 *  - 해제: 대상이 사라지거나, maxKeepDistance를 넘거나, 시야가 가려진 상태가 occlusionGrace초 이상 이어지면
 */

export interface LockCandidate {
  id: number;
  /** 정규화 화면 좌표: (0,0)=중앙, x는 오른쪽 +, y는 위쪽 +. 화면 밖이면 |x|>1 또는 |y|>1 */
  screenX: number;
  screenY: number;
  /** 카메라 앞에 있는가 (뒤에 있으면 화면 좌표가 의미 없음) */
  inFront: boolean;
  /** 플레이어와의 거리 (m) */
  distance: number;
  /** 카메라에서 대상 조준점까지 벽에 막히지 않았는가 */
  visible: boolean;
}

export interface LockOnSettings {
  /** 새로 고를 수 있는 최대 거리 (m) */
  maxSelectDistance: number;
  /** 유지 최대 거리 (m) — 넘으면 해제 */
  maxKeepDistance: number;
  /** 거리 점수 가중치 (클수록 가까운 대상 우선) */
  distanceWeight: number;
  /** 시야 차단 허용 시간 (초) */
  occlusionGrace: number;
  /** 휙 판정: flickWindow초 동안의 시점 입력 합이 이 값(라디안)을 넘으면 전환 */
  flickThreshold: number;
  flickWindow: number;
  /** 전환 후 다음 전환까지 대기 (초) */
  flickCooldown: number;
}

export const DEFAULT_LOCK_ON_SETTINGS: LockOnSettings = {
  maxSelectDistance: 20,
  maxKeepDistance: 25,
  distanceWeight: 0.6,
  occlusionGrace: 1.0,
  flickThreshold: 0.12,
  flickWindow: 0.15,
  flickCooldown: 0.35,
};

export type LockReleaseReason = "manual" | "lost" | "distance" | "occluded";

export class LockOnController {
  settings: LockOnSettings;
  private current: number | null = null;
  private occludedFor = 0;
  /** 최근 flickWindow초 동안의 시점 입력 기록 (시간, 양) — 고정 크기 고리 버퍼 */
  private readonly flickTimes = new Float64Array(32);
  private readonly flickAmounts = new Float64Array(32);
  private flickHead = 0;
  private clock = 0;
  private cooldown = 0;
  private lastRelease: LockReleaseReason | null = null;

  constructor(settings: Partial<LockOnSettings> = {}) {
    this.settings = { ...DEFAULT_LOCK_ON_SETTINGS, ...settings };
  }

  get target(): number | null {
    return this.current;
  }

  /** 마지막 해제 이유 (디버그 패널) */
  get lastReleaseReason(): LockReleaseReason | null {
    return this.lastRelease;
  }

  /** 락온 버튼: 걸려 있으면 해제, 아니면 고른다 */
  toggle(candidates: readonly LockCandidate[]): number | null {
    if (this.current !== null) {
      this.release("manual");
      return null;
    }
    this.current = this.pickBest(candidates);
    this.occludedFor = 0;
    return this.current;
  }

  release(reason: LockReleaseReason): void {
    if (this.current === null) return;
    this.current = null;
    this.occludedFor = 0;
    this.lastRelease = reason;
  }

  /**
   * 렌더 프레임마다: 해제 조건 확인, 휙 입력으로 대상 전환.
   * @param lookX 이번 프레임 시점 좌우 입력 (라디안, +오른쪽)
   */
  update(dt: number, candidates: readonly LockCandidate[], lookX: number): void {
    this.clock += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.current === null) return;

    let cur: LockCandidate | undefined;
    for (const c of candidates) if (c.id === this.current) cur = c;
    if (!cur) return this.release("lost");
    if (cur.distance > this.settings.maxKeepDistance) return this.release("distance");
    this.occludedFor = cur.visible ? 0 : this.occludedFor + dt;
    if (this.occludedFor > this.settings.occlusionGrace) return this.release("occluded");

    // 휙: 최근 flickWindow초 입력 합
    this.flickTimes[this.flickHead] = this.clock;
    this.flickAmounts[this.flickHead] = lookX;
    this.flickHead = (this.flickHead + 1) % this.flickTimes.length;
    let sum = 0;
    for (let i = 0; i < this.flickTimes.length; i++) {
      if (this.clock - (this.flickTimes[i] ?? -1e9) <= this.settings.flickWindow) sum += this.flickAmounts[i] ?? 0;
    }
    if (this.cooldown <= 0 && Math.abs(sum) >= this.settings.flickThreshold) {
      const next = this.pickSide(candidates, cur, sum > 0 ? 1 : -1);
      if (next !== null) this.current = next;
      this.cooldown = this.settings.flickCooldown;
      this.flickAmounts.fill(0); // 같은 휙으로 연달아 넘어가지 않게
    }
  }

  private selectable(c: LockCandidate): boolean {
    return c.inFront && c.visible && c.distance <= this.settings.maxSelectDistance && Math.abs(c.screenX) <= 1 && Math.abs(c.screenY) <= 1;
  }

  private pickBest(candidates: readonly LockCandidate[]): number | null {
    let best: number | null = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      if (!this.selectable(c)) continue;
      const score = Math.hypot(c.screenX, c.screenY) + (c.distance / this.settings.maxSelectDistance) * this.settings.distanceWeight;
      if (score < bestScore) {
        bestScore = score;
        best = c.id;
      }
    }
    return best;
  }

  /** 현재 대상 기준 화면 dir(+1 오른쪽, -1 왼쪽) 쪽에서 가장 가까운 대상 */
  private pickSide(candidates: readonly LockCandidate[], cur: LockCandidate, dir: 1 | -1): number | null {
    let best: number | null = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      if (c.id === cur.id || !this.selectable(c)) continue;
      const dx = (c.screenX - cur.screenX) * dir;
      if (dx <= 0) continue;
      const score = dx + Math.abs(c.screenY - cur.screenY) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = c.id;
      }
    }
    return best;
  }
}
