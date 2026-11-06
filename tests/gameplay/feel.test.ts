import { describe, expect, it } from "vitest";
import { HitstopTimer } from "../../src/gameplay/feel/hitstop";
import { SparkSim } from "../../src/gameplay/feel/sparkSim";

describe("히트스톱 타이머 (렌더 로컬)", () => {
  it("정지 동안 0, 정지 뒤 따라잡기 동안 0→1, 끝나면 1", () => {
    const t = new HitstopTimer();
    expect(t.advance(1 / 60)).toBe(1);
    t.freeze(3 / 60, 0.06);
    expect(t.consumeJustFroze()).toBe(true);
    expect(t.consumeJustFroze()).toBe(false);
    expect(t.advance(1 / 60)).toBe(0);
    expect(t.advance(1 / 60)).toBe(0);
    expect(t.isFrozen).toBe(true);
    const w1 = t.advance(1 / 60); // 정지 끝 (경계)
    expect(t.isFrozen).toBe(false);
    const w2 = t.advance(1 / 60);
    expect(w1).toBeGreaterThanOrEqual(0);
    expect(w2).toBeGreaterThan(w1);
    expect(w2).toBeLessThan(1);
    // 따라잡기 0.06초 = 3.6프레임 → 정지 끝 이후 4번째 프레임에 1
    expect(t.advance(1 / 60)).toBeLessThan(1);
    expect(t.advance(1 / 60)).toBeLessThan(1);
    expect(t.advance(1 / 60)).toBe(1);
  });

  it("프레임 독립: 30fps와 120fps에서 같은 시점의 따라잡기 비율이 같다", () => {
    const a = new HitstopTimer();
    const b = new HitstopTimer();
    a.freeze(0.05, 0.1);
    b.freeze(0.05, 0.1);
    let wa = 0;
    let wb = 0;
    for (let i = 0; i < 3; i++) wa = a.advance(1 / 30); // 0.1초
    for (let i = 0; i < 12; i++) wb = b.advance(1 / 120); // 0.1초
    expect(wa).toBeCloseTo(0.5, 6);
    expect(wb).toBeCloseTo(0.5, 6);
  });

  it("정지 중에 또 맞으면 남은 시간과 새 시간 중 긴 쪽", () => {
    const t = new HitstopTimer();
    t.freeze(4 / 60, 0);
    t.advance(1 / 60);
    t.freeze(1 / 60, 0); // 더 짧음 — 무시
    expect(t.advance(2 / 60)).toBe(0);
    expect(t.advance(1 / 60)).toBe(1);
  });

  it("0초 정지는 무시", () => {
    const t = new HitstopTimer();
    t.freeze(0, 0.1);
    expect(t.isFrozen).toBe(false);
    expect(t.advance(1 / 60)).toBe(1);
  });
});

describe("스파크 시뮬레이션", () => {
  const params = { count: 10, speed: 5, spread: 0.5, life: 0.3 };

  it("터뜨린 만큼 살아 있고, 수명이 지나면 사라진다", () => {
    const s = new SparkSim(64);
    s.burst(0, 1, 0, 1, 0, 0, params);
    expect(s.alive).toBe(10);
    s.update(0.05, 9.8);
    expect(s.alive).toBe(10);
    for (let i = 0; i < 30; i++) s.update(0.05, 9.8);
    expect(s.alive).toBe(0);
  });

  it("터진 방향으로 날아가고 중력으로 떨어진다", () => {
    const s = new SparkSim(16);
    s.burst(0, 1, 0, 1, 0, 0, { ...params, count: 16, spread: 0 });
    s.update(0.05, 20);
    let sumX = 0;
    let sumVy = 0;
    for (let i = 0; i < 16; i++) {
      sumX += s.data[i * 8] ?? 0;
      sumVy += s.data[i * 8 + 4] ?? 0;
    }
    expect(sumX / 16).toBeGreaterThan(0.1);
    expect(sumVy / 16).toBeLessThan(0.3 * 5); // 중력으로 위쪽 속도가 줄어듦
  });

  it("용량을 넘으면 오래된 것부터 덮어쓴다 (풀 크기 고정)", () => {
    const s = new SparkSim(8);
    s.burst(0, 0, 0, 1, 0, 0, { ...params, count: 20 });
    expect(s.alive).toBe(8);
    expect(s.data.length).toBe(8 * 8);
  });

  it("같은 시드는 같은 결과 (결정적 난수)", () => {
    const a = new SparkSim(8, 3);
    const b = new SparkSim(8, 3);
    a.burst(0, 0, 0, 0, 0, 1, params);
    b.burst(0, 0, 0, 0, 0, 1, params);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});
