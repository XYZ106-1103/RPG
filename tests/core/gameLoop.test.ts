import { describe, expect, it } from "vitest";
import { GameLoop, type VisibilitySource } from "../../src/core/gameLoop";

const STEP_MS = 1000 / 60;

class FakeVisibility implements VisibilitySource {
  hidden = false;
  private listeners: (() => void)[] = [];
  addEventListener(_type: "visibilitychange", l: () => void): void {
    this.listeners.push(l);
  }
  removeEventListener(_type: "visibilitychange", l: () => void): void {
    this.listeners = this.listeners.filter((x) => x !== l);
  }
  set(hidden: boolean): void {
    this.hidden = hidden;
    for (const l of this.listeners) l();
  }
  get count(): number {
    return this.listeners.length;
  }
}

/** 등속 이동하는 1차원 상태: 스텝마다 1씩 증가. 렌더는 prev→cur를 alpha로 보간 */
function createHarness() {
  const state = { prev: 0, cur: 0 };
  const rendered: number[] = [];
  const alphas: number[] = [];
  let steps = 0;
  const loop = new GameLoop({
    fixedUpdate: () => {
      state.prev = state.cur;
      state.cur += 1;
      steps++;
    },
    render: (alpha) => {
      alphas.push(alpha);
      rendered.push(state.prev + (state.cur - state.prev) * alpha);
    },
  });
  return { loop, state, rendered, alphas, steps: () => steps };
}

describe("GameLoop", () => {
  it("첫 프레임은 경과 시간 0 — 스텝 없이 렌더만 한다", () => {
    const h = createHarness();
    h.loop.frame(123456);
    expect(h.steps()).toBe(0);
    expect(h.rendered).toEqual([0]);
  });

  it("프레임 간격에 따라 고정 스텝을 실행하고 매 프레임 한 번 렌더한다", () => {
    const h = createHarness();
    let t = 1000;
    h.loop.frame(t);
    for (let i = 0; i < 60; i++) h.loop.frame((t += STEP_MS));
    expect(h.steps()).toBe(60);
    expect(h.loop.tick).toBe(60);
    expect(h.rendered.length).toBe(61);
  });

  it("보간: 144Hz 렌더에서 화면 위치가 단조 증가하고 한 프레임에 1스텝 넘게 튀지 않는다", () => {
    const h = createHarness();
    let t = 0;
    h.loop.frame(t);
    for (let i = 0; i < 288; i++) h.loop.frame((t += 1000 / 144));
    for (let i = 1; i < h.rendered.length; i++) {
      const d = (h.rendered[i] ?? 0) - (h.rendered[i - 1] ?? 0);
      expect(d).toBeGreaterThanOrEqual(-1e-9);
      expect(d).toBeLessThanOrEqual(1 + 1e-9);
    }
    // 2초 = 120스텝, 보간된 위치는 마지막 스텝 직전 상태와 현재 상태 사이
    expect(h.steps()).toBe(120);
    const last = h.rendered[h.rendered.length - 1] ?? 0;
    expect(last).toBeGreaterThanOrEqual(119);
    expect(last).toBeLessThanOrEqual(120);
  });

  it("탭 비활성화 → 30초 후 복귀해도 시뮬레이션이 폭주하지 않는다", () => {
    const h = createHarness();
    const vis = new FakeVisibility();
    h.loop.bindVisibility(vis);
    let t = 0;
    h.loop.frame(t);
    h.loop.frame((t += STEP_MS));
    expect(h.steps()).toBe(1);

    vis.set(true);
    expect(h.loop.isSuspended).toBe(true);
    // 숨김 중 프레임이 와도(일부 브라우저의 저빈도 rAF) 스텝은 진행되지 않는다
    h.loop.frame((t += 1000));
    expect(h.steps()).toBe(1);

    t += 30_000;
    vis.set(false);
    h.loop.frame(t); // 복귀 첫 프레임: 경과 시간 0
    expect(h.steps()).toBe(1);
    h.loop.frame(t + STEP_MS);
    expect(h.steps()).toBe(2);
    expect(h.loop.stats.droppedSeconds).toBe(0);
  });

  it("이미 숨겨진 상태에서 바인딩하면 즉시 일시정지하고, 해제 함수로 리스너를 뗀다", () => {
    const h = createHarness();
    const vis = new FakeVisibility();
    vis.hidden = true;
    const unbind = h.loop.bindVisibility(vis);
    expect(h.loop.isSuspended).toBe(true);
    expect(vis.count).toBe(1);
    unbind();
    expect(vis.count).toBe(0);
  });

  it("일시정지 중에도 렌더는 계속되고 alpha는 그대로 유지된다 (화면이 뒤로 튀지 않음)", () => {
    const h = createHarness();
    let t = 0;
    h.loop.frame(t);
    h.loop.frame((t += STEP_MS * 1.5));
    const alphaBefore = h.alphas[h.alphas.length - 1] ?? -1;
    expect(alphaBefore).toBeCloseTo(0.5, 6);

    h.loop.suspend();
    h.loop.frame((t += 500));
    h.loop.frame((t += 500));
    expect(h.steps()).toBe(1);
    expect(h.alphas.slice(-2)).toEqual([alphaBefore, alphaBefore]);

    h.loop.resume();
    h.loop.frame(t + 10_000);
    expect(h.steps()).toBe(1);
    expect(h.alphas[h.alphas.length - 1]).toBeCloseTo(alphaBefore, 9);
  });

  it("긴 정지(디버거 등)는 maxFrameDelta로 잘려 스텝 한도까지만 실행된다", () => {
    const h = createHarness();
    h.loop.frame(0);
    h.loop.frame(5000);
    expect(h.steps()).toBe(5);
    expect(h.loop.stats.lastSteps).toBe(5);
    expect(h.loop.stats.droppedSeconds).toBeGreaterThan(4.9);
  });

  it("시계가 뒤로 가면 경과 시간 0으로 취급한다", () => {
    const h = createHarness();
    h.loop.frame(1000);
    h.loop.frame(500);
    expect(h.steps()).toBe(0);
  });

  it("resetTiming은 누적 시간을 버리고 다음 프레임을 0초로 시작한다", () => {
    const h = createHarness();
    h.loop.frame(0);
    h.loop.frame(STEP_MS * 1.9);
    h.loop.resetTiming();
    h.loop.frame(10_000);
    expect(h.steps()).toBe(1);
    expect(h.alphas[h.alphas.length - 1]).toBe(0);
  });
});
