/**
 * 무기 스윕 판정 — 실제 Havok(WASM)으로 검증 (Node, NullEngine)
 */
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CharacterSystem } from "../../src/physics/character/characterSystem";
import { HavokHitQuery, type WeaponSocketProvider, type WeaponSockets } from "../../src/physics/combat/havokHitQuery";
import { placeholderSockets } from "../../src/physics/combat/placeholderSockets";
import { createStaticBox } from "../../src/physics/testGeometry";
import type { AttackInstance, HitCandidate } from "../../src/sim/combat/types";
import { ATTACKS, type AttackId } from "../../src/sim/data/attacks";
import { PLAYER_TIMELINES } from "../../src/sim/data/playerTimelines";
import type { Entity } from "../../src/sim/entity";
import { BUTTON, createInputFrame } from "../../src/sim/inputFrame";
import { vec3, type Vec3 } from "../../src/sim/math/vec3";
import { SIM_DT } from "../../src/sim/time";
import { SimWorld } from "../../src/sim/world";
import { createPhysicsFixture, type PhysicsFixture } from "./havokTestUtil";

let fx: PhysicsFixture;
let characters: CharacterSystem;
let sim: SimWorld;

beforeEach(async () => {
  fx = await createPhysicsFixture();
  characters = new CharacterSystem(fx.world);
  sim = new SimWorld({ movement: characters });
});
afterEach(() => fx.dispose());

/** 틱별 소켓 위치를 직접 지정하는 공급원 */
class ScriptedSockets implements WeaponSocketProvider {
  readonly poses = new Map<number, WeaponSockets>();
  set(tick: number, hilt: Vec3, tip: Vec3): void {
    this.poses.set(tick, { hilt, tip });
  }
  sample(_a: Readonly<Entity>, _i: Readonly<AttackInstance>, tick: number, out: WeaponSockets): boolean {
    const p = this.poses.get(tick);
    if (!p) return false;
    out.hilt.x = p.hilt.x;
    out.hilt.y = p.hilt.y;
    out.hilt.z = p.hilt.z;
    out.tip.x = p.tip.x;
    out.tip.y = p.tip.y;
    out.tip.z = p.tip.z;
    return true;
  }
}

function instance(attacker: Entity, attack: AttackId = "attack_light_1"): AttackInstance {
  return { id: 1, attackerId: attacker.id, attack, startTick: 0, active: true, hitList: new Set() };
}

function sweep(q: HavokHitQuery, attacker: Entity, tick: number, attack: AttackId = "attack_light_1") {
  // Havok 브로드페이즈는 물리 스텝에서 갱신된다 — 방금 만든 바디도 쿼리에 잡히도록 한 번 진행
  fx.world.step(SIM_DT);
  const out: HitCandidate[] = [];
  const block = q.sweep({ attacker, instance: instance(attacker, attack), def: ATTACKS[attack], tick }, out);
  return { out, block };
}

/** 손잡이를 원점 근처에 두고 칼끝이 yaw 각도로 놓인 자세 */
function armAt(yawDeg: number, reach = 1.6, h = 1.1): [Vec3, Vec3] {
  const y = (yawDeg * Math.PI) / 180;
  return [vec3(Math.sin(y) * 0.4, h, Math.cos(y) * 0.4), vec3(Math.sin(y) * reach, h, Math.cos(y) * reach)];
}

