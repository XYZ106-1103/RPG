/**
 * 지역 볼륨 → 화면 톤 적용 (Babylon 쪽). 보간 계산은 regions.ts(순수)의 RegionGrading.
 *  - 카메라 위치로 지역을 고르고, 매 프레임 안개(색/밀도), 노출(EV), 블룸(값은 PostFxSystem.update로), LUT(전환 중에만 업로드)를 반영
 *  - LUT 파일(public/<lutFile>, Adobe .cube)이 있으면 읽고, 없거나 깨졌으면 코드로 생성한 LUT를 그대로 쓴다
 *  - F3(물리 디버그)을 켜면 지역 박스를 와이어프레임으로 표시
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { parseCubeLut } from "./lut";
import { RegionGrading, type RegionLook, type RegionProfile, type RegionVolume } from "./regions";

export interface RegionTargets {
  /** 노출 배율을 받는 쪽 (Lighting.exposureScale) */
  setExposureScale(scale: number): void;
  /** LUT가 바뀌었을 때 (PostFxSystem.updateLut) */
  updateLut(grading: RegionGrading): void;
}

export class RegionFx {
  readonly grading: RegionGrading;
  private readonly debugMeshes: Mesh[] = [];
  private debugVisible = false;
  private readonly fogColor = new Color3();

  constructor(
    private readonly scene: Scene,
    defaultProfile: RegionProfile,
    private readonly targets: RegionTargets,
    private readonly baseUrl: string,
  ) {
    this.grading = new RegionGrading(defaultProfile);
    scene.fogMode = Scene.FOGMODE_EXP2;
    void this.loadLutFile(defaultProfile);
  }

  addProfile(p: RegionProfile): void {
    this.grading.addProfile(p);
    void this.loadLutFile(p);
  }

  addVolume(v: RegionVolume): void {
    this.grading.addVolume(v);
    const size = [v.max[0] - v.min[0], v.max[1] - v.min[1], v.max[2] - v.min[2]] as const;
    const box = CreateBox(`region_${v.id}`, { width: size[0], height: size[1], depth: size[2] }, this.scene);
    box.position.set((v.min[0] + v.max[0]) / 2, (v.min[1] + v.max[1]) / 2, (v.min[2] + v.max[2]) / 2);
    const mat = new StandardMaterial(`region_${v.id}_mat`, this.scene);
    mat.wireframe = true;
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(0.3, 0.7, 1);
    mat.freeze();
    box.material = mat;
    box.isPickable = false;
    box.applyFog = false;
    box.setEnabled(this.debugVisible);
    box.freezeWorldMatrix();
    this.debugMeshes.push(box);
  }

  setDebugVisible(on: boolean): void {
    this.debugVisible = on;
    for (const m of this.debugMeshes) m.setEnabled(on);
  }

  /** 렌더 프레임마다 (카메라 위치) — 지금 보이는 지역 톤을 돌려준다 (PostFxSystem.update에 넘김) */
  update(cameraPos: Vector3, dt: number): RegionLook {
    const g = this.grading;
    g.update(cameraPos.x, cameraPos.y, cameraPos.z, dt);
    const look = g.look;
    this.fogColor.set(look.fogColor[0], look.fogColor[1], look.fogColor[2]);
    this.scene.fogColor = this.fogColor;
    this.scene.fogDensity = look.fogDensity;
    this.targets.setExposureScale(Math.pow(2, look.exposureEV));
    if (g.lutDirty) this.targets.updateLut(g);
    return look;
  }

  /** 디버그 패널 한 줄 */
  describe(): string {
    const g = this.grading;
    const p = g.progress;
    return `${g.current.name}${p < 1 ? ` (전환 ${Math.round(p * 100)}%)` : ""}  안개 ${g.look.fogDensity.toFixed(3)}  노출 ${g.look.exposureEV >= 0 ? "+" : ""}${g.look.exposureEV.toFixed(2)}EV`;
  }

  dispose(): void {
    for (const m of this.debugMeshes) {
      m.material?.dispose();
      m.dispose();
    }
  }

  private async loadLutFile(p: RegionProfile): Promise<void> {
    if (!p.lutFile) return;
    const url = `${this.baseUrl}${p.lutFile}`;
    try {
      const res = await fetch(url);
      // 개발 서버는 없는 파일에 index.html(200)을 돌려준다 — HTML이면 없는 것으로
      if (!res.ok || (res.headers.get("content-type") ?? "").includes("text/html")) {
        console.info(`[region] ${p.name}: LUT 파일 없음 (${url}) — 코드 생성 LUT 사용`);
        return;
      }
      this.grading.setProfileLut(p.id, parseCubeLut(await res.text()));
      console.info(`[region] ${p.name}: LUT 파일 사용 (${url})`);
    } catch (err) {
      console.warn(`[region] ${p.name}: LUT 파일을 읽지 못했습니다 (${url}) — 코드 생성 LUT 사용`, err);
    }
  }
}
