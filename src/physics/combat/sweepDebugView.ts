/**
 * 무기 스윕 궤적 디버그 표시: 스윕마다 손잡이/칼끝 경로와 서브스텝별 칼날을 선으로 그려 0.5초 동안 서서히 지운다.
 * 맞은 지점은 노란 십자, 벽에 막힌 지점은 주황 십자.
 *
 * 고정 용량 선 메시 하나를 만들어 매 프레임 같은 메시를 갱신한다 (새 메시/배열을 만들지 않음).
 * 꺼져 있을 때는 HitQuery 구독을 끊어 기록 자체를 만들지 않는다.
 */
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { Vec3 } from "../../sim/math/vec3";
import type { HavokHitQuery, SweepRecord } from "./havokHitQuery";

export const SWEEP_TRAIL_SECONDS = 0.5;
const CAPACITY = 768;

const COLORS = {
  player: new Color3(0.3, 0.95, 1.0),
  enemy: new Color3(1.0, 0.35, 0.25),
  neutral: new Color3(0.9, 0.9, 0.9),
  hit: new Color3(1.0, 0.95, 0.2),
  block: new Color3(1.0, 0.55, 0.1),
} as const;

interface TrailLine {
  a: Vector3;
  b: Vector3;
  color: Color3;
  born: number;
  alive: boolean;
}

export class SweepDebugView {
  private readonly lines: TrailLine[] = [];
  private readonly linePoints: Vector3[][] = [];
  private readonly lineColors: Color4[][] = [];
  private next = 0;
  private live = 0;
  private mesh: LinesMesh | null = null;
  private observer: Observer<SweepRecord> | null = null;
  private dirty = false;

  constructor(
    private readonly scene: Scene,
    private readonly query: HavokHitQuery,
    private readonly now: () => number = () => performance.now(),
  ) {
    for (let i = 0; i < CAPACITY; i++) {
      this.lines.push({ a: new Vector3(), b: new Vector3(), color: COLORS.neutral, born: 0, alive: false });
      this.linePoints.push([new Vector3(), new Vector3()]);
      this.lineColors.push([new Color4(0, 0, 0, 0), new Color4(0, 0, 0, 0)]);
    }
  }

  get enabled(): boolean {
    return this.observer !== null;
  }

  /** 지금 표시 중인 선 수 (마지막 update 기준) */
  get liveLineCount(): number {
    return this.live;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    if (on) {
      this.observer = this.query.onSweep.add((r) => this.record(r));
    } else {
      this.query.onSweep.remove(this.observer);
      this.observer = null;
      for (const l of this.lines) l.alive = false;
      this.live = 0;
      this.mesh?.dispose();
      this.mesh = null;
    }
  }

  /** 렌더 프레임마다: 나이에 따라 투명도를 줄이고 선 메시를 갱신한다 */
  update(): void {
    if (!this.enabled || (this.live === 0 && !this.dirty)) return;
    const t = this.now();
    const life = SWEEP_TRAIL_SECONDS * 1000;
    let live = 0;
    for (let i = 0; i < CAPACITY; i++) {
      const l = this.lines[i];
      const pts = this.linePoints[i];
      const cols = this.lineColors[i];
      if (!l || !pts || !cols) continue;
      const age = t - l.born;
      if (l.alive && age > life) l.alive = false;
      const p0 = pts[0];
      const p1 = pts[1];
      const c0 = cols[0];
      const c1 = cols[1];
      if (!p0 || !p1 || !c0 || !c1) continue;
      if (l.alive) {
        live++;
        p0.copyFrom(l.a);
        p1.copyFrom(l.b);
        const alpha = 1 - age / life;
        c0.set(l.color.r, l.color.g, l.color.b, alpha);
        c1.set(l.color.r, l.color.g, l.color.b, alpha);
      } else {
        p0.setAll(0);
        p1.setAll(0);
        c0.a = 0;
        c1.a = 0;
      }
    }
    this.live = live;
    this.dirty = false;
    if (!this.mesh) {
      this.mesh = CreateLineSystem("sweepTrail", { lines: this.linePoints, colors: this.lineColors, updatable: true, useVertexAlpha: true }, this.scene);
      this.mesh.isPickable = false;
      this.mesh.alwaysSelectAsActiveMesh = true; // 선이 화면 밖 경계 상자로 컬링되지 않게
    } else {
      CreateLineSystem("sweepTrail", { lines: this.linePoints, colors: this.lineColors, instance: this.mesh });
    }
  }

  dispose(): void {
    this.setEnabled(false);
  }

  private record(r: SweepRecord): void {
    const born = this.now();
    const color = COLORS[r.team];
    for (let i = 0; i < r.poses.length; i++) {
      const p = r.poses[i];
      if (!p) continue;
      this.push(p.hilt, p.tip, color, born); // 서브스텝별 칼날
      const q = r.poses[i + 1];
      if (q) {
        this.push(p.hilt, q.hilt, color, born); // 손잡이 경로
        this.push(p.tip, q.tip, color, born); // 칼끝 경로
      }
    }
    for (const h of r.hits) this.cross(h, 0.12, COLORS.hit, born);
    if (r.block) this.cross(r.block, 0.25, COLORS.block, born);
    this.dirty = true;
  }

  private cross(c: Vec3, s: number, color: Color3, born: number): void {
    this.push({ x: c.x - s, y: c.y, z: c.z }, { x: c.x + s, y: c.y, z: c.z }, color, born);
    this.push({ x: c.x, y: c.y - s, z: c.z }, { x: c.x, y: c.y + s, z: c.z }, color, born);
    this.push({ x: c.x, y: c.y, z: c.z - s }, { x: c.x, y: c.y, z: c.z + s }, color, born);
  }

  /** 고리 버퍼에 선 하나 추가 (가득 차면 가장 오래된 것을 덮어씀) */
  private push(a: Vec3, b: Vec3, color: Color3, born: number): void {
    const l = this.lines[this.next];
    if (!l) return;
    l.a.set(a.x, a.y, a.z);
    l.b.set(b.x, b.y, b.z);
    l.color = color;
    l.born = born;
    if (!l.alive) this.live++;
    l.alive = true;
    this.next = (this.next + 1) % CAPACITY;
  }
}
