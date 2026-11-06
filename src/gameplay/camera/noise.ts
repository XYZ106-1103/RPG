/**
 * 1D 펄린(그래디언트) 노이즈 (Babylon 비의존, 의존성 없음).
 * 정수 격자점에서 0, 그 사이에서 부드럽게 변하는 [-1, 1] 값. 시드별로 다른 순열.
 */
export class Perlin1D {
  private readonly grad = new Float32Array(256);

  constructor(seed = 1) {
    // 결정적 의사난수로 격자 기울기 생성 (mulberry32)
    let s = seed >>> 0;
    for (let i = 0; i < 256; i++) {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      this.grad[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    }
  }

  /** [-1, 1] 근처 값 (1D 펄린의 이론 최대는 0.5 — 2배로 늘려 [-1,1]로 맞춘다) */
  sample(x: number): number {
    const i0 = Math.floor(x);
    const f = x - i0;
    const g0 = this.grad[i0 & 255] ?? 0;
    const g1 = this.grad[(i0 + 1) & 255] ?? 0;
    const u = f * f * f * (f * (f * 6 - 15) + 10); // quintic fade
    const n0 = g0 * f;
    const n1 = g1 * (f - 1);
    return Math.max(-1, Math.min(1, (n0 + (n1 - n0) * u) * 2));
  }
}
