import { beforeEach, describe, expect, it } from "vitest";
import type { HitCandidate, HitQuery, SweepRequest } from "../../src/sim/combat/types";
import { ATTACKS } from "../../src/sim/data/attacks";
import { PLAYER_ITEMS } from "../../src/sim/data/player";
import { PLAYER_TIMELINES } from "../../src/sim/data/playerTimelines";
import { STAMINA_ACTIONS } from "../../src/sim/data/stamina";
import { FLAG, hasFlag, type Entity, type EntityId } from "../../src/sim/entity";
import type { SimEvent } from "../../src/sim/events";
import { BUTTON, createInputFrame, type InputFrame } from "../../src/sim/inputFrame";
import { vec3 } from "../../src/sim/math/vec3";
import type { PlayerState } from "../../src/sim/player/types";
import { decodeWorld, encodeWorld } from "../../src/sim/serialize";
import { applyPoiseDamage, kill } from "../../src/sim/stats";
import { SimWorld } from "../../src/sim/world";

const TL = PLAYER_TIMELINES;

class ScriptedHitQuery implements HitQuery {
  readonly overlaps = new Map<EntityId, EntityId[]>();
  sweep(req: Readonly<SweepRequest>, out: HitCandidate[]): void {
    for (const id of this.overlaps.get(req.attacker.id) ?? []) out.push({ target: id, point: vec3(0, 1, 0) });
  }
}

let world: SimWorld;
let query: ScriptedHitQuery;
let hero: Entity;
let ps: PlayerState;

beforeEach(() => {
  query = new ScriptedHitQuery();
  world = new SimWorld({ seed: 3, hitQuery: query });
  hero = world.spawnPlayer({ x: 0, y: 0, z: 0 }, 0);
  const p = world.players.get(hero.id);
  if (!p) throw new Error("player state missing");
  ps = p;
});

interface FrameOpts {
  press?: (keyof typeof BUTTON)[];
  hold?: (keyof typeof BUTTON)[];
  move?: [number, number];
  viewYaw?: number;
}

function frame(o: FrameOpts = {}): InputFrame {
  const f = createInputFrame();
  f.tick = world.tick + 1;
  for (const b of o.press ?? []) f.pressed |= BUTTON[b];
  for (const b of o.hold ?? []) f.held |= BUTTON[b];
  f.moveX = o.move?.[0] ?? 0;
  f.moveY = o.move?.[1] ?? 0;
  f.viewYaw = o.viewYaw ?? 0;
  return f;
}

/** 한 틱 진행 */
function tick(o: FrameOpts = {}): void {
  world.players.setInput(hero.id, frame(o));
  world.step();
}

/** 입력 없이 n틱 */
function idle(n: number): void {
  for (let i = 0; i < n; i++) tick();
}

/** 현재 행동의 stateTick이 target이 될 때까지 빈 입력으로 진행 */
function advanceTo(stateTick: number): void {
  while (ps.stateTick < stateTick - 1) tick();
}

function drain(): SimEvent[] {
  return world.drainEvents();
}

function attackStarts(evs: SimEvent[]): string[] {
  return evs.flatMap((e) => (e.type === "attack_start" ? [e.payload.attack] : []));
}

