/**
 * 결정적 의사난수 (mulberry32). 서버/클라이언트가 같은 시드로 같은 결과를 내도록 sim에서는 Math.random을 쓰지 않는다.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** [0, 1) 균등 분포 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** 가중치 배열에서 인덱스를 고른다. 가중치 합이 0이면 -1. */
  pickWeighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i] ?? 0);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** 직렬화용: 현재 내부 상태 (u32) */
  getState(): number {
    return this.state;
  }

  /** 역직렬화용: getState()로 얻은 값으로 복원 */
  setState(state: number): void {
    this.state = state >>> 0;
  }
}
