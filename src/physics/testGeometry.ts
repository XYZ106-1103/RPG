/**
 * 정적 지형 박스 헬퍼 (경사로, 계단, 벽, 턱). 테스트 씬과 물리 테스트가 같은 형상을 쓴다.
 * TODO(월드): 재의 평원 하이트필드 지형과 실제 소품이 생기면 테스트 씬에서는 쓰지 않는다.
 */
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeBox } from "@babylonjs/core/Physics/v2/physicsShape";
import type { Scene } from "@babylonjs/core/scene";
import type { PhysicsWorld } from "./physicsWorld";

export interface StaticBoxOptions {
  center: Vector3;
  size: Vector3;
  rotation?: Quaternion;
  /** 렌더 메시를 만들지 (테스트에서는 false) */
  visual?: { color: Color3 } | false;
  name?: string;
}

const materialCache = new WeakMap<Scene, Map<string, PBRMaterial>>();

function materialFor(scene: Scene, color: Color3): PBRMaterial {
  let byColor = materialCache.get(scene);
  if (!byColor) {
    byColor = new Map();
    materialCache.set(scene, byColor);
  }
  const key = color.toHexString();
  let m = byColor.get(key);
  if (!m) {
    m = new PBRMaterial(`geo_${key}`, scene);
    m.albedoColor = color;
    m.metallic = 0;
    m.roughness = 0.9;
    m.freeze();
    byColor.set(key, m);
  }
  return m;
}

/** ENVIRONMENT 레이어 정적 박스 */
export function createStaticBox(world: PhysicsWorld, scene: Scene, o: StaticBoxOptions): PhysicsBody {
  const name = o.name ?? "staticBox";
  const node = o.visual ? CreateBox(name, { width: o.size.x, height: o.size.y, depth: o.size.z }, scene) : new TransformNode(name, scene);
  node.position.copyFrom(o.center);
  node.rotationQuaternion = o.rotation?.clone() ?? Quaternion.Identity();
  if (o.visual && "material" in node) {
    node.material = materialFor(scene, o.visual.color);
  }
  const body = world.createBody(node, {
    layer: "ENVIRONMENT",
    shape: new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), o.size.clone(), scene),
  });
  node.freezeWorldMatrix();
  return body;
}

export interface RampOptions {
  /** 경사로 아래쪽 끝, 윗면 중앙 (보통 바닥 높이) */
  start: Vector3;
  /** 오르는 방향 yaw (라디안, +Z=0) */
  yaw: number;
  angleDeg: number;
  length: number;
  width: number;
  thickness?: number;
  visual?: StaticBoxOptions["visual"];
}

/** 경사로: start에서 yaw 방향으로 angleDeg만큼 기울어 올라간다 */
export function createRamp(world: PhysicsWorld, scene: Scene, o: RampOptions): PhysicsBody {
  const t = o.thickness ?? 0.4;
  const a = (o.angleDeg * Math.PI) / 180;
  // 로컬 +Z(길이 방향)가 위로 a만큼 들리도록: Babylon 왼손 좌표계에서 X축 -a 회전
  const rot = Quaternion.RotationYawPitchRoll(o.yaw, -a, 0);
  const along = new Vector3(0, 0, 1).applyRotationQuaternion(rot);
  const normal = new Vector3(0, 1, 0).applyRotationQuaternion(rot);
  const center = o.start.add(along.scale(o.length / 2)).subtract(normal.scale(t / 2));
  return createStaticBox(world, scene, { center, size: new Vector3(o.width, t, o.length), rotation: rot, visual: o.visual ?? false, name: `ramp${o.angleDeg}` });
}

export interface StairsOptions {
  /** 첫 계단 앞쪽 아래 모서리 중앙 */
  start: Vector3;
  /** +Z 방향으로 올라간다 */
  steps: number;
  stepHeight: number;
  stepDepth: number;
  width: number;
  visual?: StaticBoxOptions["visual"];
}

/** 계단: 계단마다 바닥부터 쌓인 박스 (틈 없이) */
export function createStairs(world: PhysicsWorld, scene: Scene, o: StairsOptions): PhysicsBody[] {
  const bodies: PhysicsBody[] = [];
  for (let i = 0; i < o.steps; i++) {
    const h = o.stepHeight * (i + 1);
    bodies.push(
      createStaticBox(world, scene, {
        center: new Vector3(o.start.x, o.start.y + h / 2, o.start.z + o.stepDepth * (i + 0.5)),
        size: new Vector3(o.width, h, o.stepDepth),
        visual: o.visual ?? false,
        name: `stair${i}`,
      }),
    );
  }
  return bodies;
}