describe("약공격 3콤보", () => {
  it("버퍼 구간에 누른 약공격이 캔슬 틱에 다음 타로 이어진다: 1 → 2 → 3 → 1", () => {
    tick({ press: ["attack_light"] });
    expect(ps.action).toBe("attack_light_1");

    for (const [from, to] of [
      ["attack_light_1", "attack_light_2"],
      ["attack_light_2", "attack_light_3"],
      ["attack_light_3", "attack_light_1"],
    ] as const) {
      const tl = TL[from];
      const buf = tl.buffer;
      if (!buf) throw new Error("buffer missing");
      advanceTo(buf.start);
      tick({ press: ["attack_light"] }); // 버퍼 시작 틱에 입력
      expect(ps.action).toBe(from);
      expect(ps.reserved).toBe("light");
      advanceTo(tl.cancel);
      expect(ps.action).toBe(from); // 캔슬 직전까지는 그대로
      tick(); // 캔슬 틱: 예약 실행
      expect(ps.action).toBe(to);
      expect(ps.stateTick).toBe(0);
      expect(ps.reserved).toBeNull();
    }
    expect(attackStarts(drain())).toEqual(["attack_light_1", "attack_light_2", "attack_light_3", "attack_light_1"]);
  });

  it("각 타가 스태미나를 따로 쓰고, 이전 타의 공격 인스턴스는 끝난다", () => {
    hero.staminaRegenDelay = 10_000; // 회복으로 계산이 흐려지지 않게
    tick({ press: ["attack_light"] });
    const first = ps.attackInstance;
    advanceTo(TL.attack_light_1.cancel);
    tick({ press: ["attack_light"] }); // 캔슬 이후 입력은 즉시 실행
    expect(ps.action).toBe("attack_light_2");
    expect(world.combat.get(first ?? -1)).toBeUndefined();
    expect(hero.stamina).toBe(hero.maxStamina - ATTACKS.attack_light_1.staminaCost - ATTACKS.attack_light_2.staminaCost);
  });

  it("판정 구간에서만 공격이 활성화된다", () => {
    tick({ press: ["attack_light"] });
    const hit = TL.attack_light_1.hit;
    if (!hit || ps.attackInstance === null) throw new Error("setup");
    const id = ps.attackInstance;
    const activeAt: number[] = [];
    while (ps.action === "attack_light_1") {
      if (world.combat.get(id)?.active) activeAt.push(ps.stateTick);
      tick();
    }
    expect(activeAt[0]).toBe(hit.start);
    expect(activeAt[activeAt.length - 1]).toBe(hit.end - 1);
    expect(activeAt.length).toBe(hit.end - hit.start);
  });

  it("예약 없이 행동이 끝나면 idle로 돌아간다", () => {
    tick({ press: ["attack_light"] });
    idle(TL.attack_light_1.length);
    expect(ps.state).toBe("idle");
    expect(ps.action).toBeNull();
    expect(world.combat.active.length).toBe(0);
  });

  it("질주 중 약공격은 달리기 공격", () => {
    tick({ hold: ["sprint"], move: [0, 1] });
    expect(ps.state).toBe("sprint");
    tick({ hold: ["sprint"], move: [0, 1], press: ["attack_light"] });
    expect(ps.action).toBe("attack_run");
  });

  it("강공격은 슈퍼아머 구간 동안 SUPER_ARMOR 플래그를 켠다", () => {
    tick({ press: ["attack_heavy"] });
    const sa = TL.attack_heavy.superArmor;
    if (!sa) throw new Error("superArmor missing");
    advanceTo(sa.start);
    tick();
    expect(hasFlag(hero, FLAG.SUPER_ARMOR)).toBe(true);
    advanceTo(sa.end);
    tick();
    expect(hasFlag(hero, FLAG.SUPER_ARMOR)).toBe(false);
  });
});

