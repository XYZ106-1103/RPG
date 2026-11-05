import { beforeEach, describe, expect, it } from "vitest";
import type { HitCandidate, HitQuery, SweepRequest } from "../../src/sim/combat/types";
import { isBackAttack, isGuardableFrom } from "../../src/sim/combat/facing";
import { ATTACKS, type AttackId } from "../../src/sim/data/attacks";
import { COMBAT_RULES } from "../../src/sim/data/combat";
import { FLAG, hasFlag, isDead, isStaggered, type Entity, type EntityId } from "../../src/sim/entity";
import type { SimEvent } from "../../src/sim/events";
import { vec3 } from "../../src/sim/math/vec3";
import { decodeWorld, encodeWorld } from "../../src/sim/serialize";
import { SimWorld } from "../../src/sim/world";

/** 테스트용 HitQuery: 공격자별로 "이번 틱에 겹친 대상"을 지정한다 (physics/ 구현 대신) */
class ScriptedHitQuery implements HitQuery {
  readonly overlaps = new Map<EntityId, EntityId[]>();
  calls = 0;
  sweep(req: Readonly<SweepRequest>, out: HitCandidate[]): void {
    this.calls++;
    for (const id of this.overlaps.get(req.attacker.id) ?? []) out.push({ target: id, point: vec3(0, 1.2, 0.75) });
  }
}

let query: ScriptedHitQuery;
let world: SimWorld;
let player: Entity;
let hollow: Entity;

/** 플레이어는 원점에서 +Z를, 망자는 1.5m 앞에서 플레이어(-Z)를 본다 — 서로 마주 봄 */
beforeEach(() => {
  query = new ScriptedHitQuery();
  world = new SimWorld({ seed: 7, hitQuery: query });
  player = world.spawn("player", "player", { x: 0, y: 0, z: 0 }, 0);
  hollow = world.spawn("hollow", "enemy", { x: 0, y: 0, z: 1.5 }, Math.PI);
});

function swing(attacker: Entity, attack: AttackId, targets: Entity[], ticks = 1) {
  const inst = world.combat.start(world, attacker, attack);
  if (!inst) throw new Error(`공격 시작 실패: ${attack}`);
  world.combat.setActive(inst.id, true);
  query.overlaps.set(
    attacker.id,
    targets.map((t) => t.id),
  );
  for (let i = 0; i < ticks; i++) world.step();
  return inst;
}

function events(): SimEvent[] {
  return world.drainEvents();
}

function types(evs: SimEvent[]): string[] {
  return evs.filter((e) => e.type !== "attack_start").map((e) => e.type);
}

describe("공격 시작", () => {
  it("공격자 스태미나를 AttackDef 소모량만큼 쓰고 attack_start를 낸다", () => {
    const inst = world.combat.start(world, player, "attack_heavy");
    expect(inst).not.toBeNull();
    expect(player.stamina).toBe(player.maxStamina - ATTACKS.attack_heavy.staminaCost);
    expect(events()).toEqual([{ tick: 0, type: "attack_start", payload: { attacker: player.id, attack: "attack_heavy", instance: inst?.id } }]);
  });

  it("스태미나 0이거나 경직/사망이면 공격을 시작할 수 없다", () => {
    player.stamina = 0;
    expect(world.combat.start(world, player, "attack_light_1")).toBeNull();
    player.stamina = 100;
    player.flags |= FLAG.STAGGERED;
    expect(world.combat.start(world, player, "attack_light_1")).toBeNull();
    expect(world.combat.active.length).toBe(0);
  });

  it("판정이 열리기 전(active=false)에는 HitQuery를 호출하지 않는다", () => {
    world.combat.start(world, player, "attack_light_1");
    query.overlaps.set(player.id, [hollow.id]);
    world.step();
    expect(query.calls).toBe(0);
    expect(hollow.health).toBe(hollow.maxHealth);
  });
});

