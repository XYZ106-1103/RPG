/**
 * 기본 조명: 태양이 꺼진 세계 (CLAUDE.md "렌더링 사양").
 *  - IBL: 밤하늘 HDR 환경맵(.env)을 아주 낮은 강도로 — 어둠 속 형태만 겨우 드러나게
 *  - 하늘: 같은 환경맵을 아주 어둡게 깐 배경 — 등불이 없어도 캐릭터 실루엣이 하늘에 비쳐 보인다
 *  - 태양: 꺼진 태양의 잔광 — 약하고 차가운 방향광 (그림자는 shadows.ts의 CSM)
 *    그림자가 보이려면 그림자가 생기지 않는 환경광(IBL)보다 직접광 비중이 커야 해서 태양 : IBL을 대략 3 : 1 이상으로 둔다
 *  - 등불: 플레이어 허리 본에 붙은 따뜻한 포인트 라이트, 미세한 깜빡임
 *  - 노출: ACES 톤매핑, 등불 기준(등불에서 2~3m 거리가 적정 밝기)으로 맞춤
 * 수치는 LightingSettings 한 곳에 있고 ?tune GUI가 직접 바꾼다 (매 프레임 update에서 반영).
 */
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Helpers/sceneHelpers";
import { lanternFlicker } from "./lanternFlicker";

export interface LightingSettings {
  /** IBL 강도 — 원본 HDRI가 장노출 밤 사진이라 아주 낮게 */
  iblIntensity: number;
  /** 하늘 배경 밝기 */
  skyLevel: number;
  /** 하늘 흐림 (0 선명 ~ 1 뭉갬) */
  skyBlur: number;
  sunIntensity: number;
  sunColor: { r: number; g: number; b: number };
  /** 태양 고도/방위 (도) — 낮게 비스듬히 */
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  lanternIntensity: number;
  /** 등불 빛이 닿는 범위 (m) */
  lanternRange: number;
  lanternColor: { r: number; g: number; b: number };
  /** 깜빡임 세기 (0 ~ 0.2, 강도 배율 ±) */
  lanternFlicker: number;
  exposure: number;
  contrast: number;
}

/** 기본값을 크게 바꾸면 올린다 — ?tune에 저장해 둔 예전 조명값을 버리고 새 기본값으로 시작 */
export const LIGHTING_REVISION = 2;

export const DEFAULT_LIGHTING: LightingSettings = {
  iblIntensity: 0.03,
  skyLevel: 0.05,
  skyBlur: 0.3,
  sunIntensity: 0.5,
  sunColor: { r: 0.55, g: 0.63, b: 0.82 },
  sunElevationDeg: 28,
  sunAzimuthDeg: 215,
  lanternIntensity: 6,
  lanternRange: 14,
  lanternColor: { r: 1.0, g: 0.62, b: 0.3 },
  lanternFlicker: 0.05,
  exposure: 1.25,
  contrast: 1.15,
};

/** 등불을 붙일 본이 없을 때 허리 근처 위치 (부모 기준, m) */
const LANTERN_FALLBACK_OFFSET = new Vector3(0.45, 1.05, -0.35);

export class Lighting {
  readonly settings: LightingSettings;
  readonly sun: DirectionalLight;
  readonly lantern: PointLight;
  env: CubeTexture | null = null;
  sky: Mesh | null = null;
  private time = 0;
  private readonly sunDir = new Vector3();

  constructor(
    private readonly scene: Scene,
    settings: Partial<LightingSettings> = {},
  ) {
    this.settings = { ...structuredClone(DEFAULT_LIGHTING), ...settings };
    scene.ambientColor = Color3.Black();

    this.sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
    this.sun.position = new Vector3(0, 40, 0);
    this.sun.specular = new Color3(0.2, 0.22, 0.28);

    this.lantern = new PointLight("lantern", LANTERN_FALLBACK_OFFSET.clone(), scene);

    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.update(0, true);
  }

  /** 밤하늘 환경맵 로드 → IBL + 어두운 하늘 배경. 실패하면 경고만 (어둠 속에서 진행) */
  async loadEnvironment(url: string): Promise<void> {
    try {
      const env = await new Promise<CubeTexture>((resolve, reject) => {
        const t = CubeTexture.CreateFromPrefilteredData(url, this.scene);
        t.onLoadObservable.addOnce(() => resolve(t));
        setTimeout(() => (t.isReady() ? resolve(t) : reject(new Error("환경맵 로드 시간 초과"))), 20000);
      });
      this.env = env;
      this.scene.environmentTexture = env;
      this.sky = this.scene.createDefaultSkybox(env, true, 800, this.settings.skyBlur, false);
      if (this.sky) {
        this.sky.name = "sky";
        this.sky.isPickable = false;
        this.sky.infiniteDistance = true;
        // 하늘 PBR 재질의 기본 반사율은 흰색(완전 거울) — SSR이 하늘을 거울로 보고 화면 전체에 뿌연 반사를 더한다.
        // 하늘은 조명을 받지 않으므로 반사율을 0으로 해도 모습은 같다
        if (this.sky.material instanceof PBRMaterial) this.sky.material.reflectivityColor = Color3.Black();
      }
      this.update(0, true);
    } catch (err) {
      console.warn(`[render] 환경맵 로드 실패 (${url}) — IBL 없이 진행`, err);
    }
  }

  /** 등불을 허리 본에 붙인다 (없으면 fallback 노드의 허리 위치에) */
  attachLantern(bone: TransformNode | null, fallback: TransformNode): void {
    if (bone) {
      this.lantern.parent = bone;
      this.lantern.position.setAll(0);
    } else {
      this.lantern.parent = fallback;
      this.lantern.position.copyFrom(LANTERN_FALLBACK_OFFSET);
    }
  }

  /** 렌더 프레임마다: 설정값 반영 + 등불 깜빡임. lanternOn=false면 등불 끔 (intensity 0 — freeze된 재질 대응) */
  update(dt: number, lanternOn: boolean): void {
    const s = this.settings;
    this.time += dt;
    this.scene.environmentIntensity = s.iblIntensity;
    const skyMat = this.sky?.material;
    if (skyMat instanceof PBRMaterial && skyMat.reflectionTexture) skyMat.reflectionTexture.level = s.skyLevel;

    const el = (s.sunElevationDeg * Math.PI) / 180;
    const az = (s.sunAzimuthDeg * Math.PI) / 180;
    // 빛이 향하는 방향 = 태양 위치의 반대 (방위 0 = +Z 쪽 하늘)
    this.sunDir.set(-Math.cos(el) * Math.sin(az), -Math.sin(el), -Math.cos(el) * Math.cos(az));
    this.sun.direction.copyFrom(this.sunDir);
    this.sun.intensity = s.sunIntensity;
    this.sun.diffuse.set(s.sunColor.r, s.sunColor.g, s.sunColor.b);

    this.lantern.diffuse.set(s.lanternColor.r, s.lanternColor.g, s.lanternColor.b);
    this.lantern.specular.set(s.lanternColor.r, s.lanternColor.g * 1.05, s.lanternColor.b * 1.2);
    this.lantern.range = s.lanternRange;
    this.lantern.intensity = lanternOn ? s.lanternIntensity * lanternFlicker(this.time, s.lanternFlicker) : 0;

    const ip = this.scene.imageProcessingConfiguration;
    ip.exposure = s.exposure;
    ip.contrast = s.contrast;
  }
}
