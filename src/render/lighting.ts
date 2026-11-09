/**
 * 기본 조명: 태양이 꺼진 세계 (CLAUDE.md "렌더링 사양").
 *  - IBL: 밤하늘 HDR 환경맵(.env)을 아주 낮은 강도로 — 어둠 속 형태만 겨우 드러나게
 *  - 하늘: 같은 환경맵을 아주 어둡게 깐 배경 — 등불이 없어도 캐릭터 실루엣이 하늘에 비쳐 보인다
 *  - 태양: 꺼진 태양의 잔광 — 약하고 차가운 방향광 (그림자는 shadows.ts의 CSM)
 *    그림자가 보이려면 그림자가 생기지 않는 환경광(IBL)보다 직접광 비중이 커야 해서 태양 : IBL을 대략 3 : 1 이상으로 둔다
 *  - 등불: 플레이어 허리 본에 붙은 따뜻한 포인트 라이트, 미세한 깜빡임
 *  - 노출: ACES 톤매핑, 등불 기준(등불에서 2~3m 거리가 적정 밝기)으로 맞춤. 지역 볼륨이 exposureScale(EV)로 보정
 *  - 등불 불꽃: 빛나는 작은 구(HDR 발광) — 블룸이 등불 색을 번지게 하는 원천. TODO(에셋): 등불 모델로 교체
 * 수치는 LightingSettings 한 곳에 있고 ?tune GUI가 직접 바꾼다 (매 프레임 update에서 반영).
 */
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { BackgroundMaterial } from "@babylonjs/core/Materials/Background/backgroundMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
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
  /** 등불 불꽃 발광 세기 (선형 HDR — 블룸 임계값보다 커야 번진다) */
  lanternGlow: number;
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
  lanternGlow: 8,
  exposure: 1.25,
  contrast: 1.15,
};

/** BackgroundMaterial 하늘을 예전 PBR 하늘과 같은 밝기로 (헤드리스 스크린샷 비교로 맞춤) */
const SKY_MATCH_PBR = 0.5;

/** 등불을 붙일 본이 없을 때 허리 근처 위치 (부모 기준, m) */
const LANTERN_FALLBACK_OFFSET = new Vector3(0.45, 1.05, -0.35);

export class Lighting {
  readonly settings: LightingSettings;
  readonly sun: DirectionalLight;
  readonly lantern: PointLight;
  env: CubeTexture | null = null;
  sky: Mesh | null = null;
  /** 등불 불꽃 (발광 구) */
  readonly lanternFlame: Mesh;
  /** 지역 볼륨의 노출 보정 배율 (2^EV) */
  exposureScale = 1;
  private readonly flameMat: StandardMaterial;
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
    // 등불 불꽃: 그림자/피킹 없음, 안개 영향 없음 (가까이 있는 광원)
    this.lanternFlame = CreateSphere("lanternFlame", { diameter: 0.07, segments: 8 }, scene);
    this.flameMat = new StandardMaterial("lanternFlameMat", scene);
    this.flameMat.disableLighting = true;
    this.lanternFlame.material = this.flameMat;
    this.lanternFlame.isPickable = false;
    this.lanternFlame.applyFog = false;
    this.lanternFlame.parent = this.lantern;

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
      // 하늘: 조명 계산 없는 BackgroundMaterial (환경맵만 조회, 흐림은 밉맵 단계로).
      // Babylon 기본 하늘(createDefaultSkybox)은 PBR이라 화면 절반을 덮는 하늘 픽셀마다 무거운 셰이더를 돌린다 — 내장 그래픽에 큰 부담
      const sky = CreateBox("sky", { size: 800, sideOrientation: Mesh.BACKSIDE }, this.scene);
      const skyMat = new BackgroundMaterial("skyMat", this.scene);
      const skyTex = env.clone();
      skyTex.coordinatesMode = Texture.SKYBOX_MODE;
      skyMat.reflectionTexture = skyTex;
      skyMat.reflectionBlur = this.settings.skyBlur;
      skyMat.useRGBColor = true; // 환경맵 색 그대로 (false면 휘도만 primaryColor로 물들인다)
      skyMat.primaryColor = Color3.White();
      skyMat.enableNoise = true; // 어두운 그라데이션 띠(밴딩) 완화
      sky.material = skyMat;
      sky.ignoreCameraMaxZ = true;
      this.sky = sky;
      {
        this.sky.isPickable = false;
        this.sky.infiniteDistance = true;
        // 하늘 PBR 재질의 기본 반사율은 흰색(완전 거울) — SSR이 하늘을 거울로 보고 화면 전체에 뿌연 반사를 더한다.
        // 하늘은 조명을 받지 않으므로 반사율을 0으로 해도 모습은 같다
        // (BackgroundMaterial은 반사율을 쓰지 않아 SSR이 하늘을 거울로 보는 문제도 없다)
        // 하늘에는 안개를 입히지 않는다 (무한히 먼 배경 — 안개 색 한 가지로 덮이지 않게)
        this.sky.applyFog = false;
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
    // 예전 PBR 하늘은 반사에 환경광 세기(environmentIntensity)와 PBR 반사 감쇠가 곱해졌다 — 같은 밝기가 되게 맞춘 값 (실측 비교)
    if (skyMat instanceof BackgroundMaterial && skyMat.reflectionTexture) skyMat.reflectionTexture.level = s.skyLevel * s.iblIntensity * SKY_MATCH_PBR;

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
    const flicker = lanternFlicker(this.time, s.lanternFlicker);
    this.lantern.intensity = lanternOn ? s.lanternIntensity * flicker : 0;
    this.lanternFlame.isVisible = lanternOn;
    const glow = s.lanternGlow * flicker;
    this.flameMat.emissiveColor.set(s.lanternColor.r * glow, s.lanternColor.g * glow, s.lanternColor.b * glow);

    const ip = this.scene.imageProcessingConfiguration;
    ip.exposure = s.exposure * this.exposureScale;
    ip.contrast = s.contrast;
  }
}