describe("중복 타격 방지 (공격 인스턴스별 히트 목록)", () => {
  it("판정이 여러 틱 겹쳐도 한 공격은 대상당 한 번만 맞힌다", () => {
    swing(player, "attack_light_1", [hollow], 12);
    const hits = events().filter((e) => e.type === "hit");
    expect(hits.length).toBe(1);
    expect(hollow.health).toBe(hollow.maxHealth - ATTACKS.attack_light_1.damage);
  });

  it("한 번의 휘두름이 여러 대상을 각각 한 번씩 맞힌다", () => {
    const hound = world.spawn("hound", "enemy", { x: 1, y: 0, z: 1 }, Math.PI);
    swing(player, "attack_light_1", [hollow, hound], 5);
    const hitTargets = events()
      .filter((e) => e.type === "hit")
      .map((e) => (e.type === "hit" ? e.payload.target : -1));
    expect(hitTargets).toEqual([hollow.id, hound.id]);
  });

  it("콤보의 다음 타는 새 인스턴스라 다시 맞힐 수 있다", () => {
    swing(player, "attack_light_1", [hollow], 3);
    swing(player, "attack_light_2", [hollow], 3);
    expect(events().filter((e) => e.type === "hit").length).toBe(2);
  });

  it("새 공격을 시작하면 같은 공격자의 이전 공격은 끝난다 (동시에 하나)", () => {
    const first = world.combat.start(world, player, "attack_light_1");
    const second = world.combat.start(world, player, "attack_light_2");
    expect(world.combat.active.map((a) => a.id)).toEqual([second?.id]);
    expect(first?.id).not.toBe(second?.id);
  });

  it("자기 자신과 같은 팀은 맞지 않는다", () => {
    const ally = world.spawn("player", "player", { x: 0.5, y: 0, z: 0.5 });
    swing(player, "attack_light_1", [player, ally], 3);
    expect(types(events())).toEqual([]);
    expect(ally.health).toBe(ally.maxHealth);
    expect(COMBAT_RULES.friendlyFire).toBe(false);
  });

  it("스냅샷 복원 후에도 히트 목록이 유지되어 다시 맞지 않는다 (리플레이/멀티)", () => {
    const inst = swing(player, "attack_light_1", [hollow], 1);
    events();
    const restored = decodeWorld(encodeWorld(world), { hitQuery: query });
    expect(restored.combat.get(inst.id)?.hitList.has(hollow.id)).toBe(true);
    for (let i = 0; i < 5; i++) restored.step();
    expect(restored.drainEvents().filter((e) => e.type === "hit")).toEqual([]);
  });

  it("물리 결과 순서가 달라도 판정 결과는 같다 (결정성)", () => {
    const hound = world.spawn("hound", "enemy", { x: 1, y: 0, z: 1 }, Math.PI);
    swing(player, "attack_light_1", [hound, hollow], 1);
    const a = types(events());
    const b = (() => {
      query = new ScriptedHitQuery();
      world = new SimWorld({ seed: 7, hitQuery: query });
      player = world.spawn("player", "player", { x: 0, y: 0, z: 0 }, 0);
      hollow = world.spawn("hollow", "enemy", { x: 0, y: 0, z: 1.5 }, Math.PI);
      const h2 = world.spawn("hound", "enemy", { x: 1, y: 0, z: 1 }, Math.PI);
      swing(player, "attack_light_1", [hollow, h2], 1);
      return world.drainEvents();
    })();
    expect(b.filter((e) => e.type === "hit").map((e) => (e.type === "hit" ? e.payload.target : 0))).toEqual([2, 3]);
    expect(types(b)).toEqual(a);
  });
});

describe("i-frame (무적)", () => {
  it("무적 중에는 판정을 무시한다: 피해/이벤트/히트 목록 없음", () => {
    hollow.flags |= FLAG.INVULNERABLE;
    const inst = swing(player, "attack_light_1", [hollow], 5);
    expect(types(events())).toEqual([]);
    expect(hollow.health).toBe(hollow.maxHealth);
    expect(hollow.poise).toBe(hollow.maxPoise);
    expect(inst.hitList.has(hollow.id)).toBe(false);
  });

  it("무적이 끝난 뒤 칼이 아직 겹쳐 있으면 같은 휘두름에 한 번 맞는다", () => {
    hollow.flags |= FLAG.INVULNERABLE;
    swing(player, "attack_light_1", [hollow], 3);
    hollow.flags &= ~FLAG.INVULNERABLE;
    for (let i = 0; i < 3; i++) world.step();
    expect(events().filter((e) => e.type === "hit").length).toBe(1);
  });
});

