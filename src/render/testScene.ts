/**
 * 엔진 부트스트랩 확인용 테스트 씬: 바닥 평면, 캡슐 하나, 어두운 하늘, 포인트 라이트 하나.
 * TODO(에셋): 플레이어 GLB가 준비되면 캡슐을 캐릭터 모델로 교체한다.
 */
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Scene } from "@babylonjs/core/scene";

/** 태양이 꺼진 세계의 하늘색 (거의 검정에 가까운 남색) */
const SKY_COLOR = new Color4(0.012, 0.014, 0.022, 1);

const CAPSULE_HEIGHT = 1.8;
const CAPSULE_RADIUS = 0.35;

export function createTestScene(engine: AbstractEngine, canvas: HTMLCanvasElement): Scene {
  const scene = new Scene(engine);
  scene.clearColor = SKY_COLOR;
  // 환경맵(IBL)이 없으므로 앰비언트는 0 — 포인트 라이트(등불)만 광원
  scene.ambientColor = Color3.Black();

  const camera = new ArcRotateCamera("camera", -Math.PI / 2.4, Math.PI / 2.6, 7, new Vector3(0, 1, 0), scene);
  camera.lowerRadiusLimit = 2;
  camera.upperRadiusLimit = 30;
  camera.upperBetaLimit = Math.PI / 2.05;
  camera.minZ = 0.05;
  camera.wheelDeltaPercentage = 0.02;
  camera.attachControl(canvas, true);

  // 바닥 평면 (TODO(에셋): 재의 평원 지형/텍스처로 교체)
  const ground = CreateGround("ground", { width: 40, height: 40 }, scene);
  const groundMat = new PBRMaterial("groundMat", scene);
  groundMat.albedoColor = new Color3(0.22, 0.21, 0.2);
  groundMat.metallic = 0;
  groundMat.roughness = 0.95;
  ground.material = groundMat;
  groundMat.freeze();
  ground.freezeWorldMatrix();

  // 캡슐 (발밑 중앙이 원점이 되도록 반 높이만큼 올린다)
  const capsule = CreateCapsule("capsule", { height: CAPSULE_HEIGHT, radius: CAPSULE_RADIUS, tessellation: 24, subdivisions: 4 }, scene);
  capsule.position.y = CAPSULE_HEIGHT / 2;
  const capsuleMat = new PBRMaterial("capsuleMat", scene);
  capsuleMat.albedoColor = new Color3(0.55, 0.5, 0.45);
  capsuleMat.metallic = 0;
  capsuleMat.roughness = 0.6;
  capsule.material = capsuleMat;
  capsuleMat.freeze();
  capsule.freezeWorldMatrix();

  // 포인트 라이트 하나 — 플레이어 허리의 등불 위치를 흉내낸다 (따뜻한 불빛)
  const lantern = new PointLight("lantern", new Vector3(0.45, 1.05, -0.35), scene);
  lantern.diffuse = new Color3(1.0, 0.62, 0.3);
  lantern.specular = new Color3(1.0, 0.7, 0.4);
  lantern.intensity = 6;
  lantern.range = 18;

  return scene;
}
