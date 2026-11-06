import { describe, expect, it } from "vitest";
import {
  BUTTON,
  BUTTON_ACTIONS,
  INPUT_FRAME_BYTES,
  copyInputFrame,
  createInputFrame,
  decodeInputFrame,
  encodeInputFrame,
  isHeld,
  quantizeInputFrame,
  wasPressed,
  wasReleased,
  type InputFrame,
} from "../../src/sim/inputFrame";

function frame(p: Partial<InputFrame>): InputFrame {
  return { ...createInputFrame(), ...p };
}

describe("InputFrame", () => {
  it("버튼 액션은 16개 이하이며 비트가 겹치지 않는다 (u16 직렬화)", () => {
    const bits = BUTTON_ACTIONS.map((a) => BUTTON[a]);
    expect(bits.length).toBeLessThanOrEqual(16);
    expect(new Set(bits).size).toBe(bits.length);
    for (const b of bits) expect(b & (b - 1)).toBe(0);
    expect(bits.reduce((a, b) => a | b, 0)).toBeLessThan(1 << 16);
  });

  it("held/pressed/released 헬퍼", () => {
    const f = frame({ held: BUTTON.guard, pressed: BUTTON.roll, released: BUTTON.sprint });
    expect(isHeld(f, "guard")).toBe(true);
    expect(isHeld(f, "roll")).toBe(false);
    expect(wasPressed(f, "roll")).toBe(true);
    expect(wasReleased(f, "sprint")).toBe(true);
  });

  it("락온 대상 id는 u32로 그대로 왕복한다 (0 = 없음)", () => {
    const view = new DataView(new ArrayBuffer(INPUT_FRAME_BYTES));
    encodeInputFrame(frame({ lockTarget: 123456789 }), view);
    expect(decodeInputFrame(view).lockTarget).toBe(123456789);
    encodeInputFrame(frame({ lockTarget: Number.NaN }), view);
    expect(decodeInputFrame(view).lockTarget).toBe(0);
    expect(quantizeInputFrame(frame({ lockTarget: -1 })).lockTarget).toBe(0xffffffff);
  });

  it("인코딩은 고정 18바이트이고 디코딩하면 양자화된 값과 정확히 같다", () => {
    const src = frame({
      tick: 123456,
      moveX: 0.7071,
      moveY: -0.3333,
      viewYaw: -1.234,
      held: BUTTON.guard | BUTTON.sprint,
      pressed: BUTTON.attack_light,
      released: BUTTON.roll,
      lockTarget: 42,
    });
    const view = new DataView(new ArrayBuffer(INPUT_FRAME_BYTES * 2));
    expect(encodeInputFrame(src, view, INPUT_FRAME_BYTES)).toBe(INPUT_FRAME_BYTES * 2);
    const decoded = decodeInputFrame(view, INPUT_FRAME_BYTES);
    const expected = quantizeInputFrame(copyInputFrame(createInputFrame(), src));
    expect(decoded).toEqual(expected);
    expect(decoded.held).toBe(src.held);
    expect(decoded.moveX).toBeCloseTo(0.7071, 2);
    // yaw는 [0, 2π)로 감싸진다
    expect(decoded.viewYaw).toBeCloseTo(Math.PI * 2 - 1.234, 3);
  });

  it("양자화는 멱등이다 (클라이언트 예측 값 = 서버 수신 값)", () => {
    const f = quantizeInputFrame(frame({ moveX: 0.123456, moveY: 0.98765, viewYaw: 2.5 }));
    const again = quantizeInputFrame(copyInputFrame(createInputFrame(), f));
    expect(again).toEqual(f);
    const view = new DataView(new ArrayBuffer(INPUT_FRAME_BYTES));
    encodeInputFrame(f, view);
    expect(decodeInputFrame(view)).toEqual(f);
  });

  it("범위 밖/비정상 값은 안전하게 잘린다", () => {
    const f = quantizeInputFrame(frame({ moveX: 5, moveY: Number.NaN, viewYaw: Number.POSITIVE_INFINITY }));
    expect(f.moveX).toBe(1);
    expect(f.moveY).toBe(0);
    expect(f.viewYaw).toBe(0);
    expect(quantizeInputFrame(frame({ moveX: -3 })).moveX).toBe(-1);
  });

  it("yaw가 2π 근처면 0으로 감싼다", () => {
    const f = quantizeInputFrame(frame({ viewYaw: Math.PI * 2 - 1e-7 }));
    expect(f.viewYaw).toBe(0);
  });
});
