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
import { createRamp, createStairs, createStaticBox } from "./testGeometry";

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

  // 트리거 영역 (보이지 않음 — F3으로 확인) + 위치 표시용 바닥 판 (오른쪽 뒤)
  const trigger = new TransformNode("testTrigger", scene);
  trigger.position.set(8, 1, -6);
  const triggerBody = world.createTrigger(trigger, new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), new Vector3(3, 2, 3), scene));
  const marker = CreateBox("triggerMarker", { width: 3, height: 0.02, depth: 3 }, scene);
  marker.position.set(8, 0.011, -6);
  marker.material = pbr("triggerMarkerMat", new Color3(0.45, 0.38, 0.12), scene);
  marker.freezeWorldMatrix();

  createTraversalCourse(world, scene);

  return { playerCollider, playerBody, triggerBody };
}

const STONE = new Color3(0.32, 0.3, 0.28);
const STONE_DARK = new Color3(0.22, 0.2, 0.19);
const STONE_WARM = new Color3(0.36, 0.3, 0.24);

/**
 * 캐릭터 컨트롤러 확인용 지형 (모두 ENVIRONMENT 정적 박스). 플레이어는 원점에서 +Z를 보고 시작한다.
 *  - 오른쪽 앞: 0.2m × 5단 계단 + 층계참
 *  - 왼쪽 앞: 30° 경사로(오를 수 있음) + 꼭대기 단, 더 왼쪽에 55° 경사로(못 오르고 미끄러짐)
 *  - 정면 멀리: 벽
 *  - 뒤쪽: 낮은 턱 0.25m(넘어감, 오른쪽) / 0.5m(막힘, 왼쪽)
 */
function createTraversalCourse(world: PhysicsWorld, scene: Scene): void {
  createStairs(world, scene, { start: new Vector3(6, 0, 2), steps: 5, stepHeight: 0.2, stepDepth: 0.45, width: 2.5, visual: { color: STONE } });
  createStaticBox(world, scene, { center: new Vector3(6, 0.5, 2 + 2.25 + 1.5), size: new Vector3(2.5, 1, 3), visual: { color: STONE }, name: "landing" });

  createRamp(world, scene, { start: new Vector3(-6, 0, 2), yaw: 0, angleDeg: 30, length: 6, width: 3, visual: { color: STONE_WARM } });
  const rampTopZ = 2 + 6 * Math.cos(Math.PI / 6);
  createStaticBox(world, scene, { center: new Vector3(-6, 1.5, rampTopZ + 1.5), size: new Vector3(3, 3, 3), visual: { color: STONE_WARM }, name: "rampTop" });
  createRamp(world, scene, { start: new Vector3(-11, 0, 2), yaw: 0, angleDeg: 55, length: 4, width: 3, visual: { color: STONE_DARK } });

  createStaticBox(world, scene, { center: new Vector3(0, 1.5, 12), size: new Vector3(8, 3, 0.5), visual: { color: STONE_DARK }, name: "wall" });

  createStaticBox(world, scene, { center: new Vector3(3, 0.125, -5), size: new Vector3(3, 0.25, 3), visual: { color: STONE }, name: "curb25" });
  createStaticBox(world, scene, { center: new Vector3(-3, 0.25, -5), size: new Vector3(3, 0.5, 3), visual: { color: STONE }, name: "ledge50" });
}
