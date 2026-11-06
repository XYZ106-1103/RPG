/**
 * 무기 스윕 판정 — sim HitQuery의 Havok 구현.
 *
 * 매 틱, 무기 소켓 두 점(손잡이, 칼끝)의 직전 틱 → 현재 틱 위치 사이를 캡슐 셰이프캐스트로 스윕한다.
 *  - 서브스텝: 칼끝/손잡이 이동 거리 ÷ 판정 반경만큼 나눠(최대 maxSubsteps) 빠른 휘두름에서도 틈이 생기지 않게 한다.
 *    각 서브스텝은 자세 i의 캡슐을 자세 i+1 위치로 평행 이동시키는 캐스트다 (회전은 서브스텝 사이에서 갱신).
 *    중간 자세는 공급원에 소수 틱으로 물어보고(정확한 호), 모르면 손잡이 기준으로 칼날 방향을 구면 보간해 호를 근사한다.
 *    (두 자세의 끝점을 선형 보간하면 호가 아니라 현이 되어, 빠른 가로 베기의 한가운데를 놓친다)
 *  - 필터: PLAYER 공격은 ENEMY만, ENEMY 공격은 PLAYER만 맞는다 (+ 벽 판정용 ENVIRONMENT).
 *  - 벽: 칼날 경로에서 적보다 환경(벽)에 먼저 닿으면 그 지점을 SweepBlock으로 돌려준다 → sim이 weapon_bounce 발행.
 *    위를 향한 면(바닥)은 무시한다 — 내려찍기가 땅에 튕기지 않게.
 *  - 시작 겹침: 셰이프캐스트는 처음부터 겹쳐 있는 물체를 보고하지 않는다. 그래서 공격의 첫 스윕에는 시작 자세에서
 *    근접(겹침) 쿼리를 한 번 더 해, 벽에 붙어 휘두르거나 적에게 바짝 붙은 경우도 잡는다.
 *
 * 여러 대상을 한 번에 얻기 위해 Havok 네이티브 쿼리(수집기)를 직접 쓴다. Babylon의 공개 shapeCast는 첫 충돌 하나만 주기 때문이다.
 * (Babylon 캐릭터 컨트롤러도 같은 내부 API를 쓴다. Babylon 업데이트 시 tests/physics/weaponSweep.test.ts가 감시)
 */
import type { HavokPhysicsWithBindings, HP_BodyId, HP_CollectorId, HP_ShapeId, HP_WorldId, ShapeCastInput, ShapeProximityInput } from "@babylonjs/havok";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsShapeCapsule } from "@babylonjs/core/Physics/v2/physicsShape";
import type { AttackInstance, HitCandidate, HitQuery, SweepBlock, SweepRequest } from "../../sim/combat/types";
import type { Entity, EntityId } from "../../sim/entity";
import { vec3, type Vec3 } from "../../sim/math/vec3";
import type { CharacterSystem } from "../character/characterSystem";
import { LAYER, type LayerName } from "../layers";
import { nativeBodyId, type PhysicsWorld } from "../physicsWorld";

export interface WeaponSockets {
  hilt: Vec3;
  tip: Vec3;
}

/** 무기 소켓 공급원 — 지금은 anim/placeholderWeapon, 나중에는 손 본 소켓 */
export interface WeaponSocketProvider {
  /** tick 시점 무기 소켓 월드 위치. 알 수 없으면 false */
  sample(attacker: Readonly<Entity>, instance: Readonly<AttackInstance>, tick: number, out: WeaponSockets): boolean;
}

export interface HavokHitQueryOptions {
  /** 틱당 최대 서브스텝 (기본 8) */
  maxSubsteps?: number;
  /** 법선 y가 이 값 이상인 환경 면은 바닥으로 보고 튕기지 않는다 (기본 0.7 ≈ 45°) */
  floorNormalY?: number;
}

/** 디버그 표시용 스윕 기록 */
export interface SweepRecord {
  team: Entity["team"];
  /** 서브스텝 자세들 (손잡이/칼끝), 길이 = 서브스텝 + 1 */
  poses: WeaponSockets[];
  hits: Vec3[];
  block: Vec3 | null;
}

interface RawHit {
  fraction: number;
  bodyId: bigint;
  point: Vec3;
  normal: Vec3;
}

const UP = new Vector3(0, 1, 0);
const COLLECTOR_CAPACITY = 32;