describe("무기 스윕 — 기본 판정", () => {
  it("칼끝이 지나간 자리의 적을 맞힌다 (공격자 자신은 제외)", () => {
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    const foe = sim.spawn("hollow", "enemy", { x: 0, y: 0, z: 1.3 });
    const s = new ScriptedSockets();
    s.set(9, ...armAt(60));
    s.set(10, ...armAt(-60));
    const q = new HavokHitQuery(fx.world, characters, s);
    const { out, block } = sweep(q, hero, 10);
    expect(out.map((c) => c.target)).toEqual([foe.id]);
    expect(block).toBeNull();
  });

  it("빠른 휘두름: 한 틱에 120° 돌아도 서브스텝으로 틈 없이 맞힌다 (서브스텝 1이면 놓침)", () => {
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    const foe = sim.spawn("hound", "enemy", { x: 0, y: 0, z: 1.35 }); // 호의 한가운데, 칼끝 근처
    const s = new ScriptedSockets();
    s.set(9, ...armAt(60));
    s.set(10, ...armAt(-60));
    const coarse = new HavokHitQuery(fx.world, characters, s, { maxSubsteps: 1 });
    const fine = new HavokHitQuery(fx.world, characters, s);
    expect(sweep(coarse, hero, 10).out).toEqual([]);
    expect(sweep(fine, hero, 10).out.map((c) => c.target)).toEqual([foe.id]);
  });

  it("한 번의 휘두름에 여러 적을 모두 맞힌다", () => {
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    const left = sim.spawn("hollow", "enemy", { x: -0.9, y: 0, z: 1.0 });
    const right = sim.spawn("hollow", "enemy", { x: 0.9, y: 0, z: 1.0 });
    const s = new ScriptedSockets();
    s.set(9, ...armAt(70));
    s.set(10, ...armAt(-70));
    const { out } = sweep(new HavokHitQuery(fx.world, characters, s), hero, 10);
    expect(out.map((c) => c.target).sort()).toEqual([left.id, right.id].sort());
  });

  it("PLAYER 공격은 PLAYER(아군)를, ENEMY 공격은 ENEMY를 맞히지 않는다", () => {
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    const ally = sim.spawnPlayer({ x: 0, y: 0, z: 1.3 });
    const foe = sim.spawn("hollow", "enemy", { x: 5, y: 0, z: 0 });
    const foeAlly = sim.spawn("hollow", "enemy", { x: 5, y: 0, z: 1.3 });
    const s = new ScriptedSockets();
    s.set(9, ...armAt(60));
    s.set(10, ...armAt(-60));
    const q = new HavokHitQuery(fx.world, characters, s);
    expect(sweep(q, hero, 10).out).toEqual([]);
    // 적의 공격: 같은 궤적을 적 위치로 옮긴다
    const s2 = new ScriptedSockets();
    const [h9, t9] = armAt(60);
    const [h10, t10] = armAt(-60);
    s2.set(9, vec3(h9.x + 5, h9.y, h9.z), vec3(t9.x + 5, t9.y, t9.z));
    s2.set(10, vec3(h10.x + 5, h10.y, h10.z), vec3(t10.x + 5, t10.y, t10.z));
    expect(sweep(new HavokHitQuery(fx.world, characters, s2), foe, 10, "hollow_slash").out).toEqual([]);
    expect(foeAlly.id).not.toBe(ally.id);
  });

  it("ENEMY 공격은 PLAYER를 맞힌다", () => {
    const foe = sim.spawn("hollow", "enemy", { x: 0, y: 0, z: 0 });
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 1.3 });
    const s = new ScriptedSockets();
    s.set(9, ...armAt(60));
    s.set(10, ...armAt(-60));
    expect(sweep(new HavokHitQuery(fx.world, characters, s), foe, 10, "hollow_slash").out.map((c) => c.target)).toEqual([hero.id]);
  });
});

describe("무기 스윕 — 벽 튕김", () => {
  it("적보다 벽에 먼저 닿으면 막힌 지점을 돌려주고, 벽 뒤의 적은 맞지 않는다", () => {
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    createStaticBox(fx.world, fx.scene, { center: new Vector3(0.9, 1.5, 0.9), size: new Vector3(0.3, 3, 0.3) }); // 오른쪽 앞 기둥
    const behind = sim.spawn("hollow", "enemy", { x: -1.1, y: 0, z: 0.9 }); // 왼쪽 (휘두름 후반)
    const s = new ScriptedSockets();
    s.set(9, ...armAt(80));
    s.set(10, ...armAt(-80));
    const { out, block } = sweep(new HavokHitQuery(fx.world, characters, s), hero, 10);
    expect(block).not.toBeNull();
    expect(block?.point.x).toBeGreaterThan(0.3);
    expect(out.map((c) => c.target)).not.toContain(behind.id);
  });

  it("벽 앞의 적은 맞고, 그 뒤에 막힌다", () => {
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    const first = sim.spawn("hollow", "enemy", { x: 1.0, y: 0, z: 0.9 }); // 휘두름 전반
    createStaticBox(fx.world, fx.scene, { center: new Vector3(-0.9, 1.5, 0.9), size: new Vector3(0.3, 3, 0.3) }); // 후반의 기둥
    const s = new ScriptedSockets();
    s.set(9, ...armAt(80));
    s.set(10, ...armAt(-80));
    const { out, block } = sweep(new HavokHitQuery(fx.world, characters, s), hero, 10);
    expect(out.map((c) => c.target)).toEqual([first.id]);
    expect(block).not.toBeNull();
  });

  it("바닥을 긁는 내려찍기는 튕기지 않는다", () => {
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    const s = new ScriptedSockets();
    s.set(9, vec3(0, 1.5, 0.4), vec3(0, 1.5, 1.6));
    s.set(10, vec3(0, 0.08, 0.4), vec3(0, 0.08, 1.6)); // 칼날이 바닥에 닿음 (반경 0.12)
    expect(sweep(new HavokHitQuery(fx.world, characters, s), hero, 10).block).toBeNull();
  });
});