describe("가드 (스태미나로 피해 흡수)", () => {
  beforeEach(() => {
    player.flags |= FLAG.GUARDING;
  });

  it("정면 가드: 피해 대부분을 막고 스태미나가 깎인다", () => {
    swing(hollow, "hollow_slash", [player]);
    const def = ATTACKS.hollow_slash;
    const evs = events();
    expect(types(evs)).toEqual(["guard"]);
    const g = evs.find((e) => e.type === "guard");
    if (g?.type !== "guard") throw new Error("guard event missing");
    expect(g.payload.broken).toBe(false);
    expect(g.payload.chipDamage).toBeCloseTo(def.damage * (1 - COMBAT_RULES.guardAbsorb), 9);
    expect(g.payload.staminaDamage).toBe(def.guardStaminaDamage);
    expect(player.stamina).toBe(player.maxStamina - def.guardStaminaDamage);
    expect(player.health).toBeCloseTo(player.maxHealth - g.payload.chipDamage, 9);
    expect(isStaggered(player)).toBe(false);
    expect(hasFlag(player, FLAG.GUARDING)).toBe(true);
  });

  it("스태미나가 모자라면 가드 브레이크: 스태미나 0, 가드한 쪽 경직, guard → stagger 순서", () => {
    player.stamina = ATTACKS.hollow_overhead.guardStaminaDamage - 1;
    player.staminaRegenDelay = 10;
    swing(hollow, "hollow_overhead", [player]);
    const evs = events();
    expect(types(evs)).toEqual(["guard", "stagger"]);
    const g = evs.find((e) => e.type === "guard");
    expect(g?.type === "guard" && g.payload.broken).toBe(true);
    expect(player.stamina).toBe(0);
    expect(isStaggered(player)).toBe(true);
    expect(hasFlag(player, FLAG.GUARDING)).toBe(false);
  });

  it("스태미나가 정확히 소모량만큼이면 바닥나므로 브레이크", () => {
    player.stamina = ATTACKS.hollow_slash.guardStaminaDamage;
    player.staminaRegenDelay = 10; // 같은 틱에 스탯(회복)이 전투보다 먼저 돌므로 회복을 막아 경계를 정확히 맞춘다
    swing(hollow, "hollow_slash", [player]);
    expect(isStaggered(player)).toBe(true);
  });

  it("등 뒤에서 맞으면 가드가 통하지 않는다 (백어택 피격)", () => {
    player.yaw = Math.PI; // 망자에게 등을 보인다
    swing(hollow, "hollow_slash", [player]);
    const evs = events();
    expect(types(evs)).toEqual(["hit"]);
    const h = evs.find((e) => e.type === "hit");
    expect(h?.type === "hit" && h.payload.backAttack).toBe(true);
    expect(player.stamina).toBe(player.maxStamina);
  });

  it("칩 데미지로 죽으면 guard → death (경직 없음)", () => {
    player.health = 1;
    swing(hollow, "hollow_slash", [player]);
    expect(types(events())).toEqual(["guard", "death"]);
    expect(isDead(player)).toBe(true);
  });
});

describe("패리", () => {
  it("성공: 패리 윈도우 중 정면에서 받으면 피해 없이 공격자가 경직되고 공격이 끝난다", () => {
    player.flags |= FLAG.PARRY;
    const inst = swing(hollow, "hollow_slash", [player]);
    const evs = events();
    expect(types(evs)).toEqual(["parry", "stagger"]);
    const p = evs.find((e) => e.type === "parry");
    expect(p?.type === "parry" && p.payload).toMatchObject({ parrier: player.id, attacker: hollow.id, attack: "hollow_slash" });
    const s = evs.find((e) => e.type === "stagger");
    expect(s?.type === "stagger" && s.payload.entity).toBe(hollow.id);
    expect(isStaggered(hollow)).toBe(true);
    expect(player.health).toBe(player.maxHealth);
    expect(player.stamina).toBe(player.maxStamina);
    expect(world.combat.get(inst.id)).toBeUndefined();
  });

  it("성공 후 같은 공격의 남은 대상은 판정하지 않는다", () => {
    const ally = world.spawn("player", "player", { x: -0.5, y: 0, z: 0.3 }, 0);
    player.flags |= FLAG.PARRY;
    swing(hollow, "hollow_slash", [player, ally]);
    expect(ally.health).toBe(ally.maxHealth);
  });

  it("실패: 패리 윈도우 밖(플래그 없음)이면 그대로 맞는다", () => {
    swing(hollow, "hollow_slash", [player]);
    expect(types(events())).toEqual(["hit"]);
    expect(player.health).toBe(player.maxHealth - ATTACKS.hollow_slash.damage);
    expect(isStaggered(hollow)).toBe(false);
  });

  it("실패: 패리 불가 공격(보스 내려찍기)은 패리 윈도우여도 맞는다", () => {
    const knight = world.spawn("ash_knight", "enemy", { x: 0, y: 0, z: 2.5 }, Math.PI);
    player.flags |= FLAG.PARRY;
    swing(knight, "ash_knight_slam", [player]);
    const evs = types(events());
    expect(evs[0]).toBe("hit");
    expect(evs).not.toContain("parry");
    expect(isStaggered(knight)).toBe(false);
    expect(ATTACKS.ash_knight_slam.parryable).toBe(false);
  });

  it("실패: 등 뒤에서 온 공격은 패리할 수 없다", () => {
    player.flags |= FLAG.PARRY;
    player.yaw = Math.PI;
    swing(hollow, "hollow_slash", [player]);
    expect(types(events())[0]).toBe("hit");
  });

  it("경직되면 패리 윈도우도 끊긴다 (등 뒤에서 맞아 경직된 경우)", () => {
    player.flags |= FLAG.PARRY;
    player.yaw = Math.PI;
    swing(hollow, "hollow_overhead", [player]);
    expect(isStaggered(player)).toBe(true);
    expect(hasFlag(player, FLAG.PARRY)).toBe(false);
  });
});