function teamLayers(team: Entity["team"]): { self: LayerName; opponent: LayerName } {
  return team === "player" ? { self: "PLAYER", opponent: "ENEMY" } : { self: "ENEMY", opponent: "PLAYER" };
}

export class HavokHitQuery implements HitQuery {
  /** 디버그 궤적용 — 구독자가 있을 때만 기록을 만든다 */
  readonly onSweep = new Observable<SweepRecord>();

  private readonly hk: HavokPhysicsWithBindings;
  private readonly collector: HP_CollectorId;
  private readonly maxSubsteps: number;
  private readonly floorNormalY: number;
  private readonly shapes = new Map<string, PhysicsShapeCapsule>();
  private readonly prev = new Map<number, { tick: number; hilt: Vec3; tip: Vec3 }>();
  private readonly cur: WeaponSockets = { hilt: vec3(), tip: vec3() };
  private readonly before: WeaponSockets = { hilt: vec3(), tip: vec3() };
  private readonly hits: RawHit[] = [];
  private readonly seen = new Set<EntityId>();
  private readonly q = new Quaternion();
  private readonly dir = new Vector3();
  private readonly a = { hilt: vec3(), tip: vec3() };
  private readonly b = { hilt: vec3(), tip: vec3() };

  constructor(
    private readonly world: PhysicsWorld,
    private readonly characters: CharacterSystem,
    private readonly sockets: WeaponSocketProvider,
    options: HavokHitQueryOptions = {},
  ) {
    this.hk = world.plugin._hknp;
    this.collector = this.hk.HP_QueryCollector_Create(COLLECTOR_CAPACITY)[1];
    this.maxSubsteps = options.maxSubsteps ?? 8;
    this.floorNormalY = options.floorNormalY ?? 0.7;
  }

  sweep(req: Readonly<SweepRequest>, out: HitCandidate[]): SweepBlock | null {
    const { attacker, instance, def, tick } = req;
    if (!this.sockets.sample(attacker, instance, tick, this.cur)) return null;

    // 직전 틱 자세: 지난 스윕에서 기억한 값 → 없으면 공급원에 직전 틱을 물어본다 → 그것도 없으면 현재 자세(제자리 판정)
    const remembered = this.prev.get(instance.id);
    const firstSweep = !remembered;
    if (remembered && remembered.tick === tick - 1) {
      copy(this.before.hilt, remembered.hilt);
      copy(this.before.tip, remembered.tip);
    } else if (!this.sockets.sample(attacker, instance, tick - 1, this.before)) {
      copy(this.before.hilt, this.cur.hilt);
      copy(this.before.tip, this.cur.tip);
    }
    this.remember(instance.id, tick);

    const radius = def.hitbox.radius;
    const travel = Math.max(dist(this.before.tip, this.cur.tip), dist(this.before.hilt, this.cur.hilt));
    const n = Math.min(this.maxSubsteps, Math.max(1, Math.ceil(travel / Math.max(radius, 0.05))));
    const layers = teamLayers(attacker.team);
    const ignore = this.characters.bodyOf(attacker.id);
    const ignoreId: HP_BodyId = [ignore ? (nativeBodyId(ignore) ?? 0n) : 0n];

    const record = this.onSweep.hasObservers() ? { team: attacker.team, poses: [] as WeaponSockets[], hits: [] as Vec3[], block: null as Vec3 | null } : null;
    this.hits.length = 0;
    if (firstSweep) this.overlapAt(this.before, radius, layers.self, ignoreId);
    for (let i = 0; i < n; i++) {
      this.poseAt(this.a, attacker, instance, tick, i / n);
      this.poseAt(this.b, attacker, instance, tick, (i + 1) / n);
      if (record) record.poses.push(clonePose(this.a));
      this.castSegment(this.a, this.b, radius, layers.self, ignoreId, i, n);
    }
    if (record) record.poses.push(clonePose(this.cur));

    // 칼날 경로 순서대로: 벽(바닥 제외)에 먼저 닿으면 거기서 멈춘다
    this.hits.sort((x, y) => x.fraction - y.fraction);
    this.seen.clear();
    let block: SweepBlock | null = null;
    for (const h of this.hits) {
      const body = this.world.bodyFromNativeId(h.bodyId);
      if (!body) continue; // 래퍼에 등록되지 않은 바디는 무시
      const layer = this.world.layerOf(body);
      if (layer === "ENVIRONMENT") {
        if (h.normal.y >= this.floorNormalY) continue; // 바닥
        block = { point: h.point, normal: h.normal };
        break;
      }
      if (layer !== layers.opponent) continue; // 같은 편/트리거/투사체는 무기에 맞지 않는다
      const target = this.entityOf(body);
      if (target === undefined || target === attacker.id || this.seen.has(target)) continue;
      this.seen.add(target);
      out.push({ target, point: h.point });
      record?.hits.push(h.point);
    }
    if (record) {
      record.block = block ? block.point : null;
      this.onSweep.notifyObservers(record);
    }
    return block;
  }

