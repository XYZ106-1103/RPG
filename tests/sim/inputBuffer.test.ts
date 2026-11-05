import { describe, expect, it } from "vitest";
import { DEFAULT_BUFFER_TICKS, InputBuffer } from "../../src/sim/inputBuffer";
import { BUTTON, createInputFrame } from "../../src/sim/inputFrame";

function press(buf: InputBuffer, tick: number, mask: number): void {
  const f = createInputFrame();
  f.tick = tick;
  f.pressed = mask;
  buf.record(f);
}

describe("InputBuffer", () => {
  it("눌림을 N틱 동안 보관하고, 경계(N틱째)까지 소비할 수 있다", () => {
    const buf = new InputBuffer(10);
    press(buf, 100, BUTTON.attack_light);
    expect(buf.has("attack_light", 100)).toBe(true);
    expect(buf.has("attack_light", 110)).toBe(true);
    expect(buf.has("attack_light", 111)).toBe(false);
    expect(buf.consume("attack_light", 111)).toBe(false);
  });

  it("같은 눌림은 한 번만 소비된다", () => {
    const buf = new InputBuffer();
    press(buf, 5, BUTTON.roll);
    expect(buf.consume("roll", 8)).toBe(true);
    expect(buf.consume("roll", 8)).toBe(false);
    expect(buf.has("roll", 9)).toBe(false);
  });

  it("후딜 중 미리 누른 공격이 캔슬 시점에 실행된다 (콤보 버퍼 시나리오)", () => {
    const buf = new InputBuffer(12);
    const CANCEL_TICK = 40;
    press(buf, 32, BUTTON.attack_light); // 캔슬 8틱 전에 입력
    let executedAt = -1;
    for (let tick = 32; tick <= 60; tick++) {
      if (tick >= CANCEL_TICK && buf.consume("attack_light", tick)) {
        executedAt = tick;
        break;
      }
    }
    expect(executedAt).toBe(CANCEL_TICK);
  });

  it("너무 일찍 누른 입력은 만료된다 (의도치 않은 연타 방지)", () => {
    const buf = new InputBuffer(12);
    press(buf, 10, BUTTON.attack_light);
    expect(buf.consume("attack_light", 40)).toBe(false);
  });

  it("다시 누르면 보관 시각이 갱신된다", () => {
    const buf = new InputBuffer(5);
    press(buf, 0, BUTTON.attack_heavy);
    press(buf, 4, BUTTON.attack_heavy);
    expect(buf.has("attack_heavy", 9)).toBe(true);
    expect(buf.age("attack_heavy", 9)).toBe(5);
  });

  it("한 프레임에 여러 버튼이 눌리면 각각 기록된다", () => {
    const buf = new InputBuffer();
    press(buf, 1, BUTTON.attack_light | BUTTON.lock_on | BUTTON.sprint);
    expect(buf.has("attack_light", 1)).toBe(true);
    expect(buf.has("lock_on", 1)).toBe(true);
    expect(buf.has("sprint", 1)).toBe(true);
    expect(buf.has("roll", 1)).toBe(false);
  });

  it("액션별 보관 시간을 다르게 줄 수 있다", () => {
    const buf = new InputBuffer(12, { roll: 4 });
    press(buf, 0, BUTTON.roll | BUTTON.attack_light);
    expect(buf.has("roll", 5)).toBe(false);
    expect(buf.has("attack_light", 5)).toBe(true);
  });

  it("consumeLatest는 후보 중 가장 최근 눌림을 고르고 그것만 소비한다", () => {
    const buf = new InputBuffer();
    press(buf, 10, BUTTON.attack_light);
    press(buf, 13, BUTTON.roll);
    expect(buf.consumeLatest(["attack_light", "roll"], 15)).toBe("roll");
    expect(buf.has("attack_light", 15)).toBe(true);
    expect(buf.consumeLatest(["attack_light", "roll"], 15)).toBe("attack_light");
    expect(buf.consumeLatest(["attack_light", "roll"], 15)).toBeNull();
  });

  it("consumeLatest: 같은 틱이면 후보 목록 앞쪽이 우선", () => {
    const buf = new InputBuffer();
    press(buf, 3, BUTTON.attack_light | BUTTON.roll);
    expect(buf.consumeLatest(["roll", "attack_light"], 3)).toBe("roll");
  });

  it("clear는 지정 액션 또는 전체를 비운다 (피격으로 행동이 끊길 때)", () => {
    const buf = new InputBuffer();
    press(buf, 0, BUTTON.attack_light | BUTTON.roll);
    buf.clear("roll");
    expect(buf.has("roll", 0)).toBe(false);
    expect(buf.has("attack_light", 0)).toBe(true);
    buf.clear();
    expect(buf.has("attack_light", 0)).toBe(false);
  });

  it("미래 틱의 눌림은 과거 시점에서 보이지 않는다", () => {
    const buf = new InputBuffer();
    press(buf, 50, BUTTON.interact);
    expect(buf.has("interact", 49)).toBe(false);
  });

  it("보관 0틱이면 같은 틱에만 소비 가능", () => {
    const buf = new InputBuffer(0);
    press(buf, 7, BUTTON.use_item);
    expect(buf.has("use_item", 8)).toBe(false);
    expect(buf.consume("use_item", 7)).toBe(true);
  });

  it("기본 보관 시간은 60Hz에서 약 0.2초", () => {
    expect(DEFAULT_BUFFER_TICKS).toBe(12);
  });

  it("잘못된 보관 시간은 거부한다", () => {
    expect(() => new InputBuffer(-1)).toThrow(RangeError);
    expect(() => new InputBuffer(1.5)).toThrow(RangeError);
    expect(() => new InputBuffer(10, { roll: -2 })).toThrow(RangeError);
  });
});