describe("피격과 백어택", () => {
  it("hit 이벤트: 피해, 히트스톱, 공격자→피격자 방향 넉백, 타격 지점", () => {
    swing(player, "attack_light_1", [hollow]);
    const h = events().find((e) => e.type === "hit");
    if (h?.type !== "hit") throw new Error("hit event missing");
    expect(h.payload).toMatchObject({
      attacker: player.id,
      target: hollow.id,
      attack: "attack_light_1",
      damage: ATTACKS.attack_light_1.damage,
      backAttack: false,
      hitstopFrames: ATTACKS.attack_light_1.hitstopFrames,
      staggered: false,
      killed: false,
      point: { x: 0, y: 1.2, z: 0.75 },
    });
    expect(h.payload.knockback.x).toBeCloseTo(0, 9);
    expect(h.payload.knockback.z).toBeCloseTo(ATTACKS.attack_light_1.knockback, 9);
  });

  it("백어택은 피해와 강인도 피해에 배율이 붙는다", () => {
    hollow.yaw = 0; // 플레이어에게 등을 보인다
    swing(player, "attack_light_1", [hollow]);
    const h = events().find((e) => e.type === "hit");
    expect(h?.type === "hit" && h.payload.backAttack).toBe(true);
    expect(hollow.health).toBe(hollow.maxHealth - ATTACKS.attack_light_1.damage * COMBAT_RULES.backAttackDamageMultiplier);
  });

  it("강인도를 넘는 피해는 hit(staggered) → stagger", () => {
    swing(player, "attack_heavy", [hollow]);
    const evs = events();
    expect(types(evs)).toEqual(["hit", "stagger"]);
    expect(isStaggered(hollow)).toBe(true);
  });

  it("치명타는 hit(killed) → death, 이후 판정에서 무시된다", () => {
    hollow.health = 5;
    swing(player, "attack_light_1", [hollow], 3);
    const evs = events();
    expect(types(evs)).toEqual(["hit", "death"]);
    const h = evs.find((e) => e.type === "hit");
    expect(h?.type === "hit" && h.payload).toMatchObject({ damage: 5, killed: true, staggered: false });
    swing(player, "attack_light_2", [hollow], 3);
    expect(types(events())).toEqual([]);
  });

  it("공격 도중 공격자가 경직되면 공격이 끊긴다", () => {
    const inst = world.combat.start(world, hollow, "hollow_slash");
    if (!inst) throw new Error("start failed");
    hollow.flags |= FLAG.STAGGERED;
    hollow.staggerTicks = 30;
    world.step();
    expect(world.combat.get(inst.id)).toBeUndefined();
  });
});

describe("방향 판정", () => {
  const at = (x: number, z: number, yaw: number) => world.spawn("hollow", "enemy", { x, y: 0, z }, yaw);
  it("정면 ±70° 안이면 가드 가능, 옆구리/등은 불가", () => {
    const target = at(0, 0, 0);
    expect(isGuardableFrom(target, at(0, 2, 0))).toBe(true);
    expect(isGuardableFrom(target, at(Math.sin(1.1) * 2, Math.cos(1.1) * 2, 0))).toBe(true); // 63°
    expect(isGuardableFrom(target, at(2, 0.2, 0))).toBe(false); // ~84°
    expect(isGuardableFrom(target, at(0, -2, 0))).toBe(false);
  });

  it("백어택: 공격 방향이 피격자 정면과 60° 이내 (등 뒤에서 앞으로)", () => {
    const target = at(0, 0, 0);
    const s = vec3();
    expect(isBackAttack(at(0, -2, 0), target, s)).toBe(true); // 바로 뒤
    expect(isBackAttack(at(-1, -1.5, 0), target, s)).toBe(true); // 뒤 대각선 ~34°
    expect(isBackAttack(at(-2, 0, 0), target, s)).toBe(false); // 옆 (90°)
    expect(isBackAttack(at(0, 2, 0), target, s)).toBe(false); // 정면
  });
});