describe("입력 버퍼 구간 밖 입력 무시", () => {
  it("버퍼 시작 전에 누른 약공격은 버려진다 (예약되지 않고, 캔슬 틱에도 이어지지 않음)", () => {
    const buf = TL.attack_light_1.buffer;
    if (!buf) throw new Error("buffer missing");
    tick({ press: ["attack_light"] });
    advanceTo(buf.start - 1);
    tick({ press: ["attack_light"] }); // 버퍼 시작 1틱 전
    expect(ps.stateTick).toBe(buf.start - 1);
    expect(ps.reserved).toBeNull();
    advanceTo(TL.attack_light_1.cancel);
    tick();
    expect(ps.action).toBe("attack_light_1");
    idle(TL.attack_light_1.length);
    expect(ps.state).toBe("idle");
    expect(attackStarts(drain())).toEqual(["attack_light_1"]);
  });

  it("버퍼 구간에서 여러 번 누르면 마지막 입력이 예약된다 (공격 → 구르기)", () => {
    const buf = TL.attack_light_1.buffer;
    if (!buf) throw new Error("buffer missing");
    tick({ press: ["attack_light"] });
    advanceTo(buf.start);
    tick({ press: ["attack_light"] });
    tick({ press: ["roll"], move: [1, 0] });
    expect(ps.reserved).toBe("roll");
    advanceTo(TL.attack_light_1.cancel);
    tick({ move: [1, 0] });
    expect(ps.state).toBe("roll");
  });

  it("버퍼가 없는 행동(회복약)은 도중 입력을 모두 무시하고 끝까지 마신다", () => {
    tick({ press: ["use_item"] });
    expect(ps.state).toBe("drink");
    for (let i = 0; i < 20; i++) tick({ press: ["attack_light", "roll"], move: [0, 1] });
    expect(ps.state).toBe("drink");
    expect(ps.reserved).toBeNull();
  });

  it("캔슬 윈도우 이후에는 이동 입력으로 후딜을 끊을 수 있다", () => {
    tick({ press: ["attack_light"] });
    advanceTo(TL.attack_light_1.cancel - 1);
    tick({ move: [0, 1] }); // 캔슬 전: 무시
    expect(ps.action).toBe("attack_light_1");
    tick({ move: [0, 1] }); // 캔슬 틱
    expect(ps.state).toBe("move");
  });
});

