/**
 * 스파크 파티클 시뮬레이션 (Babylon 비의존, 고정 크기 풀). 렌더는 sparks.ts가 thin instance로 그린다.
 */
export interface SparkParams {
  count: number;
  speed: number;
  /** 0=dir 한 방향, 1=반구 전체 */
  spread: number;
  life: number;
}

export class SparkSim {
  /** 위치 xyz, 속도 xyz, 나이, 수명 — 스파크당 8개 */
  readonly data: Float32Array;
  private next = 0;
  private aliveCount = 0;
  private rngState: number;

  constructor(
    readonly capacity: number,
    seed = 12345,
  ) {
    this.data = new Float32Array(capacity * 8);
    for (let i = 0; i < capacity; i++) this.data[i * 8 + 7] = 0; // 수명 0 = 비활성
    this.rngState = seed >>> 0;
  }

  get alive(): number {
    return this.aliveCount;
  }

  /** point에서 dir(정규화 불필요) 쪽으로 터뜨린다. 가득 차면 오래된 것부터 덮어쓴다 */
  burst(px: number, py: number, pz: number, dx: number, dy: number, dz: number, p: SparkParams): void {
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    for (let n = 0; n < p.count; n++) {
      const i = this.next * 8;
      this.next = (this.next + 1) % this.capacity;
      // 방향: dir + 무작위 단위 벡터 × spread
      let rx = this.rand() * 2 - 1;
      let ry = this.rand() * 2 - 1;
      let rz = this.rand() * 2 - 1;
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl;
      ry /= rl;
      rz /= rl;
      let vx = dx + rx * p.spread * 1.5;
      let vy = dy + ry * p.spread * 1.5 + 0.3;
      let vz = dz + rz * p.spread * 1.5;
      const vl = Math.hypot(vx, vy, vz) || 1;
      const sp = p.speed * (0.5 + this.rand() * 0.8);
      vx = (vx / vl) * sp;
      vy = (vy / vl) * sp;
      vz = (vz / vl) * sp;
      const d = this.data;
      if ((d[i + 7] ?? 0) <= 0) this.aliveCount++;
      d[i] = px;
      d[i + 1] = py;
      d[i + 2] = pz;
      d[i + 3] = vx;
      d[i + 4] = vy;
      d[i + 5] = vz;
      d[i + 6] = 0;
      d[i + 7] = p.life * (0.6 + this.rand() * 0.6);
    }
  }

  update(dt: number, gravity: number): void {
    const d = this.data;
    let alive = 0;
    for (let i = 0; i < this.capacity * 8; i += 8) {
      const life = d[i + 7] ?? 0;
      if (life <= 0) continue;
      const age = (d[i + 6] ?? 0) + dt;
      if (age >= life) {
        d[i + 7] = 0;
        continue;
      }
      alive++;
      d[i + 6] = age;
      d[i + 4] = (d[i + 4] ?? 0) - gravity * dt;
      d[i] = (d[i] ?? 0) + (d[i + 3] ?? 0) * dt;
      d[i + 1] = (d[i + 1] ?? 0) + (d[i + 4] ?? 0) * dt;
      d[i + 2] = (d[i + 2] ?? 0) + (d[i + 5] ?? 0) * dt;
    }
    this.aliveCount = alive;
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.data[i * 8 + 7] = 0;
    this.aliveCount = 0;
  }

  private rand(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
