import { describe, expect, it } from "vitest";
import { FLAG } from "../../src/sim/entity";
import { SNAPSHOT_VERSION, SnapshotError, decodeWorld, deserializeWorld, encodeWorld, serializeWorld } from "../../src/sim/serialize";
import { applyHit, setSprinting, tryPerform } from "../../src/sim/stats";
import type { SimWorld } from "../../src/sim/world";
import { SimWorld as World } from "../../src/sim/world";

/** 여러 상태가 섞인 월드: 진행 중 지연/경직/사망/스프린트, 소수점 스탯 */
function busyWorld(): SimWorld {
  const w = new World({ seed: 1234 });
  const p = w.spawn("player", "player", { x: 1.25, y: 0.5, z: -3.1 }, 0.7);
  const h = w.spawn("hollow", "enemy", { x: 4, y: 0, z: 2 }, Math.PI);
  const d = w.spawn("hound", "enemy", { x: -6, y: 0, z: 9 });
  w.spawn("ash_knight", "enemy", { x: 100, y: 3, z: 100 }, -1.2);
  tryPerform(p, "backstep");
  // 진행 중인 공격도 상태에 포함된다 (판정 활성 + 이미 맞은 대상)
  const playerAttack = w.combat.start(w, p, "attack_light_1");
  if (!playerAttack) throw new Error("attack failed");
  w.combat.setActive(playerAttack.id, true);
  playerAttack.hitList.add(3);
  playerAttack.hitList.add(2);
  const knight = w.get(4);
  if (knight) w.combat.start(w, knight, "ash_knight_slam");
  setSprinting(p, true);
  applyHit(h, 12.5, 30, p.id, w);
  applyHit(d, 999, 0, p.id, w);
  for (let i = 0; i < 17; i++) w.step();
  w.rng.next();
  return w;
}

/** 두 월드에 같은 "입력"을 주며 진행 (아직 입력 시스템이 sim에 연결되지 않아 직접 호출) */
function drive(w: SimWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    const t = w.tick;
    const p = w.get(1);
    if (p && t % 40 === 0) tryPerform(p, "roll");
    if (p && t % 90 === 5) setSprinting(p, !(p.flags & FLAG.SPRINTING));
    const h = w.get(2);
    if (h && t % 25 === 0) applyHit(h, w.rng.range(1, 6), w.rng.range(2, 9), 1, w);
    w.step();
  }
}

describe("sim 상태 직렬화", () => {
  it("JSON 왕복 후 상태가 비트 단위로 같다", () => {
    const w = busyWorld();
    const json = encodeWorld(w);
    const restored = decodeWorld(json);
    expect(serializeWorld(restored)).toEqual(serializeWorld(w));
    expect(encodeWorld(restored)).toBe(json);
  });

  it("복원한 월드를 같은 입력으로 진행하면 원본과 결과가 같다 (리플레이/멀티 결정성)", () => {
    const original = busyWorld();
    original.drainEvents(); // 이벤트는 상태가 아니므로 복사 전에 비워 두고 이후 발생분만 비교
    const copy = decodeWorld(encodeWorld(original));
    drive(original, 500);
    drive(copy, 500);
    expect(encodeWorld(copy)).toBe(encodeWorld(original));
    const events = original.drainEvents();
    expect(events.length).toBeGreaterThan(0); // 비교할 이벤트가 실제로 발생했는지
    expect(copy.drainEvents()).toEqual(events);
  });

  it("스냅샷은 깊은 복사본이다 (원본을 바꿔도 스냅샷이 변하지 않음)", () => {
    const w = busyWorld();
    const snap = serializeWorld(w);
    const p = w.get(1);
    if (!p) throw new Error("player missing");
    p.position.x = 999;
    p.health = 1;
    expect(snap.entities[0]?.position.x).toBe(1.25);
    expect(snap.entities[0]?.health).toBe(p.maxHealth);
  });

  it("난수 상태와 다음 id가 보존된다", () => {
    const w = busyWorld();
    const r = decodeWorld(encodeWorld(w));
    expect(r.rng.next()).toBe(w.rng.next());
    expect(r.spawn("hollow", "enemy", { x: 0, y: 0, z: 0 }).id).toBe(w.spawn("hollow", "enemy", { x: 0, y: 0, z: 0 }).id);
  });

  it("엔티티 순서가 섞인 스냅샷도 id 오름차순으로 복원한다", () => {
    const snap = serializeWorld(busyWorld());
    snap.entities.reverse();
    expect(deserializeWorld(snap).entities.map((e) => e.id)).toEqual([1, 2, 3, 4]);
  });

  it("대기 중 이벤트는 상태에 포함하지 않는다", () => {
    const w = busyWorld();
    expect(w.pendingEventCount).toBeGreaterThan(0);
    expect(decodeWorld(encodeWorld(w)).pendingEventCount).toBe(0);
  });
});

describe("sim 상태 역직렬화 검증", () => {
  const bad = (mutate: (s: Record<string, unknown> & { entities: Record<string, unknown>[] }) => void): unknown => {
    const s = JSON.parse(encodeWorld(busyWorld())) as Record<string, unknown> & { entities: Record<string, unknown>[] };
    mutate(s);
    return s;
  };

  type TopMutation = ((s: Record<string, unknown>) => void) | null;
  const topCases: [string, TopMutation, string][] = [
    ["버전 불일치", (s) => void (s.version = SNAPSHOT_VERSION + 1), "$.version"],
    ["객체 아님", null, "$"],
    ["entities 배열 아님", (s) => void (s.entities = {}), "$.entities"],
    ["음수 tick", (s) => void (s.tick = -1), "$.tick"],
  ];
  it.each(topCases)("%s → SnapshotError", (_name, mutate, path) => {
    const data = mutate === null ? 42 : bad(mutate);
    expect(() => deserializeWorld(data)).toThrowError(SnapshotError);
    try {
      deserializeWorld(data);
    } catch (err) {
      expect((err as SnapshotError).path).toBe(path);
    }
  });

  it("엔티티 필드 오류는 경로와 함께 거부한다", () => {
    const cases: [(e: Record<string, unknown>) => void, string][] = [
      [(e) => void (e.archetype = "dragon"), "$.entities[0].archetype"],
      [(e) => void (e.team = "pirates"), "$.entities[0].team"],
      [(e) => void (e.health = null), "$.entities[0].health"], // NaN은 JSON에서 null이 된다
      [(e) => void (e.health = 9999), "$.entities[0].health"],
      [(e) => void (e.flags = 1 << 20), "$.entities[0].flags"],
      [(e) => void (e.staggerTicks = 1.5), "$.entities[0].staggerTicks"],
      [(e) => void (e.position = { x: 0, y: "1", z: 0 }), "$.entities[0].position.y"],
    ];
    for (const [mutate, path] of cases) {
      const data = bad((s) => {
        const first = s.entities[0];
        if (first) mutate(first);
      });
      expect(() => deserializeWorld(data), path).toThrowError(expect.objectContaining({ path }));
    }
  });

  it("중복 id와 nextId 이상의 id를 거부한다", () => {
    expect(() =>
      deserializeWorld(
        bad((s) => {
          const second = s.entities[1];
          if (second) second.id = 1;
        }),
      ),
    ).toThrowError(/중복 id/);
    expect(() => deserializeWorld(bad((s) => void (s.nextId = 2)))).toThrowError(/nextId/);
  });

  it("깨진 JSON은 SnapshotError", () => {
    expect(() => decodeWorld("{not json")).toThrowError(SnapshotError);
  });
});
