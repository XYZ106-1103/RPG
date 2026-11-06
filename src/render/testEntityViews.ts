/**
 * 테스트 씬용 엔티티 표시: sim 엔티티마다 캡슐 + 칼(박스)을 그리고, 직전/현재 틱 위치를 alpha로 보간한다.
 * TODO(에셋): 캐릭터 GLB + 애니메이션이 들어오면 anim/의 캐릭터 뷰로 교체한다.
 */
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { sampleIdleWeapon, samplePlaceholderWeapon, type WeaponPose } from "../anim/placeholderWeapon";
import { ARCHETYPES } from "../sim/data/archetypes";
import type { AttackInstance } from "../sim/combat/types";
import { isDead, type Entity, type EntityId } from "../sim/entity";
import { vec3 } from "../sim/math/vec3";
import { cloneEntity, type SimWorld } from "../sim/world";

interface Snapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface View {
  body: Mesh;
  sword: Mesh;
  prev: Snapshot;
  /** 보간된 위치/방향을 담아 무기 자세 계산에 넘기는 엔티티 사본 */
  proxy: Entity;
}

const UP = new Vector3(0, 1, 0);
const SWORD_LENGTH = 1.2;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function activeAttackOf(world: SimWorld, id: EntityId): AttackInstance | null {
  for (const a of world.combat.active) if (a.attackerId === id) return a;
  return null;
}

export class TestEntityViews {
  private readonly views = new Map<EntityId, View>();
  private readonly pose: WeaponPose = { hilt: vec3(), tip: vec3() };
  private readonly dir = new Vector3();
  private readonly materials: Record<"player" | "enemy" | "sword", PBRMaterial>;

  constructor(
    private readonly scene: Scene,
    /** 이미 만들어 둔 메시를 쓸 엔티티 (플레이어 캡슐 — 등불이 붙어 있음) */
    private readonly existingBodies: ReadonlyMap<EntityId, Mesh> = new Map(),
  ) {
    const pbr = (name: string, c: Color3, metallic = 0, roughness = 0.6) => {
      const m = new PBRMaterial(name, scene);
      m.albedoColor = c;
      m.metallic = metallic;
      m.roughness = roughness;
      m.freeze();
      return m;
    };
    this.materials = {
      player: pbr("viewPlayer", new Color3(0.55, 0.5, 0.45)),
      enemy: pbr("viewEnemy", new Color3(0.35, 0.12, 0.1)),
      sword: pbr("viewSword", new Color3(0.7, 0.7, 0.72), 0.9, 0.35),
    };
  }

  /** 고정 스텝 직전에 호출: 지금 위치를 "직전 틱" 위치로 기억한다 */
  capturePrevious(world: SimWorld): void {
    for (const e of world.entities) {
      const v = this.viewFor(e);
      v.prev.x = e.position.x;
      v.prev.y = e.position.y;
      v.prev.z = e.position.z;
      v.prev.yaw = e.yaw;
    }
  }

  /** 렌더 프레임마다: alpha로 보간해 메시를 옮기고 칼 자세를 맞춘다 */
  sync(world: SimWorld, alpha: number): void {
    for (const e of world.entities) {
      const v = this.viewFor(e);
      const p = v.proxy;
      p.position.x = v.prev.x + (e.position.x - v.prev.x) * alpha;
      p.position.y = v.prev.y + (e.position.y - v.prev.y) * alpha;
      p.position.z = v.prev.z + (e.position.z - v.prev.z) * alpha;
      p.yaw = lerpAngle(v.prev.yaw, e.yaw, alpha);

      v.body.position.set(p.position.x, p.position.y, p.position.z);
      v.body.rotation.y = p.yaw;
      // 사망: 옆으로 눕힌다 (임시 표현)
      v.body.rotation.z = isDead(e) ? Math.PI / 2 : 0;
      if (isDead(e)) v.body.position.y += ARCHETYPES[e.archetype].radius;

      const attack = activeAttackOf(world, e.id);
      if (isDead(e)) {
        v.sword.setEnabled(false);
        continue;
      }
      v.sword.setEnabled(true);
      if (attack) samplePlaceholderWeapon(p, attack, world.tick - 1 + alpha, this.pose);
      else sampleIdleWeapon(p, this.pose);
      this.placeSword(v.sword);
    }
    // 사라진 엔티티 정리
    for (const [id, v] of this.views) {
      if (!world.get(id)) {
        if (!this.existingBodies.has(id)) v.body.dispose();
        v.sword.dispose();
        this.views.delete(id);
      }
    }
  }

  /** 보간된 위치 (카메라 추적용) */
  interpolatedPosition(id: EntityId): Readonly<{ x: number; y: number; z: number }> | null {
    return this.views.get(id)?.proxy.position ?? null;
  }

  private placeSword(sword: Mesh): void {
    const { hilt, tip } = this.pose;
    this.dir.set(tip.x - hilt.x, tip.y - hilt.y, tip.z - hilt.z);
    const len = this.dir.length();
    this.dir.scaleInPlace(1 / Math.max(1e-6, len));
    sword.position.set((hilt.x + tip.x) / 2, (hilt.y + tip.y) / 2, (hilt.z + tip.z) / 2);
    sword.rotationQuaternion ??= new Quaternion();
    Quaternion.FromUnitVectorsToRef(UP, this.dir, sword.rotationQuaternion);
    sword.scaling.y = len / SWORD_LENGTH;
  }

  private viewFor(e: Entity): View {
    let v = this.views.get(e.id);
    if (v) return v;
    const a = ARCHETYPES[e.archetype];
    let body = this.existingBodies.get(e.id);
    if (!body) {
      body = CreateCapsule(`entity${e.id}`, { height: a.height, radius: a.radius, tessellation: 16 }, this.scene);
      body.bakeTransformIntoVertices(Matrix.Translation(0, a.height / 2, 0));
      body.material = e.team === "player" ? this.materials.player : this.materials.enemy;
    }
    // TODO(에셋): 무기 모델로 교체
    const sword = CreateBox(`sword${e.id}`, { width: 0.05, height: SWORD_LENGTH, depth: 0.02 }, this.scene);
    sword.material = this.materials.sword;
    v = { body, sword, prev: { x: e.position.x, y: e.position.y, z: e.position.z, yaw: e.yaw }, proxy: cloneEntity(e) };
    this.views.set(e.id, v);
    return v;
  }
}
