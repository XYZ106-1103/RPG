import { describe, expect, it } from "vitest";
import { damp, dampAngle } from "../../src/gameplay/camera/damping";
import { Perlin1D } from "../../src/gameplay/camera/noise";
import { CameraShake, type ShakeOffset } from "../../src/gameplay/camera/shake";
import { SpringArmLength } from "../../src/gameplay/camera/springArm";

function run(fps: number, seconds: number, step: (dt: number) => void): void {
  const n = Math.round(fps * seconds);
  for (let i = 0; i < n; i++) step(1 / fps);
}

describe("프레임 독립 감쇠", () => {
  it("30fps와 144fps로 같은 시간 진행하면 같은 값", () => {
    let a = 0;
    let b = 0;
    run(30, 1, (dt) => (a = damp(a, 10, 5, dt)));
    run(144, 1, (dt) => (b = damp(b, 10, 5, dt)));
    expect(a).toBeCloseTo(b, 9);
    expect(a).toBeCloseTo(10 - 10 * Math.exp(-5), 9);
  });

  it("각도는 최단 방향으로 돈다", () => {
    const r = dampAngle(Math.PI - 0.1, -Math.PI + 0.1, 1000, 1);
    expect(Math.cos(r)).toBeCloseTo(Math.cos(-Math.PI + 0.1), 6);
    expect(r).toBeGreaterThan(Math.PI - 0.1); // 반대쪽으로 한 바퀴 돌지 않음
  });

  it("dt 0이면 그대로, λ 0이면 즉시 목표", () => {
    expect(damp(3, 10, 5, 0)).toBe(3);
    expect(damp(3, 10, 0, 0.1)).toBe(10);
  });
});

describe("펄린 노이즈", () => {
  it("같은 시드는 같은 값, 다른 시드는 다른 값", () => {
    const a = new Perlin1D(1);
    const b = new Perlin1D(1);
    const c = new Perlin1D(2);
    expect(a.sample(3.7)).toBe(b.sample(3.7));
    expect(a.sample(3.7)).not.toBe(c.sample(3.7));
  });

  it("[-1, 1] 범위, 격자점에서 0, 연속적", () => {
    const p = new Perlin1D(5);
    let maxStep = 0;
    let prev = p.sample(0);
    for (let x = 0; x < 50; x += 0.01) {
      const v = p.sample(x);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      maxStep = Math.max(maxStep, Math.abs(v - prev));
      prev = v;
    }
    expect(Math.abs(p.sample(4))).toBeLessThan(1e-12);
    expect(maxStep).toBeLessThan(0.1);
  });
});

describe("카메라 셰이크", () => {
  const off = (): ShakeOffset => ({ yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 });

  it("지속 시간 동안 흔들리고, 끝나면 0으로 돌아가며 제거된다", () => {
    const s = new CameraShake({ maxAngle: 0.1, maxOffset: 0.1 });
    s.add({ amplitude: 1, duration: 0.3 });
    let peak = 0;
    run(60, 0.25, (dt) => {
      s.update(dt);
      const o = s.sample(off());
      peak = Math.max(peak, Math.abs(o.yaw), Math.abs(o.pitch));
    });
    expect(peak).toBeGreaterThan(0.01);
    expect(peak).toBeLessThanOrEqual(0.1);
    run(60, 0.1, (dt) => s.update(dt));
    expect(s.activeCount).toBe(0);
    expect(s.sample(off())).toEqual(off());
  });

  it("감쇠: linear는 중간에 절반, exponential은 더 빨리 줄고, none은 유지", () => {
    const at = (decay: "linear" | "exponential" | "none") => {
      const s = new CameraShake();
      s.add({ amplitude: 1, duration: 1, decay });
      s.update(0.5);
      return s.intensity();
    };
    expect(at("linear")).toBeCloseTo(0.5, 9);
    expect(at("exponential")).toBeLessThan(0.5);
    expect(at("none")).toBe(1);
  });

  it("여러 셰이크는 더해지고, 최대 개수를 넘으면 오래된 것부터 버린다", () => {
    const s = new CameraShake({ maxActive: 3 });
    s.add({ amplitude: 0.3, duration: 1, decay: "none" });
    s.add({ amplitude: 0.3, duration: 1, decay: "none" });
    expect(s.intensity()).toBeCloseTo(0.6, 9);
    for (let i = 0; i < 5; i++) s.add({ amplitude: 0.1, duration: 1, decay: "none" });
    expect(s.activeCount).toBe(3);
    expect(s.intensity()).toBeCloseTo(0.3, 9);
  });

  it("강도/지속 시간이 0 이하면 무시한다", () => {
    const s = new CameraShake();
    s.add({ amplitude: 0, duration: 1 });
    s.add({ amplitude: 1, duration: 0 });
    expect(s.activeCount).toBe(0);
  });
});

describe("스프링 암 길이", () => {
  it("벽에 막히면 즉시 당긴다", () => {
    const a = new SpringArmLength(4);
    expect(a.update(4, 1.5, 1 / 60)).toBe(1.5);
  });

  it("막힘이 풀리면 천천히 복귀한다 (프레임 독립)", () => {
    const a = new SpringArmLength(4, 2.5);
    const b = new SpringArmLength(4, 2.5);
    a.update(4, 1, 1 / 60);
    b.update(4, 1, 1 / 60);
    run(30, 1 / 6, (dt) => a.update(4, null, dt)); // 1/6초: 30fps 5프레임, 144fps 24프레임
    run(144, 1 / 6, (dt) => b.update(4, null, dt));
    expect(a.length).toBeCloseTo(b.length, 9);
    expect(a.length).toBeLessThan(2.5); // 1/6초 만에는 다 늘어나지 않음
    run(60, 4, (dt) => a.update(4, null, dt));
    expect(a.length).toBeCloseTo(4, 2);
  });

  it("복귀 도중 다시 막히면 그 길이로 즉시 줄어든다", () => {
    const a = new SpringArmLength(4);
    a.update(4, 1, 1 / 60);
    run(60, 0.5, (dt) => a.update(4, null, dt));
    const mid = a.length;
    expect(a.update(4, mid - 0.5, 1 / 60)).toBeCloseTo(mid - 0.5, 9);
  });
});
