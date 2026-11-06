/**
 * 엔티티 하나의 표시: 캡슐(상태별 색) + 앞방향 표시용 작은 박스 + 무기 긴 박스.
 * 직전/현재 sim 틱 위치와 방향을 alpha로 보간한다.
 * TODO(에셋): 캐릭터 GLB + 애니메이션 + 무기 모델로 교체
 */
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { sampleIdleWeapon, samplePlaceholderWeapon, type WeaponPose } from "../../anim/placeholderWeapon";
import type { AttackInstance } from "../../sim/combat/types";
import { ARCHETYPES } from "../../sim/data/archetypes";
import { isDead, type Entity } from "../../sim/entity";
import { vec3 } from "../../sim/math/vec3";
import { cloneEntity } from "../../sim/world";
import { VIEW_COLORS, type ViewColorKey } from "./stateColors";

const UP = new Vector3(0, 1, 0);
const WEAPON_LENGTH = 1.2;

/** 씬당 하나씩 만드는 공유 재질 (freeze — 색 바꿀 때는 재질을 갈아 끼운다) */
export class ViewMaterials {
  private readonly byKey = new Map<ViewColorKey, PBRMaterial>();
  readonly weapon: PBRMaterial;
  readonly nose: PBRMaterial;

  constructor(scene: Scene) {
    for (const [key, [r, g, b]] of Object.entries(VIEW_COLORS) as [ViewColorKey, readonly [number, number, number]][]) {
      const m = new PBRMaterial(`view_${key}`, scene);
      m.albedoColor = new Color3(r, g, b);
      m.metallic = 0;
      m.roughness = 0.6;
      m.freeze();
      this.byKey.set(key, m);
    }
    this.weapon = this.make(scene, "view_weapon", new Color3(0.72, 0.72, 0.75), 0.9, 0.35);
    this.nose = this.make(scene, "view_nose", new Color3(0.9, 0.85, 0.7), 0, 0.5);
  }

  get(key: ViewColorKey): PBRMaterial {
    const m = this.byKey.get(key);
    if (!m) throw new Error(`재질 없음: ${key}`);
    return m;
  }

  private make(scene: Scene, name: string, c: Color3, metallic: number, roughness: number): PBRMaterial {
    const m = new PBRMaterial(name, scene);
    m.albedoColor = c;
    m.metallic = metallic;
    m.roughness = roughness;
    m.freeze();
    return m;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class CharacterView {
  readonly body: Mesh;
  readonly nose: Mesh;
  readonly weapon: Mesh;
  /** 표시 중인 위치/방향 (보간 결과). 카메라/락온/마커가 이 값을 쓴다 */
  readonly display: Entity;
  private readonly prev = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly pose: WeaponPose = { hilt: vec3(), tip: vec3() };
  private readonly dir = new Vector3();
  private colorKey: ViewColorKey | null = null;

  constructor(
    scene: Scene,
    private readonly materials: ViewMaterials,
    entity: Readonly<Entity>,
  ) {
    const a = ARCHETYPES[entity.archetype];
    this.body = CreateCapsule(`body${entity.id}`, { height: a.height, radius: a.radius, tessellation: 16, subdivisions: 2 }, scene);
    this.body.bakeTransformIntoVertices(Matrix.Translation(0, a.height / 2, 0)); // 원점 = 발밑 중앙
    this.nose = CreateBox(`nose${entity.id}`, { width: 0.12, height: 0.12, depth: 0.2 }, scene);
    this.nose.parent = this.body;
    this.nose.position.set(0, a.height * 0.72, a.radius + 0.06); // 가슴 앞 (로컬 +Z가 정면)
    this.nose.material = materials.nose;
    this.weapon = CreateBox(`weapon${entity.id}`, { width: 0.05, height: WEAPON_LENGTH, depth: 0.02 }, scene);
    this.weapon.material = materials.weapon;
    this.weapon.rotationQuaternion = new Quaternion();
    this.display = cloneEntity(entity);
    this.capturePrevious(entity);
  }

  /** 고정 스텝 직전: 지금 상태를 "직전 틱"으로 기억 */
  capturePrevious(e: Readonly<Entity>): void {
    this.prev.x = e.position.x;
    this.prev.y = e.position.y;
    this.prev.z = e.position.z;
    this.prev.yaw = e.yaw;
  }

  /**
   * 렌더 프레임: 보간 → 메시 반영.
   * @param weaponTick 무기 자세를 샘플링할 (소수) sim 틱
   */
  sync(e: Readonly<Entity>, alpha: number, color: ViewColorKey, attack: Readonly<AttackInstance> | null, weaponTick: number): void {
    const d = this.display;
    d.position.x = this.prev.x + (e.position.x - this.prev.x) * alpha;
    d.position.y = this.prev.y + (e.position.y - this.prev.y) * alpha;
    d.position.z = this.prev.z + (e.position.z - this.prev.z) * alpha;
    d.yaw = lerpAngle(this.prev.yaw, e.yaw, alpha);
    this.apply(e, color, attack, weaponTick);
  }

  dispose(): void {
    this.body.dispose();
    this.weapon.dispose();
  }

  /** display 값으로 메시 배치 */
  protected apply(e: Readonly<Entity>, color: ViewColorKey, attack: Readonly<AttackInstance> | null, weaponTick: number): void {
    const d = this.display;
    const dead = isDead(e);
    this.body.position.set(d.position.x, d.position.y, d.position.z);
    this.body.rotation.y = d.yaw;
    // 사망: 옆으로 눕힌다 (임시 표현)
    this.body.rotation.z = dead ? Math.PI / 2 : 0;
    if (dead) this.body.position.y += ARCHETYPES[e.archetype].radius;
    if (color !== this.colorKey) {
      this.body.material = this.materials.get(color);
      this.colorKey = color;
    }

    this.weapon.setEnabled(!dead && e.archetype !== "training_dummy");
    if (dead || e.archetype === "training_dummy") return;
    if (attack) samplePlaceholderWeapon(d, attack, weaponTick, this.pose);
    else sampleIdleWeapon(d, this.pose);
    const { hilt, tip } = this.pose;
    this.dir.set(tip.x - hilt.x, tip.y - hilt.y, tip.z - hilt.z);
    const len = this.dir.length();
    this.dir.scaleInPlace(1 / Math.max(1e-6, len));
    this.weapon.position.set((hilt.x + tip.x) / 2, (hilt.y + tip.y) / 2, (hilt.z + tip.z) / 2);
    if (this.weapon.rotationQuaternion) Quaternion.FromUnitVectorsToRef(UP, this.dir, this.weapon.rotationQuaternion);
    this.weapon.scaling.y = len / WEAPON_LENGTH;
  }
}
