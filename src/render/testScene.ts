/**
 * 테스트 씬 환경: 바닥 평면과 밤하늘 배경색. 조명은 lighting.ts, 그림자는 shadows.ts.
 * 캐릭터는 gameplay/player/CharacterView, 카메라는 gameplay/camera/ThirdPersonCamera가 만든다.
 * TODO(월드/에셋): 재의 평원 지형으로 교체
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { prepareSceneForPostFx } from "./postfx/postFx";

/** 환경맵이 로드되기 전/실패 시 배경 (거의 검정에 가까운 남색) */
const SKY_COLOR = new Color4(0.012, 0.014, 0.022, 1);

export interface TestScene {
  scene: Scene;
  ground: Mesh;
}

export function createTestScene(engine: AbstractEngine): TestScene {
  const scene = new Scene(engine);
  // 이미지 처리(ACES·LUT)는 후처리 패스에서 — 재질이 만들어지기 전에 켜야 freeze()된 재질도 톤매핑을 두 번 하지 않는다
  prepareSceneForPostFx(scene);
  scene.clearColor = SKY_COLOR;

  // 바닥 평면 (TODO(에셋): 재의 평원 지형/텍스처로 교체)
  const ground = CreateGround("ground", { width: 40, height: 40 }, scene);
  const groundMat = new PBRMaterial("groundMat", scene);
  groundMat.albedoColor = new Color3(0.22, 0.21, 0.2);
  groundMat.metallic = 0;
  groundMat.roughness = 0.95;
  ground.material = groundMat;
  ground.freezeWorldMatrix();
  return { scene, ground };
}
