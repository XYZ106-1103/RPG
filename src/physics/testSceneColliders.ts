/**
 * 테스트 씬용 충돌체 배치 (F3 물리 디버그 확인용).
 * TODO(에셋/월드): 재의 평원 지형(하이트필드)과 실제 소품/적이 생기면 이 파일을 대체한다.
 */
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox, PhysicsShapeCapsule } from "@babylonjs/core/Physics/v2/physicsShape";
import type { Scene } from "@babylonjs/core/scene";
import type { PhysicsWorld } from "./physicsWorld";

export interface TestSceneColliders {
  /** 플레이어 캡슐 충돌체 노드 — 고정 스텝에서 sim 위치로 옮긴다 (발밑 중앙 원점) */
  playerCollider: TransformNode;
  playerBody: PhysicsBody;
  triggerBody: PhysicsBody;
}

const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.35;

function pbr(name: string, color: Color3, scene: Scene): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = color;
  m.metallic = 0;
  m.roughness = 0.85;
  m.freeze();
  return m;
}

/** 발밑 중앙이 원점인 캡슐 셰이프 */
function footCapsule(height: number, radius: number, scene: Scene): PhysicsShapeCapsule {
  return new PhysicsShapeCapsule(new Vector3(0, radius, 0), new Vector3(0, height - radius, 0), radius, scene);
}

export function createTestSceneColliders(world: PhysicsWorld, scene: Scene): TestSceneColliders {
  // 바닥 (렌더용 평면은 testScene.ts) — 윗면이 y=0인 두꺼운 박스
  const ground = new TransformNode("groundCollider", scene);
  ground.position.y = -0.5;
  world.createBody(ground, { layer: "ENVIRONMENT", shape: new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(40, 1, 40), scene) });

  // 플레이어
  const playerCollider = new TransformNode("playerCollider", scene);
  const playerBody = world.createBody(playerCollider, { layer: "PLAYER", shape: footCapsule(PLAYER_HEIGHT, PLAYER_RADIUS, scene), motion: "animated" });

  // 허수아비 적 — TODO(에셋): 재의 망자 모델로 교체
  const enemyHeight = 1.75;
  const enemy = CreateCapsule("enemyDummy", { height: enemyHeight, radius: 0.38, tessellation: 16 }, scene);
  enemy.bakeTransformIntoVertices(Matrix.Translation(0, enemyHeight / 2, 0));
  enemy.position.set(3, 0, 4);
  enemy.material = pbr("enemyMat", new Color3(0.35, 0.12, 0.1), scene);
  enemy.freezeWorldMatrix();
  world.createBody(enemy, { layer: "ENEMY", shape: footCapsule(enemyHeight, 0.38, scene) });

  // 환경 소품 상자 — TODO(에셋): 폐허 소품으로 교체
  const crate = CreateBox("crate", { size: 1 }, scene);
  crate.position.set(-2, 0.5, 6);
  crate.material = pbr("crateMat", new Color3(0.3, 0.26, 0.2), scene);
  crate.freezeWorldMatrix();
  world.createBody(crate, { layer: "ENVIRONMENT", shape: new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(1, 1, 1), scene) });

  // 트리거 영역 (보이지 않음 — F3으로 확인) + 위치 표시용 바닥 판
  const trigger = new TransformNode("testTrigger", scene);
  trigger.position.set(-4, 1, 3);
  const triggerBody = world.createTrigger(trigger, new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(3, 2, 3), scene));
  const marker = CreateBox("triggerMarker", { width: 3, height: 0.02, depth: 3 }, scene);
  marker.position.set(-4, 0.011, 3);
  marker.material = pbr("triggerMarkerMat", new Color3(0.45, 0.38, 0.12), scene);
  marker.freezeWorldMatrix();

  return { playerCollider, playerBody, triggerBody };
}
