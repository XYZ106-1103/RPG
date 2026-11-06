/**
 * 테스트 씬 환경: 바닥 평면, 어두운 하늘, 등불(포인트 라이트) 하나.
 * 캐릭터는 gameplay/player/CharacterView, 카메라는 gameplay/camera/ThirdPersonCamera가 만든다.
 * TODO(월드/에셋): 재의 평원 지형, HDR 환경맵(IBL), 꺼진 태양 조명으로 교체
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Scene } from "@babylonjs/core/scene";

/** 태양이 꺼진 세계의 하늘색 (거의 검정에 가까운 남색) */
const SKY_COLOR = new Color4(0.012, 0.014, 0.022, 1);

/** 등불 밝기. 끌 때는 setEnabled(false) 대신 intensity를 0으로 한다 — 재질이 freeze()되어 있으면
 * 라이트 활성 상태 변화가 셰이더에 반영되지 않지만, intensity는 매 프레임 유니폼으로 전달된다. */
export const LANTERN_INTENSITY = 6;

export interface TestScene {
  scene: Scene;
  /** 등불 — 플레이어 몸에 붙여 쓴다 (로컬 위치는 오른쪽 허리) */
  lantern: PointLight;
}

export function createTestScene(engine: AbstractEngine): TestScene {
  const scene = new Scene(engine);
  scene.clearColor = SKY_COLOR;
  // 환경맵(IBL)이 없으므로 앰비언트는 0 — 포인트 라이트(등불)만 광원
  scene.ambientColor = Color3.Black();

  // 바닥 평면 (TODO(에셋): 재의 평원 지형/텍스처로 교체)
  const ground = CreateGround("ground", { width: 40, height: 40 }, scene);
  const groundMat = new PBRMaterial("groundMat", scene);
  groundMat.albedoColor = new Color3(0.22, 0.21, 0.2);
  groundMat.metallic = 0;
  groundMat.roughness = 0.95;
  ground.material = groundMat;
  groundMat.freeze();
  ground.freezeWorldMatrix();

  // 등불: 플레이어 오른쪽 허리 (부모가 정해지면 로컬 위치로 쓰인다)
  const lantern = new PointLight("lantern", new Vector3(0.45, 1.05, -0.35), scene);
  lantern.diffuse = new Color3(1.0, 0.62, 0.3);
  lantern.specular = new Color3(1.0, 0.7, 0.4);
  lantern.intensity = LANTERN_INTENSITY;
  lantern.range = 18;

  return { scene, lantern };
}
