/**
 * 스파크 렌더: 작은 발광 막대를 thin instance로 그린다 (메시 1개, 고정 크기 풀, 매 프레임 할당 없음).
 * 속도 방향으로 늘이고, 나이에 따라 줄어든다. 조명 영향 없이 발광색으로만 보인다 (어두운 세계에서도 잘 보이게).
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import type { Scene } from "@babylonjs/core/scene";
import { SparkSim, type SparkParams } from "./sparkSim";

const FORWARD = new Vector3(0, 0, 1);

export class SparkRenderer {
  readonly sim: SparkSim;
  readonly mesh: Mesh;
  private readonly matrices: Float32Array;
  private readonly m = new Matrix();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly t = new Vector3();
  private readonly v = new Vector3();
  private wasAlive = true;

  constructor(scene: Scene, name: string, color: Color3, capacity = 256) {
    this.sim = new SparkSim(capacity);
    this.mesh = CreateBox(name, { size: 1 }, scene);
    const mat = new StandardMaterial(`${name}Mat`, scene);
    mat.disableLighting = true;
    mat.emissiveColor = color;
    mat.freeze();
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true; // 인스턴스가 원래 박스 범위 밖에 있어도 컬링되지 않게
    this.matrices = new Float32Array(capacity * 16); // 0행렬 = 보이지 않음
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
  }

  burst(px: number, py: number, pz: number, dx: number, dy: number, dz: number, params: SparkParams): void {
    if (params.count <= 0) return;
    this.sim.burst(px, py, pz, dx, dy, dz, params);
  }

  update(dt: number, gravity: number, size: number): void {
    const sim = this.sim;
    sim.update(dt, gravity);
    if (sim.alive === 0 && !this.wasAlive) return; // 이미 비운 상태
    const d = sim.data;
    for (let i = 0; i < sim.capacity; i++) {
      const o = i * 8;
      const life = d[o + 7] ?? 0;
      const out = i * 16;
      if (life <= 0) {
        this.matrices.fill(0, out, out + 16);
        continue;
      }
      const k = 1 - (d[o + 6] ?? 0) / life; // 남은 수명 비율
      this.v.set(d[o + 3] ?? 0, d[o + 4] ?? 0, d[o + 5] ?? 0);
      const speed = this.v.length();
      if (speed > 1e-4) Quaternion.FromUnitVectorsToRef(FORWARD, this.v.scaleInPlace(1 / speed), this.q);
      else this.q.set(0, 0, 0, 1);
      this.s.set(size * k, size * k, size * (1 + speed * 0.6) * k);
      this.t.set(d[o] ?? 0, d[o + 1] ?? 0, d[o + 2] ?? 0);
      Matrix.ComposeToRef(this.s, this.q, this.t, this.m);
      this.m.copyToArray(this.matrices, out);
    }
    this.mesh.thinInstanceBufferUpdated("matrix");
    this.wasAlive = sim.alive > 0;
  }

  dispose(): void {
    this.mesh.material?.dispose();
    this.mesh.dispose();
  }
}