describe("구르기", () => {
  it("i-frame은 타임라인 구간 [start, end) 동안에만 켜진다", () => {
    const ifr = TL.roll.iframes;
    if (!ifr) throw new Error("iframes missing");
    tick({ press: ["roll"], move: [0, 1] });
    expect(ps.state).toBe("roll");
    const invulnAt: number[] = [];
    while (ps.state === "roll") {
      if (hasFlag(hero, FLAG.INVULNERABLE)) invulnAt.push(ps.stateTick);
      tick();
    }
    expect(invulnAt).toEqual(Array.from({ length: ifr.end - ifr.start }, (_, i) => ifr.start + i));
    expect(hasFlag(hero, FLAG.INVULNERABLE)).toBe(false);
  });

  it("i-frame 중에는 적 공격이 맞지 않고, 끝난 뒤에는 맞는다 (같은 틱 전투 판정에 반영)", () => {
    const ifr = TL.roll.iframes;
    if (!ifr) throw new Error("iframes missing");
    const hollow = world.spawn("hollow", "enemy", { x: 0, y: 0, z: 1.2 }, Math.PI);
    tick({ press: ["roll"], move: [0, 1] });
    advanceTo(ifr.start);
    const inst = world.combat.start(world, hollow, "hollow_slash");
    if (!inst) throw new Error("enemy attack failed");
    world.combat.setActive(inst.id, true);
    query.overlaps.set(hollow.id, [hero.id]);
    while (ps.stateTick < ifr.end - 1) {
      tick();
      expect(hero.health).toBe(hero.maxHealth);
    }
    tick(); // i-frame 끝난 첫 틱
    // 구르기 루트 모션으로 위치가 바뀌어 백어택 배율이 붙을 수 있으므로 "맞았는지"만 본다
    expect(hero.health).toBeLessThan(hero.maxHealth);
    expect(drain().some((e) => e.type === "hit" && e.payload.target === hero.id)).toBe(true);
  });

  it("이동 입력 방향(카메라 기준)으로 구른다", () => {
    // 카메라가 +X(yaw=π/2)를 보고 있을 때 스틱 왼쪽 = 월드 +Z
    tick({ press: ["roll"], move: [-1, 0], viewYaw: Math.PI / 2 });
    expect(ps.state).toBe("roll");
    expect(ps.actionYaw).toBeCloseTo(0, 6);
    expect(hero.yaw).toBeCloseTo(0, 6);
  });

  it("이동 입력이 없으면 백스텝: 바라보는 방향은 유지하고 뒤로 간다", () => {
    hero.yaw = 0.5;
    tick({ press: ["roll"] });
    expect(ps.state).toBe("backstep");
    expect(hero.yaw).toBe(0.5);
    expect(ps.actionYaw).toBeCloseTo(0.5 - Math.PI, 9);
    expect(hero.stamina).toBe(hero.maxStamina - STAMINA_ACTIONS.backstep.cost);
  });

  it("공격 버퍼에 예약된 구르기도 실행 시점의 이동 입력으로 방향이 정해진다", () => {
    tick({ press: ["attack_light"] });
    const buf = TL.attack_light_1.buffer;
    if (!buf) throw new Error("buffer missing");
    advanceTo(buf.start);
    tick({ press: ["roll"] }); // 예약 시점에는 입력 없음
    advanceTo(TL.attack_light_1.cancel);
    tick({ move: [1, 0] }); // 실행 시점에 오른쪽
    expect(ps.state).toBe("roll");
    expect(ps.actionYaw).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("타임라인 덮어쓰기 (TimelineLoader 결과 주입)", () => {
  it("주입한 타임라인이 기본값 대신 쓰이고, 없는 행동은 기본값을 쓴다", () => {
    const w = new SimWorld({ playerTimelines: { roll: { length: 20, iframes: { start: 0, end: 20 }, cancel: 20 } } });
    expect(w.players.timelines.roll.length).toBe(20);
    expect(w.players.timelines.backstep).toEqual(PLAYER_TIMELINES.backstep);
  });

  it("무적이 행동 끝까지 이어지는 타임라인이어도 행동이 끝나면 무적이 풀린다", () => {
    const w = new SimWorld({ playerTimelines: { roll: { length: 20, iframes: { start: 0, end: 20 }, cancel: 20 } } });
    const h = w.spawnPlayer({ x: 0, y: 0, z: 0 });
    const f = createInputFrame();
    f.pressed = BUTTON.roll;
    f.moveY = 1;
    w.players.setInput(h.id, f);
    w.step();
    expect(hasFlag(h, FLAG.INVULNERABLE)).toBe(true);
    for (let i = 0; i < 20; i++) w.step();
    expect(w.players.get(h.id)?.state).toBe("idle");
    expect(hasFlag(h, FLAG.INVULNERABLE)).toBe(false);
  });
});

describe("스태미나 부족 시 거부", () => {
  it("스태미나 0이면 공격/구르기/백스텝이 실행되지 않고 action_rejected를 낸다", () => {
    hero.stamina = 0;
    hero.staminaRegenDelay = 1000;
    tick({ press: ["attack_light"] });
    tick({ press: ["attack_heavy"] });
    tick({ press: ["roll"], move: [0, 1] });
    tick({ press: ["roll"] });
    expect(ps.state).not.toBe("attack");
    const evs = drain();
    expect(attackStarts(evs)).toEqual([]);
    expect(evs.flatMap((e) => (e.type === "action_rejected" ? [`${e.payload.action}:${e.payload.reason}`] : []))).toEqual([
      "attack_light_1:stamina",
      "attack_heavy:stamina",
      "roll:stamina",
      "backstep:stamina",
    ]);
  });

  it("거부되어도 이동은 계속된다", () => {
    hero.stamina = 0;
    hero.staminaRegenDelay = 1000;
    tick({ press: ["roll"], move: [0, 1] });
    expect(ps.state).toBe("move");
  });

  it("예약된 콤보도 실행 시점에 스태미나가 없으면 거부되고 현재 행동이 이어진다", () => {
    tick({ press: ["attack_light"] });
    const buf = TL.attack_light_1.buffer;
    if (!buf) throw new Error("buffer missing");
    advanceTo(buf.start);
    tick({ press: ["attack_light"] });
    hero.stamina = 0;
    hero.staminaRegenDelay = 1000;
    advanceTo(TL.attack_light_1.cancel);
    tick();
    expect(ps.action).toBe("attack_light_1");
    expect(ps.reserved).toBeNull();
    expect(drain().some((e) => e.type === "action_rejected")).toBe(true);
  });

  it("스태미나가 없으면 스프린트 대신 달리기", () => {
    hero.stamina = 0;
    hero.staminaRegenDelay = 1000;
    tick({ hold: ["sprint"], move: [0, 1] });
    expect(ps.state).toBe("move");
    expect(hasFlag(hero, FLAG.SPRINTING)).toBe(false);
  });

  it("회복약은 스태미나 0이어도 마실 수 있지만, 다 쓰면 no_flask로 거부", () => {
    hero.stamina = 0;
    hero.health = 10;
    ps.flasks = 1;
    tick({ press: ["use_item"] });
    expect(ps.state).toBe("drink");
    expect(ps.flasks).toBe(0);
    const effect = TL.drink.effect ?? 0;
    advanceTo(effect);
    tick();
    expect(hero.health).toBeCloseTo(10 + hero.maxHealth * PLAYER_ITEMS.flaskHealFraction, 9);
    idle(TL.drink.length);
    tick({ press: ["use_item"] });
    expect(ps.state).toBe("idle");
    expect(drain().some((e) => e.type === "action_rejected" && e.payload.reason === "no_flask")).toBe(true);
  });
});

describe("이동/가드/강제 전이", () => {
  it("이동 → move, 가드 유지 → guard(GUARDING), 놓으면 idle", () => {
    tick({ move: [0, 1] });
    expect(ps.state).toBe("move");
    expect(ps.moveZ).toBeGreaterThan(0);
    tick({ hold: ["guard"] });
    expect(ps.state).toBe("guard");
    expect(hasFlag(hero, FLAG.GUARDING)).toBe(true);
    tick();
    expect(ps.state).toBe("idle");
    expect(hasFlag(hero, FLAG.GUARDING)).toBe(false);
  });

  it("공격 도중 경직되면 stagger로 끊기고 예약/공격이 사라진다. 경직이 끝나면 idle", () => {
    tick({ press: ["attack_light"] });
    const buf = TL.attack_light_1.buffer;
    if (!buf) throw new Error("buffer missing");
    advanceTo(buf.start);
    tick({ press: ["attack_light"] });
    applyPoiseDamage(hero, 999, world);
    tick({ press: ["attack_light"] });
    expect(ps.state).toBe("stagger");
    expect(ps.reserved).toBeNull();
    expect(world.combat.active.length).toBe(0);
    // 경직 중 입력은 예약되지 않는다
    while (hero.staggerTicks > 1) {
      tick({ press: ["attack_light"] });
      expect(ps.state).toBe("stagger");
      expect(ps.reserved).toBeNull();
    }
    tick(); // 경직이 풀리는 틱 (스탯 → 플레이어 순서라 같은 틱에 자유 상태 처리)
    expect(hasFlag(hero, FLAG.STAGGERED)).toBe(false);
    expect(ps.state).toBe("idle");
  });

  it("사망하면 death로 가고 어떤 입력에도 움직이지 않는다", () => {
    kill(hero, null, world);
    tick({ press: ["attack_light", "roll"], move: [0, 1] });
    expect(ps.state).toBe("death");
    idle(10);
    expect(ps.state).toBe("death");
    expect(ps.moveZ).toBe(0);
  });
});

describe("결정성", () => {
  const script = (i: number): FrameOpts =>
    i % 37 === 0 ? { press: ["attack_light"] } : i % 53 === 0 ? { press: ["roll"], move: [1, 0] } : i % 70 < 20 ? { move: [0, 1], hold: ["sprint"] } : {};

  it("같은 입력열이면 같은 결과, 행동 도중 스냅샷에서 복원해도 같은 결과", () => {
    for (let i = 0; i < 150; i++) tick(script(i));
    expect(ps.state).not.toBe("idle"); // 행동 도중에 저장되는지 확인용 — 스크립트가 바뀌면 조정
    const copy = decodeWorld(encodeWorld(world), { hitQuery: query });
    drain();
    for (let i = 150; i < 600; i++) {
      const f = frame(script(i));
      world.players.setInput(hero.id, f);
      copy.players.setInput(hero.id, f);
      world.step();
      copy.step();
    }
    expect(encodeWorld(copy)).toBe(encodeWorld(world));
    expect(copy.drainEvents()).toEqual(world.drainEvents());
  });
});
