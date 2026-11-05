import { describe, expect, it } from "vitest";
import { FixedStepAccumulator } from "../../src/core/fixedStep";

const STEP = 1 / 60;

function run(acc: FixedStepAccumulator, frames: number, frameSeconds: number): number {
  let steps = 0;
  for (let i = 0; i < frames; i++) steps += acc.advance(frameSeconds, () => {}).steps;
  return steps;
}

describe("FixedStepAccumulator", () => {
  it("60Hz 프레임마다 정확히 1스텝 — 부동소수 오차로 스텝을 건너뛰지 않는다", () => {
    const acc = new FixedStepAccumulator();
    for (let i = 0; i < 600; i++) {
      expect(acc.advance(STEP, () => {}).steps).toBe(1);
    }
    expect(acc.tick).toBe(600);
  });

  it("고정 dt와 증가하는 tick을 step 콜백에 넘긴다", () => {
    const acc = new FixedStepAccumulator();
    const calls: [number, number][] = [];
    acc.advance(STEP * 3, (dt, tick) => calls.push([dt, tick]));
    expect(calls).toEqual([
      [STEP, 1],
      [STEP, 2],
      [STEP, 3],
    ]);
  });

  it("144Hz 디스플레이: 1초 동안 60스텝, alpha는 항상 [0, 1)", () => {
    const acc = new FixedStepAccumulator();
    let steps = 0;
    for (let i = 0; i < 144; i++) {
      const r = acc.advance(1 / 144, () => {});
      steps += r.steps;
      expect(r.alpha).toBeGreaterThanOrEqual(0);
      expect(r.alpha).toBeLessThan(1);
    }
    expect(steps).toBe(60);
  });

  it("30Hz 프레임에서는 프레임당 2스텝", () => {
    const acc = new FixedStepAccumulator();
    for (let i = 0; i < 30; i++) expect(acc.advance(1 / 30, () => {}).steps).toBe(2);
  });

  it("alpha는 남은 시간의 스텝 대비 비율", () => {
    const acc = new FixedStepAccumulator();
    const r = acc.advance(STEP * 1.5, () => {});
    expect(r.steps).toBe(1);
    expect(r.alpha).toBeCloseTo(0.5, 9);
    expect(acc.advance(STEP * 0.25, () => {}).alpha).toBeCloseTo(0.75, 9);
  });

  it("긴 프레임은 maxFrameDelta로 자르고 maxStepsPerFrame까지만 실행한다", () => {
    const acc = new FixedStepAccumulator({ maxStepsPerFrame: 5, maxFrameDelta: 0.25 });
    const r = acc.advance(10, () => {});
    expect(r.steps).toBe(5);
    // 10초 중 0.25초만 받아들이고, 그중 5스텝을 뺀 나머지 정수 스텝도 버린다
    expect(r.droppedSeconds).toBeCloseTo(10 - 5 * STEP - (0.25 % STEP), 6);
    expect(r.alpha).toBeCloseTo((0.25 % STEP) / STEP, 6);
  });

  it("스텝 한도가 넉넉해도 maxFrameDelta를 넘는 시간은 시뮬레이션하지 않는다", () => {
    const acc = new FixedStepAccumulator({ maxStepsPerFrame: 1000, maxFrameDelta: 0.25 });
    const r = acc.advance(10, () => {});
    expect(r.steps).toBe(15); // 0.25초 = 15스텝
    expect(r.droppedSeconds).toBeCloseTo(9.75, 9);
  });

  it("스파이럴 오브 데스 방지: 매 프레임 스텝 한도를 넘어도 백로그가 쌓이지 않는다", () => {
    const acc = new FixedStepAccumulator({ maxStepsPerFrame: 4 });
    // 시뮬레이션이 무거워 프레임이 100ms씩 걸리는 상황 (6스텝 분량 > 한도 4)
    for (let i = 0; i < 100; i++) {
      const r = acc.advance(0.1, () => {});
      expect(r.steps).toBe(4);
      expect(r.alpha).toBeLessThan(1);
    }
    // 부하가 사라지면 즉시 정상 속도로 돌아온다 (밀린 스텝을 몰아서 실행하지 않음)
    expect(acc.advance(STEP, () => {}).steps).toBe(1);
  });

  it("0, 음수, NaN, Infinity 경과 시간은 스텝을 만들지 않는다", () => {
    const acc = new FixedStepAccumulator();
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(acc.advance(dt, () => {}).steps).toBe(0);
    }
    expect(acc.tick).toBe(0);
  });

  it("resetAccumulator는 누적 시간만 버리고 tick은 유지한다", () => {
    const acc = new FixedStepAccumulator();
    acc.advance(STEP * 2.5, () => {});
    acc.resetAccumulator();
    expect(acc.alpha).toBe(0);
    expect(acc.tick).toBe(2);
    expect(acc.advance(STEP * 0.9, () => {}).steps).toBe(0);
  });

  it("잘못된 옵션은 거부한다", () => {
    expect(() => new FixedStepAccumulator({ stepSeconds: 0 })).toThrow(RangeError);
    expect(() => new FixedStepAccumulator({ maxStepsPerFrame: 0 })).toThrow(RangeError);
    expect(() => new FixedStepAccumulator({ maxStepsPerFrame: 1.5 })).toThrow(RangeError);
    expect(() => new FixedStepAccumulator({ maxFrameDelta: -1 })).toThrow(RangeError);
  });

  it("다른 고정 주기(30Hz)도 지원한다", () => {
    const acc = new FixedStepAccumulator({ stepSeconds: 1 / 30 });
    expect(run(acc, 60, 1 / 60)).toBe(30);
  });
});
