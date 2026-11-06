import { describe, expect, it } from "vitest";
import { LockOnController, type LockCandidate } from "../../src/gameplay/camera/lockOn";

const c = (id: number, screenX: number, distance: number, o: Partial<LockCandidate> = {}): LockCandidate => ({
  id,
  screenX,
  screenY: 0,
  inFront: true,
  distance,
  visible: true,
  ...o,
});

function frames(lock: LockOnController, n: number, cands: LockCandidate[], lookX = 0, dt = 1 / 60): void {
  for (let i = 0; i < n; i++) lock.update(dt, cands, lookX);
}

describe("락온 선택", () => {
  it("화면 중앙에 가까운 대상을 고른다", () => {
    const lock = new LockOnController();
    expect(lock.toggle([c(1, 0.6, 5), c(2, 0.05, 6), c(3, -0.5, 4)])).toBe(2);
  });

  it("중앙에서 비슷하면 가까운 대상을 고른다", () => {
    const lock = new LockOnController();
    expect(lock.toggle([c(1, 0.1, 18), c(2, -0.12, 4)])).toBe(2);
  });

  it("카메라 뒤, 화면 밖, 너무 멂, 가려진 대상은 고르지 않는다", () => {
    const lock = new LockOnController();
    expect(lock.toggle([c(1, 0, 5, { inFront: false }), c(2, 1.4, 5), c(3, 0, 30), c(4, 0, 5, { visible: false })])).toBeNull();
  });

  it("다시 누르면 해제", () => {
    const lock = new LockOnController();
    lock.toggle([c(1, 0, 5)]);
    expect(lock.toggle([c(1, 0, 5)])).toBeNull();
    expect(lock.target).toBeNull();
    expect(lock.lastReleaseReason).toBe("manual");
  });
});

describe("락온 전환 (휙)", () => {
  const cands = [c(1, -0.5, 6), c(2, 0, 6), c(3, 0.3, 6), c(4, 0.8, 6)];

  it("오른쪽으로 휙 움직이면 화면 오른쪽의 가장 가까운 대상으로", () => {
    const lock = new LockOnController();
    lock.toggle(cands);
    expect(lock.target).toBe(2);
    frames(lock, 3, cands, 0.06); // 0.05초 동안 0.18rad
    expect(lock.target).toBe(3);
  });

  it("왼쪽으로 휙", () => {
    const lock = new LockOnController();
    lock.toggle(cands);
    frames(lock, 3, cands, -0.06);
    expect(lock.target).toBe(1);
  });

  it("천천히 움직이면 전환하지 않는다 (임계값 미만)", () => {
    const lock = new LockOnController();
    lock.toggle(cands);
    frames(lock, 120, cands, 0.0015); // 2초에 0.18rad — 창(0.15초) 안 합은 작음
    expect(lock.target).toBe(2);
  });

  it("한 번의 휙으로 여러 대상을 건너뛰지 않는다 (쿨다운)", () => {
    const lock = new LockOnController();
    lock.toggle(cands);
    frames(lock, 12, cands, 0.06); // 0.2초 계속 밀어도
    expect(lock.target).toBe(3);
    frames(lock, 30, cands, 0); // 쿨다운 이후
    frames(lock, 3, cands, 0.06);
    expect(lock.target).toBe(4);
  });

  it("그쪽에 대상이 없으면 그대로", () => {
    const lock = new LockOnController();
    lock.toggle([c(1, 0, 5)]);
    frames(lock, 3, [c(1, 0, 5)], 0.06);
    expect(lock.target).toBe(1);
  });
});

describe("락온 해제", () => {
  it("거리를 넘으면 해제", () => {
    const lock = new LockOnController();
    lock.toggle([c(1, 0, 5)]);
    frames(lock, 1, [c(1, 0, 24)]);
    expect(lock.target).toBe(1);
    frames(lock, 1, [c(1, 0, 26)]);
    expect(lock.target).toBeNull();
    expect(lock.lastReleaseReason).toBe("distance");
  });

  it("대상이 사라지면(사망) 해제", () => {
    const lock = new LockOnController();
    lock.toggle([c(1, 0, 5)]);
    frames(lock, 1, []);
    expect(lock.target).toBeNull();
    expect(lock.lastReleaseReason).toBe("lost");
  });

  it("시야 차단이 1초 이상 이어지면 해제, 그 전에 보이면 유지", () => {
    const lock = new LockOnController();
    lock.toggle([c(1, 0, 5)]);
    frames(lock, 50, [c(1, 0, 5, { visible: false })]); // 0.83초
    frames(lock, 1, [c(1, 0, 5)]);
    frames(lock, 50, [c(1, 0, 5, { visible: false })]);
    expect(lock.target).toBe(1);
    frames(lock, 15, [c(1, 0, 5, { visible: false })]); // 누적 1.08초
    expect(lock.target).toBeNull();
    expect(lock.lastReleaseReason).toBe("occluded");
  });

  it("유지 중에는 화면 밖으로 나가도 풀리지 않는다 (선택 조건과 유지 조건은 다르다)", () => {
    const lock = new LockOnController();
    lock.toggle([c(1, 0, 5)]);
    frames(lock, 30, [c(1, 1.6, 5, { inFront: false })]);
    expect(lock.target).toBe(1);
  });
});