  /** 끝난 공격의 기억 정리 */
  forget(instanceId: number): void {
    this.prev.delete(instanceId);
  }

  dispose(): void {
    this.hk.HP_QueryCollector_Release(this.collector);
    for (const s of this.shapes.values()) s.dispose();
    this.shapes.clear();
    this.onSweep.clear();
  }

  /** 직전 틱(t=0) → 현재 틱(t=1) 사이 t 지점의 자세 */
  private poseAt(out: WeaponSockets, attacker: Readonly<Entity>, instance: Readonly<AttackInstance>, tick: number, t: number): void {
    if (t <= 0) return copyPose(out, this.before);
    if (t >= 1) return copyPose(out, this.cur);
    if (this.sockets.sample(attacker, instance, tick - 1 + t, out)) return;
    slerpPose(out, this.before, this.cur, t);
  }

  private entityOf(body: PhysicsBody): EntityId | undefined {
    return this.characters.entityOfBody(body);
  }

  private remember(instanceId: number, tick: number): void {
    let r = this.prev.get(instanceId);
    if (!r) {
      r = { tick, hilt: vec3(), tip: vec3() };
      this.prev.set(instanceId, r);
    }
    r.tick = tick;
    copy(r.hilt, this.cur.hilt);
    copy(r.tip, this.cur.tip);
    // 오래된 기억 정리 (공격이 끝나면 더 이상 갱신되지 않는다)
    if (this.prev.size > 16) {
      for (const [id, v] of this.prev) if (v.tick < tick - 2) this.prev.delete(id);
    }
  }

  /** 자세 a의 캡슐(손잡이~칼끝)을 자세 b 위치까지 평행 이동 캐스트 */
  private castSegment(a: WeaponSockets, b: WeaponSockets, radius: number, selfLayer: LayerName, ignoreId: HP_BodyId, index: number, count: number): void {
    const len = Math.max(0.01, dist(a.hilt, a.tip));
    const shape = this.shapeFor(selfLayer, radius, len);
    this.orient(a);
    const input: ShapeCastInput = [
      shape._pluginData as HP_ShapeId,
      [this.q.x, this.q.y, this.q.z, this.q.w],
      [(a.hilt.x + a.tip.x) / 2, (a.hilt.y + a.tip.y) / 2, (a.hilt.z + a.tip.z) / 2],
      [(b.hilt.x + b.tip.x) / 2, (b.hilt.y + b.tip.y) / 2, (b.hilt.z + b.tip.z) / 2],
      false,
      ignoreId,
    ];
    const hk = this.hk;
    hk.HP_World_ShapeCastWithCollector(this.world.plugin.world as HP_WorldId, this.collector, input);
    const numHits = hk.HP_QueryCollector_GetNumHits(this.collector)[1];
    for (let j = 0; j < numHits; j++) {
      const [fraction, , hitPoint] = hk.HP_QueryCollector_GetShapeCastResult(this.collector, j)[1];
      const p = hitPoint[3];
      const nrm = hitPoint[4];
      this.hits.push({
        fraction: (index + fraction) / count,
        bodyId: hitPoint[0][0],
        point: vec3(p[0], p[1], p[2]),
        normal: vec3(nrm[0], nrm[1], nrm[2]),
      });
    }
  }