describe("무기 스윕 — 시작 겹침", () => {
  it("첫 스윕에 칼이 이미 적과 겹쳐 있으면(바짝 붙음) 맞힌다", () => {
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    const foe = sim.spawn("hollow", "enemy", { x: 0, y: 0, z: 1.0 });
    const s = new ScriptedSockets();
    // 정지 자세 (이동 없음) — 셰이프캐스트만으로는 잡히지 않는 경우
    s.set(9, vec3(0, 1.1, 0.4), vec3(0, 1.1, 1.6));
    s.set(10, vec3(0, 1.1, 0.4), vec3(0, 1.1, 1.6));
    expect(sweep(new HavokHitQuery(fx.world, characters, s), hero, 10).out.map((c) => c.target)).toEqual([foe.id]);
  });
});

describe("무기 스윕 — 직전 자세", () => {
  it("첫 판정 틱에는 공급원에서 직전 틱 자세를 받아 스윕한다", () => {
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    const foe = sim.spawn("hound", "enemy", { x: 0, y: 0, z: 1.35 });
    const s = new ScriptedSockets();
    s.set(9, ...armAt(60));
    s.set(10, ...armAt(-60));
    expect(sweep(new HavokHitQuery(fx.world, characters, s), hero, 10).out.map((c) => c.target)).toEqual([foe.id]);
  });

  it("다음 틱에는 지난 스윕에서 기억한 자세부터 이어서 스윕한다 (두 틱 사이의 대상도 놓치지 않음)", () => {
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    const foe = sim.spawn("hound", "enemy", { x: -0.95, y: 0, z: 0.95 }); // -45° 근처
    const s = new ScriptedSockets();
    s.set(9, ...armAt(90));
    s.set(10, ...armAt(10));
    s.set(11, ...armAt(-80));
    const q = new HavokHitQuery(fx.world, characters, s);
    expect(sweep(q, hero, 10).out).toEqual([]);
    s.poses.delete(10); // 공급원은 더 이상 10틱을 모른다 — 기억한 값을 써야 한다
    expect(sweep(q, hero, 11).out.map((c) => c.target)).toEqual([foe.id]);
  });
});

describe("sim 연동 (상태 머신 → 이동 → 전투 → Havok 스윕)", () => {
  function setupWithQuery() {
    const q = new HavokHitQuery(fx.world, characters, placeholderSockets);
    sim = new SimWorld({ movement: characters, hitQuery: q });
    return q;
  }

  function attack(hero: Entity, ticks: number): void {
    const f = createInputFrame();
    f.pressed = BUTTON.attack_light;
    sim.players.setInput(hero.id, f);
    for (let i = 0; i < ticks; i++) {
      sim.step();
      fx.world.step(SIM_DT);
    }
  }

  it("약공격 1타가 앞의 적을 한 번 맞힌다", () => {
    setupWithQuery();
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    const foe = sim.spawn("hollow", "enemy", { x: 0, y: 0, z: 1.4 }, Math.PI);
    attack(hero, PLAYER_TIMELINES.attack_light_1.length);
    const hits = sim.drainEvents().filter((e) => e.type === "hit");
    expect(hits.length).toBe(1);
    expect(foe.health).toBeLessThan(foe.maxHealth);
  });

  it("휘두르는 도중 벽에 닿으면 weapon_bounce가 나고 공격이 끝난다", () => {
    setupWithQuery();
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    createStaticBox(fx.world, fx.scene, { center: new Vector3(-1.2, 1.5, 0.6), size: new Vector3(0.4, 3, 2) }); // 왼쪽 벽 (휘두름이 끝나는 쪽)
    attack(hero, PLAYER_TIMELINES.attack_light_1.length);
    const evs = sim.drainEvents();
    expect(evs.filter((e) => e.type === "weapon_bounce").length).toBe(1);
  });

  it("칼이 처음부터 벽 안에 있으면(벽에 붙어 휘두름) 첫 판정 틱에 튕긴다", () => {
    setupWithQuery();
    const hero = sim.spawnPlayer({ x: 0, y: 0, z: 0 });
    createStaticBox(fx.world, fx.scene, { center: new Vector3(1.2, 1.5, 0.6), size: new Vector3(0.4, 3, 2) }); // 오른쪽 벽 (휘두름 시작 쪽)
    attack(hero, PLAYER_TIMELINES.attack_light_1.length);
    const bounce = sim.drainEvents().find((e) => e.type === "weapon_bounce");
    expect(bounce).toBeDefined();
    expect(bounce?.tick).toBeLessThanOrEqual((PLAYER_TIMELINES.attack_light_1.hit?.start ?? 0) + 2);
  });
});
