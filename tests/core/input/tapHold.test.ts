import { describe, expect, it } from "vitest";
import { TapHoldResolver } from "../../../src/core/input/tapHold";

describe("TapHoldResolver", () => {
  it("짧게 눌렀다 떼면 tap", () => {
    const r = new TapHoldResolver(280);
    r.down(0);
    expect(r.update(100)).toBe(false);
    expect(r.up(200)).toBe("tap");
  });

  it("홀드 시간을 넘기면 홀드 시작을 한 번 알리고, 뗄 때 hold_end", () => {
    const r = new TapHoldResolver(280);
    r.down(0);
    expect(r.update(279)).toBe(false);
    expect(r.update(280)).toBe(true);
    expect(r.isHolding).toBe(true);
    expect(r.update(500)).toBe(false);
    expect(r.up(900)).toBe("hold_end");
    expect(r.isHolding).toBe(false);
  });

  it("update 없이 오래 누르다 떼도 hold_end (프레임이 끊긴 경우)", () => {
    const r = new TapHoldResolver(280);
    r.down(0);
    expect(r.up(1000)).toBe("hold_end");
  });

  it("키 반복(auto-repeat)으로 down이 다시 와도 시작 시각을 바꾸지 않는다", () => {
    const r = new TapHoldResolver(280);
    r.down(0);
    r.down(250);
    expect(r.update(300)).toBe(true);
  });

  it("누르지 않은 상태의 up은 none, cancel은 결과 없이 초기화", () => {
    const r = new TapHoldResolver(280);
    expect(r.up(10)).toBe("none");
    r.down(0);
    r.cancel();
    expect(r.isDown).toBe(false);
    expect(r.up(50)).toBe("none");
  });
});