  /** 자세 p의 캡슐과 이미 겹친 물체 (경로 비율 0으로 기록) */
  private overlapAt(p: WeaponSockets, radius: number, selfLayer: LayerName, ignoreId: HP_BodyId): void {
    const len = Math.max(0.01, dist(p.hilt, p.tip));
    const shape = this.shapeFor(selfLayer, radius, len);
    this.orient(p);
    const input: ShapeProximityInput = [
      shape._pluginData as HP_ShapeId,
      [(p.hilt.x + p.tip.x) / 2, (p.hilt.y + p.tip.y) / 2, (p.hilt.z + p.tip.z) / 2],
      [this.q.x, this.q.y, this.q.z, this.q.w],
      0, // 거리 0 = 실제로 겹친 것만
      false,
      ignoreId,
    ];
    const hk = this.hk;
    hk.HP_World_ShapeProximityWithCollector(this.world.plugin.world as HP_WorldId, this.collector, input);
    const numHits = hk.HP_QueryCollector_GetNumHits(this.collector)[1];
    for (let j = 0; j < numHits; j++) {
      const [, , hitPoint] = hk.HP_QueryCollector_GetShapeProximityResult(this.collector, j)[1];
      const pt = hitPoint[3];
      const nrm = hitPoint[4];
      this.hits.push({ fraction: 0, bodyId: hitPoint[0][0], point: vec3(pt[0], pt[1], pt[2]), normal: vec3(nrm[0], nrm[1], nrm[2]) });
    }
  }

  /** 캡슐 로컬 +Y를 손잡이 → 칼끝 방향으로 돌리는 회전 (this.q) */
  private orient(p: WeaponSockets): void {
    this.dir.set(p.tip.x - p.hilt.x, p.tip.y - p.hilt.y, p.tip.z - p.hilt.z).normalize();
    Quaternion.FromUnitVectorsToRef(UP, this.dir, this.q);
  }

  /** 반경/길이별 캡슐 셰이프 (팀 마스크 적용). 길이는 1cm 단위로 묶어 캐시한다 */
  private shapeFor(selfLayer: LayerName, radius: number, length: number): PhysicsShapeCapsule {
    const L = Math.round(length * 100) / 100;
    const key = `${selfLayer}:${radius.toFixed(3)}:${L.toFixed(2)}`;
    let s = this.shapes.get(key);
    if (!s) {
      s = new PhysicsShapeCapsule(new Vector3(0, -L / 2, 0), new Vector3(0, L / 2, 0), radius, this.world.scene);
      // 무기 쿼리는 상대 캐릭터와 벽만 본다 (membership은 공격자 레이어 — 상대의 collide 마스크가 받아 준다)
      s.filterMembershipMask = LAYER[selfLayer];
      s.filterCollideMask = (selfLayer === "PLAYER" ? LAYER.ENEMY : LAYER.PLAYER) | LAYER.ENVIRONMENT;
      this.shapes.set(key, s);
    }
    return s;
  }
}

function copy(out: Vec3, a: Readonly<Vec3>): void {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
}

function dist(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function copyPose(out: WeaponSockets, a: WeaponSockets): void {
  copy(out.hilt, a.hilt);
  copy(out.tip, a.tip);
}

/** 손잡이는 선형 보간, 칼날 방향은 구면 보간(회전), 길이는 선형 보간 — 손잡이를 축으로 한 휘두름의 호를 근사 */
function slerpPose(out: WeaponSockets, a: WeaponSockets, b: WeaponSockets, t: number): void {
  out.hilt.x = a.hilt.x + (b.hilt.x - a.hilt.x) * t;
  out.hilt.y = a.hilt.y + (b.hilt.y - a.hilt.y) * t;
  out.hilt.z = a.hilt.z + (b.hilt.z - a.hilt.z) * t;
  let ax = a.tip.x - a.hilt.x;
  let ay = a.tip.y - a.hilt.y;
  let az = a.tip.z - a.hilt.z;
  let bx = b.tip.x - b.hilt.x;
  let by = b.tip.y - b.hilt.y;
  let bz = b.tip.z - b.hilt.z;
  const la = Math.hypot(ax, ay, az) || 1;
  const lb = Math.hypot(bx, by, bz) || 1;
  ax /= la;
  ay /= la;
  az /= la;
  bx /= lb;
  by /= lb;
  bz /= lb;
  const dot = Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz));
  const omega = Math.acos(dot);
  let wa = 1 - t;
  let wb = t;
  if (omega > 1e-4) {
    const so = Math.sin(omega);
    wa = Math.sin((1 - t) * omega) / so;
    wb = Math.sin(t * omega) / so;
  }
  const len = la + (lb - la) * t;
  out.tip.x = out.hilt.x + (ax * wa + bx * wb) * len;
  out.tip.y = out.hilt.y + (ay * wa + by * wb) * len;
  out.tip.z = out.hilt.z + (az * wa + bz * wb) * len;
}

function clonePose(p: WeaponSockets): WeaponSockets {
  return { hilt: vec3(p.hilt.x, p.hilt.y, p.hilt.z), tip: vec3(p.tip.x, p.tip.y, p.tip.z) };
}
