/**
 * 크로스페이드 믹서 (Babylon 비의존): 상태별 가중치를 관리한다.
 * play(새 상태, 시간)이면 새 상태가 0 → 1로 오르고, 나머지 상태는 같은 비율로 줄어 합이 항상 1이 된다.
 * 다시 같은 상태로 돌아오면(아직 남아 있으면) 그 가중치에서 이어서 오른다.
 */
export class CrossfadeMixer<Id extends string> {
  private readonly weights = new Map<Id, number>();
  private target: Id | null = null;
  private fadeSeconds = 0;

  get current(): Id | null {
    return this.target;
  }

  play(id: Id, seconds: number): void {
    if (this.target === id) return;
    this.target = id;
    this.fadeSeconds = Math.max(0, seconds);
    if (!this.weights.has(id)) this.weights.set(id, 0);
    if (this.fadeSeconds === 0) this.snap();
  }

  /** dt만큼 진행 (히트스톱 중에는 0을 넘겨 가중치를 멈춘다) */
  update(dt: number): void {
    const t = this.target;
    if (t === null || dt <= 0) return;
    const w = this.weights.get(t) ?? 0;
    if (w >= 1) return;
    const next = this.fadeSeconds > 0 ? Math.min(1, w + dt / this.fadeSeconds) : 1;
    const others = 1 - w;
    const scale = others > 1e-9 ? (1 - next) / others : 0;
    for (const [id, v] of this.weights) {
      if (id === t) continue;
      const nv = v * scale;
      if (nv < 1e-4) this.weights.delete(id);
      else this.weights.set(id, nv);
    }
    this.weights.set(t, next);
    if (next >= 1) this.snap();
  }

  weight(id: Id): number {
    return this.weights.get(id) ?? 0;
  }

  /** 가중치가 0보다 큰 상태들 */
  active(): ReadonlyMap<Id, number> {
    return this.weights;
  }

  private snap(): void {
    for (const id of [...this.weights.keys()]) if (id !== this.target) this.weights.delete(id);
    if (this.target !== null) this.weights.set(this.target, 1);
  }
}
