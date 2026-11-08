/**
 * 엔티티 하나의 표시: 캡슐(상태별 색) + 앞방향 표시용 작은 박스 + 무기 긴 박스.
 * 직전/현재 sim 틱 위치와 방향을 alpha로 보간한다.
 *
 * 타격감 연출 (모두 렌더 전용 — sim 상태는 건드리지 않는다):
 *  - 히트스톱: 표시를 잠시 멈췄다가 실제 상태로 따라잡는다 (무기 휘두름도 함께 멈춤)
 *  - 밀림: 맞은 방향으로 살짝 밀렸다 돌아온다
 *  - 플래시: renderOverlay로 흰색을 덮는다 (freeze된 재질을 바꾸지 않음)
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
import { HitstopTimer } from "../feel/hitstop";
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

  readonly hitstop = new HitstopTimer();
  /** 정지 시작 시점의 표시 (따라잡기 시작점) */
  private readonly held = { x: 0, y: 0, z: 0, yaw: 0, weaponTick: 0 };
  private displayWeaponTick = 0;
  private readonly push = { dx: 0, dz: 0, distance: 0, t: 0, duration: 0 };
  private flashT = 0;
  private flashDuration = 0;
  private flashAlpha = 0;
  /** 이번 렌더 프레임 시간과 히트스톱 진행(0 정지 ~ 1 정상) — 하위 클래스(모델 표시)가 애니메이션에 쓴다 */
  protected frameDt = 0;
  protected hitstopWeight = 1;

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
    this.body.overlayColor = new Color3(1, 1, 1);
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

  /** 히트스톱: 표시를 seconds 동안 멈춘 뒤 catchUpSeconds에 걸쳐 따라잡는다 */
  freeze(seconds: number, catchUpSeconds: number): void {
    this.hitstop.freeze(seconds, catchUpSeconds);
  }

  /** 피격 밀림: (dirX, dirZ) 방향으로 distance만큼 밀렸다가 seconds 동안 돌아온다 */
  pushFrom(dirX: number, dirZ: number, distance: number, seconds: number): void {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6 || !(seconds > 0)) return;
    this.push.dx = dirX / len;
    this.push.dz = dirZ / len;
    this.push.distance = distance;
    this.push.t = 0;
    this.push.duration = seconds;
  }

  /** 흰색 플래시 */
  flash(seconds: number, alpha: number): void {
    this.flashT = 0;
    this.flashDuration = seconds;
    this.flashAlpha = alpha;
  }

  /**
   * 렌더 프레임: 보간 → 히트스톱/밀림/플래시 → 메시 반영.
   * @param weaponTick 무기 자세를 샘플링할 (소수) sim 틱
   * @param dt 렌더 프레임 시간 (초)
   */
  sync(e: Readonly<Entity>, alpha: number, color: ViewColorKey, attack: Readonly<AttackInstance> | null, weaponTick: number, dt = 0): void {
    const d = this.display;
    // 실제(보간된) 표시값
    const lx = this.prev.x + (e.position.x - this.prev.x) * alpha;
    const ly = this.prev.y + (e.position.y - this.prev.y) * alpha;
    const lz = this.prev.z + (e.position.z - this.prev.z) * alpha;
    const lyaw = lerpAngle(this.prev.yaw, e.yaw, alpha);

    if (this.hitstop.consumeJustFroze()) {
      this.held.x = d.position.x;
      this.held.y = d.position.y;
      this.held.z = d.position.z;
      this.held.yaw = d.yaw;
      this.held.weaponTick = this.displayWeaponTick;
    }
    const w = this.hitstop.advance(dt);
    this.frameDt = dt;
    this.hitstopWeight = w;
    let wt = weaponTick;
    if (w >= 1) {
      d.position.x = lx;
      d.position.y = ly;
      d.position.z = lz;
      d.yaw = lyaw;
    } else {
      // 정지(w=0)면 정지 시점 표시 그대로, 따라잡기 중이면 정지 시점 → 실제 보간
      const h = this.held;
      d.position.x = h.x + (lx - h.x) * w;
      d.position.y = h.y + (ly - h.y) * w;
      d.position.z = h.z + (lz - h.z) * w;
      d.yaw = lerpAngle(h.yaw, lyaw, w);
      wt = h.weaponTick + (weaponTick - h.weaponTick) * w;
    }
    this.displayWeaponTick = wt;

    // 밀림/플래시는 정지가 풀린 뒤 진행 (맞은 순간 멈췄다가 튕겨 나가는 느낌)
    if (w > 0) {
      if (this.push.t < this.push.duration) this.push.t = Math.min(this.push.duration, this.push.t + dt);
      if (this.flashT < this.flashDuration) this.flashT = Math.min(this.flashDuration, this.flashT + dt);
    }
    this.apply(e, color, attack, wt);

    // 밀림 오프셋: 0 → 최대 → 0 (사인 반주기). display에는 넣지 않아 카메라/락온은 흔들리지 않는다
    let ox = 0;
    let oz = 0;
    if (this.push.duration > 0 && this.push.t < this.push.duration) {
      const k = Math.sin((Math.PI * this.push.t) / this.push.duration) * this.push.distance;
      ox = this.push.dx * k;
      oz = this.push.dz * k;
    }
    const flashing = this.flashDuration > 0 && this.flashT < this.flashDuration;
    this.applyEffects(ox, oz, flashing, flashing ? this.flashAlpha * (1 - this.flashT / this.flashDuration) : 0);
  }

  /** 밀림 오프셋과 플래시를 메시에 반영 (모델 표시는 재정의) */
  protected applyEffects(offsetX: number, offsetZ: number, flashing: boolean, alpha: number): void {
    this.body.position.x += offsetX;
    this.body.position.z += offsetZ;
    this.body.renderOverlay = flashing;
    if (flashing) this.body.overlayAlpha = alpha;
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
