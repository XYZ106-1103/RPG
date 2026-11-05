import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { EventBus } from "../../src/core/eventBus";
import type { GameEventMap, HitEvent } from "../../src/sim/events";

const hit = (damage: number): HitEvent => ({
  attacker: 1,
  target: 2,
  attack: "attack_light_1",
  damage,
  point: { x: 0, y: 1, z: 0 },
  backAttack: false,
  hitstopFrames: 3,
  knockback: { x: 0, y: 0, z: 1.5 },
  staggered: false,
  killed: false,
});

describe("EventBus", () => {
  it("이벤트 이름에 맞는 페이로드를 핸들러에 전달한다 (타입 추론 포함)", () => {
    const bus = new EventBus<GameEventMap>();
    const received: number[] = [];
    bus.on("hit", (e) => {
      expectTypeOf(e).toEqualTypeOf<HitEvent>();
      received.push(e.damage);
    });
    bus.on("death", (e) => {
      expectTypeOf(e.killer).toEqualTypeOf<number | null>();
    });
    bus.emit("hit", hit(10));
    bus.emit("death", { entity: 2, killer: 1 });
    expect(received).toEqual([10]);
  });

  it("잘못된 이벤트 이름/페이로드는 컴파일 에러", () => {
    const bus = new EventBus<GameEventMap>();
    // @ts-expect-error 존재하지 않는 이벤트
    bus.emit("explode", {});
    // @ts-expect-error 페이로드 필드 누락
    bus.emit("death", { entity: 1 });
    // @ts-expect-error 다른 이벤트의 페이로드
    bus.emit("attack_start", hit(1));
    expect(true).toBe(true);
  });

  it("다른 이벤트의 핸들러는 호출되지 않는다", () => {
    const bus = new EventBus<GameEventMap>();
    const onDeath = vi.fn();
    bus.on("death", onDeath);
    bus.emit("hit", hit(1));
    expect(onDeath).not.toHaveBeenCalled();
  });

  it("구독 해제 함수와 off()", () => {
    const bus = new EventBus<GameEventMap>();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = bus.on("hit", a);
    bus.on("hit", b);
    unsubA();
    unsubA(); // 두 번 호출해도 안전
    bus.off("hit", b);
    bus.emit("hit", hit(1));
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(bus.listenerCount("hit")).toBe(0);
  });

  it("once 핸들러는 한 번만 호출된다", () => {
    const bus = new EventBus<GameEventMap>();
    const h = vi.fn();
    bus.once("hit", h);
    bus.emit("hit", hit(1));
    bus.emit("hit", hit(2));
    expect(h).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount("hit")).toBe(0);
  });

  it("전달 중 다른 핸들러를 해제해도 순회가 깨지지 않고, 해제된 핸들러는 호출되지 않는다", () => {
    const bus = new EventBus<GameEventMap>();
    const calls: string[] = [];
    const c = (): void => {
      calls.push("c");
    };
    bus.on("hit", () => {
      calls.push("a");
      bus.off("hit", c);
    });
    bus.on("hit", () => calls.push("b"));
    bus.on("hit", c);
    bus.emit("hit", hit(1));
    expect(calls).toEqual(["a", "b"]);
  });

  it("전달 중 추가된 핸들러는 다음 emit부터 호출된다", () => {
    const bus = new EventBus<GameEventMap>();
    const late = vi.fn();
    bus.on("hit", () => {
      if (bus.listenerCount("hit") === 1) bus.on("hit", late);
    });
    bus.emit("hit", hit(1));
    expect(late).not.toHaveBeenCalled();
    bus.emit("hit", hit(2));
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("핸들러 예외는 onError로 보고하고 나머지 핸들러는 계속 실행한다", () => {
    const onError = vi.fn();
    const bus = new EventBus<GameEventMap>({ onError });
    const after = vi.fn();
    const boom = new Error("boom");
    bus.on("hit", () => {
      throw boom;
    });
    bus.on("hit", after);
    bus.emit("hit", hit(1));
    expect(onError).toHaveBeenCalledWith(boom, "hit");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("enqueue한 이벤트는 flush 때 넣은 순서대로 한 번씩 전달된다 (여러 sim 스텝 → 한 렌더 프레임)", () => {
    const bus = new EventBus<GameEventMap>();
    const order: string[] = [];
    bus.on("attack_start", (e) => order.push(`attack:${e.attack}`));
    bus.on("hit", (e) => order.push(`hit:${e.damage}`));
    bus.on("death", (e) => order.push(`death:${e.entity}`));

    // 스텝 1
    bus.enqueue("attack_start", { attacker: 1, attack: "attack_light_1", instance: 1 });
    // 스텝 2
    bus.enqueue("hit", hit(30));
    bus.enqueue("death", { entity: 2, killer: 1 });
    expect(order).toEqual([]);
    expect(bus.queuedCount).toBe(3);

    bus.flush();
    expect(order).toEqual(["attack:attack_light_1", "hit:30", "death:2"]);
    expect(bus.queuedCount).toBe(0);
    bus.flush();
    expect(order.length).toBe(3);
  });

  it("flush 중 enqueue된 이벤트는 같은 flush에서 이어서 전달되고, 재진입 flush는 무시된다", () => {
    const bus = new EventBus<GameEventMap>();
    const deaths = vi.fn();
    bus.on("hit", (e) => {
      bus.enqueue("death", { entity: e.target, killer: e.attacker });
      bus.flush();
    });
    bus.on("death", deaths);
    bus.enqueue("hit", hit(99));
    bus.flush();
    expect(deaths).toHaveBeenCalledTimes(1);
    expect(bus.queuedCount).toBe(0);
  });

  it("핸들러가 예외를 던져도 큐는 비워지고 다음 flush에 영향이 없다", () => {
    const bus = new EventBus<GameEventMap>({ onError: () => {} });
    bus.on("hit", () => {
      throw new Error("x");
    });
    bus.enqueue("hit", hit(1));
    bus.flush();
    expect(bus.queuedCount).toBe(0);
  });

  it("clear는 리스너와 큐를 모두 비운다", () => {
    const bus = new EventBus<GameEventMap>();
    const h = vi.fn();
    bus.on("hit", h);
    bus.enqueue("hit", hit(1));
    bus.clear();
    bus.flush();
    bus.emit("hit", hit(2));
    expect(h).not.toHaveBeenCalled();
  });
});
