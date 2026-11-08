import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { describe, expect, it, vi } from "vitest";
import { CharacterAnimator, type AnimatorInput } from "../../src/anim/animator";
import { HERO_PROFILE } from "../../src/anim/characters/hero";
import { ClipLibrary } from "../../src/anim/clipLibrary";

/** Babylon AnimationGroup 흉내 (애니메이터가 쓰는 부분만): 60fps, 길이(초) */
class FakeGroup {
  frame = -1;
  weight = 0;
  isPlaying = false;
  readonly targetedAnimations = [{ animation: { framePerSecond: 60 } }];
  constructor(
    readonly name: string,
    readonly from: number,
    readonly to: number,
  ) {}
  start(): this {
    this.isPlaying = true;
    return this;
  }
  stop(): void {
    this.isPlaying = false;
    this.weight = 0;
  }
  goToFrame(f: number): void {
    this.frame = f;
  }
  setWeightForAllAnimatables(w: number): void {
    this.weight = w;
  }
}

const LENGTHS: Record<string, number> = { idle: 3, walk_f: 1.0667, run_f: 0.6667, sprint: 0.6, attack_light_1: 0.8667, hit_front: 0.5, stagger: 1, parry: 0.6667 };

function setup(names = Object.keys(LENGTHS)) {
  const groups = names.map((n) => new FakeGroup(n, 0, Math.round((LENGTHS[n] ?? 1) * 60)));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const lib = new ClipLibrary(groups as unknown as AnimationGroup[], "test");
  const anim = new CharacterAnimator(lib, HERO_PROFILE);
  const g = (n: string) => groups.find((x) => x.name === n) as FakeGroup;
  return { anim, g, lib, warn };
}

const base: AnimatorInput = { state: "idle", action: null, actionProgress: 0, lockedOn: false, moveX: 0, moveZ: 0, yaw: 0, timeScale: 1 };

describe("CharacterAnimator", () => {
  it("없는 애니메이션은 idle로 대체하고 경고 (이름 규칙 밖 그룹도 경고)", () => {
    const groups = [new FakeGroup("idle", 0, 180), new FakeGroup("Dance", 0, 60)];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lib = new ClipLibrary(groups as unknown as AnimationGroup[], "t");
    expect(lib.get("attack_heavy").fallback).toBe(true);
    expect(lib.get("attack_heavy").group).toBe(groups[0]);
    expect(lib.unknown).toEqual(["Dance"]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("idle로 대체"))).toBe(true);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("Dance"))).toBe(true);
    warn.mockRestore();
  });

  it("행동 클립 시간 = sim 진행도 × 클립 길이 (판정 프레임과 화면이 맞는다)", () => {
    const { anim, g } = setup();
    anim.update(1 / 60, base);
    anim.update(1 / 60, { ...base, state: "attack", action: "attack_light_1", actionProgress: 0.5 });
    anim.update(1, { ...base, state: "attack", action: "attack_light_1", actionProgress: 0.5 }); // 크로스페이드 끝
    expect(g("attack_light_1").frame).toBeCloseTo(0.5 * 52, 6); // 0.8667초 × 60fps × 0.5
    expect(g("attack_light_1").weight).toBe(1);
    expect(g("idle").isPlaying).toBe(false);
  });

  it("히트스톱(timeScale 0): 이동 위상·크로스페이드가 멈추고, 행동 클립은 표시 진행도 그대로", () => {
    const { anim, g } = setup();
    anim.update(1, { ...base, moveZ: 3.6 }); // 달리기
    const before = g("run_f").frame;
    anim.update(0.1, { ...base, moveZ: 3.6, timeScale: 0 });
    expect(g("run_f").frame).toBe(before);
    // 공격 시작 직후 히트스톱: 가중치 페이드도 멈춘다
    anim.update(1 / 60, { ...base, moveZ: 3.6, state: "attack", action: "attack_light_1", actionProgress: 0.1 });
    const w = g("attack_light_1").weight;
    anim.update(0.05, { ...base, state: "attack", action: "attack_light_1", actionProgress: 0.1, timeScale: 0 });
    expect(g("attack_light_1").weight).toBe(w);
    expect(g("attack_light_1").frame).toBeCloseTo(0.1 * 52, 6);
    anim.update(0.05, { ...base, state: "attack", action: "attack_light_1", actionProgress: 0.1, timeScale: 1 });
    expect(g("attack_light_1").weight).toBeGreaterThan(w);
  });

  it("이동 1D 블렌드: 걷기~달리기 사이 두 클립, 같은 정규화 위상", () => {
    const { anim, g } = setup();
    for (let i = 0; i < 60; i++) anim.update(1 / 60, { ...base, moveZ: 2.5 });
    const wf = g("walk_f");
    const rf = g("run_f");
    expect(wf.weight + rf.weight).toBeCloseTo(1, 3);
    expect(wf.weight).toBeGreaterThan(0.2);
    expect(rf.weight).toBeGreaterThan(0.2);
    expect(wf.frame / wf.to).toBeCloseTo(rf.frame / rf.to, 6); // 위상 공유
  });

  it("피격 반응: 자유 상태에서만 재생, 공격 중에는 무시", () => {
    const { anim, g } = setup();
    anim.update(1 / 60, base);
    anim.react("hit_front", "attack");
    anim.update(1, base);
    expect(g("hit_front").isPlaying).toBe(false);
    anim.react("hit_front", "move");
    anim.update(0.2, base);
    expect(anim.debug.state).toBe("hit_front");
    expect(g("hit_front").isPlaying).toBe(true);
    anim.update(0.5, base); // 클립 길이(0.5초)가 지나면 원래 상태로
    expect(anim.debug.state).toBe("locomotion");
  });

  it("패리당함(sim stagger) → parry 반동 클립", () => {
    const { anim } = setup();
    anim.update(1 / 60, { ...base, state: "stagger" });
    anim.react("parry", "stagger");
    anim.update(0.1, { ...base, state: "stagger" });
    expect(anim.debug.state).toBe("parry");
  });
});
