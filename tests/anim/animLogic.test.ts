import { describe, expect, it } from "vitest";
import { blend1D, blend2D, RATE_MAX, RATE_MIN, toLocal } from "../../src/anim/blendTree";
import { HERO_PROFILE } from "../../src/anim/characters/hero";
import { ANIM_NAMES, isAnimName } from "../../src/anim/clips";
import { CrossfadeMixer } from "../../src/anim/mixer";
import { ANIM_STATES, REACTION_ALLOWED, resolveAnimState, SIM_TO_ANIM, type AnimStateId } from "../../src/anim/stateMap";
import { crossfadeSeconds } from "../../src/anim/transitions";
import { PLAYER_ACTIONS } from "../../src/sim/data/playerTimelines";
import { PLAYER_MOVEMENT } from "../../src/sim/data/player";
import { PLAYER_STATES } from "../../src/sim/player/types";

const native = HERO_PROFILE.nativeSpeeds;
const sum = (w: Partial<Record<string, number>>) => Object.values(w).reduce((a: number, b) => a + (b ?? 0), 0);

describe("sim 상태 → 애니메이션 상태 테이블", () => {
  it("모든 sim 상태와 공격 행동이 테이블에 있고, 가리키는 애니메이션 상태와 클립이 실제로 존재한다", () => {
    for (const s of PLAYER_STATES) expect(SIM_TO_ANIM[s], s).toBeDefined();
    for (const a of PLAYER_ACTIONS.filter((a) => a.startsWith("attack_"))) expect(resolveAnimState("attack", a, false), a).toBe(a);
    for (const [id, def] of Object.entries(ANIM_STATES)) {
      if (def.kind === "clip") expect(def.clip && isAnimName(def.clip), id).toBe(true);
    }
    expect(ANIM_NAMES).toHaveLength(22);
  });

  it("락온이면 idle/move는 8방향, 질주는 락온 중에도 1D", () => {
    expect(resolveAnimState("idle", null, false)).toBe("locomotion");
    expect(resolveAnimState("move", null, true)).toBe("locomotion_lock");
    expect(resolveAnimState("sprint", null, true)).toBe("locomotion");
    expect(resolveAnimState("roll", "roll", true)).toBe("roll_f");
    expect(resolveAnimState("death", null, false)).toBe("death");
  });

  it("피격 반응은 행동 중(공격/구르기)에는 재생하지 않는다", () => {
    expect(REACTION_ALLOWED.hit_front.has("move")).toBe(true);
    expect(REACTION_ALLOWED.hit_front.has("attack")).toBe(false);
    expect(REACTION_ALLOWED.hit_back.has("roll")).toBe(false);
    // 패리당하면 sim은 stagger, 벽 튕김은 attack 유지 — 둘 다 반동 클립
    expect(REACTION_ALLOWED.parry.has("stagger")).toBe(true);
    expect(REACTION_ALLOWED.parry.has("attack")).toBe(true);
  });
});

describe("전환별 크로스페이드", () => {
  it("표의 위에서부터 첫 일치", () => {
    expect(crossfadeSeconds(null, "locomotion")).toBe(0);
    expect(crossfadeSeconds("attack_light_1", "attack_light_2")).toBe(0.08);
    expect(crossfadeSeconds("locomotion", "attack_light_1")).toBe(0.1);
    expect(crossfadeSeconds("attack_heavy", "locomotion")).toBe(0.22);
    expect(crossfadeSeconds("attack_heavy", "death")).toBe(0.12);
    expect(crossfadeSeconds("locomotion", "hit_front")).toBe(0.05);
    expect(crossfadeSeconds("guard", "drink")).toBe(0.18); // "guard → *" 줄이 "* → drink"보다 위
    expect(crossfadeSeconds("locomotion", "drink")).toBe(0.15);
    expect(crossfadeSeconds("drink", "stagger")).toBe(0.06);
  });
});

describe("크로스페이드 믹서", () => {
  it("새 상태 0→1, 나머지는 비율대로 줄고 합은 항상 1", () => {
    const m = new CrossfadeMixer<AnimStateId>();
    m.play("locomotion", 0);
    expect(m.weight("locomotion")).toBe(1);
    m.play("attack_light_1", 0.1);
    m.update(0.05);
    expect(m.weight("attack_light_1")).toBeCloseTo(0.5, 6);
    expect(m.weight("locomotion")).toBeCloseTo(0.5, 6);
    m.play("attack_light_2", 0.1); // 페이드 도중 다시 전환
    m.update(0.05);
    expect(sum(Object.fromEntries(m.active()))).toBeCloseTo(1, 6);
    expect(m.weight("attack_light_2")).toBeCloseTo(0.5, 6);
    m.update(1);
    expect([...m.active().keys()]).toEqual(["attack_light_2"]);
  });

  it("dt 0(히트스톱)이면 가중치가 멈춘다", () => {
    const m = new CrossfadeMixer<AnimStateId>();
    m.play("locomotion", 0);
    m.play("roll_f", 0.2);
    m.update(0.1);
    const w = m.weight("roll_f");
    m.update(0);
    expect(m.weight("roll_f")).toBe(w);
  });
});

describe("이동 블렌드 트리", () => {
  const pts = [
    { clip: "idle" as const, speed: 0 },
    { clip: "walk_f" as const, speed: PLAYER_MOVEMENT.walkSpeed },
    { clip: "run_f" as const, speed: PLAYER_MOVEMENT.runSpeed },
    { clip: "sprint" as const, speed: PLAYER_MOVEMENT.sprintSpeed },
  ];

  it("1D: 기준 속도에서 해당 클립 100%, 사이에서는 인접 두 클립", () => {
    expect(blend1D(0, pts, native).weights).toEqual({ idle: 1 });
    expect(blend1D(PLAYER_MOVEMENT.walkSpeed, pts, native).weights).toEqual({ walk_f: 1 });
    const mid = blend1D((PLAYER_MOVEMENT.walkSpeed + PLAYER_MOVEMENT.runSpeed) / 2, pts, native).weights;
    expect(mid.walk_f).toBeCloseTo(0.5, 6);
    expect(mid.run_f).toBeCloseTo(0.5, 6);
    expect(blend1D(99, pts, native).weights).toEqual({ sprint: 1 });
  });

  it("1D 재생 배속 = 실제 속도 ÷ 클립 고유 속도 (C안이면 약 1.5배), 제한 범위", () => {
    const walk = blend1D(PLAYER_MOVEMENT.walkSpeed, pts, native).rate;
    expect(walk).toBeCloseTo(PLAYER_MOVEMENT.walkSpeed / (native.walk_f ?? 1), 6);
    expect(walk).toBeGreaterThan(1.4);
    expect(walk).toBeLessThan(1.7);
    expect(blend1D(PLAYER_MOVEMENT.sprintSpeed, pts, native).rate).toBeCloseTo(PLAYER_MOVEMENT.sprintSpeed / (native.sprint ?? 1), 6);
    expect(blend1D(30, pts, native).rate).toBe(RATE_MAX);
    expect(blend1D(0.05, pts, native).rate).toBe(RATE_MIN);
    expect(blend1D(0, pts, native).rate).toBe(1);
  });

  it("2D: 정면/측면/뒤 100%, 대각은 인접 두 개를 반씩, 느리면 idle과 섞음", () => {
    const w = PLAYER_MOVEMENT.walkSpeed;
    expect(blend2D(0, w, w, native).weights).toEqual({ walk_f: 1 });
    expect(blend2D(w, 0, w, native).weights).toEqual({ walk_r: 1 });
    expect(blend2D(0, -w, w, native).weights).toEqual({ walk_b: 1 });
    expect(blend2D(-w, 0, w, native).weights).toEqual({ walk_l: 1 });
    const d = Math.SQRT1_2 * w;
    const fr = blend2D(d, d, w, native).weights;
    expect(fr.walk_f).toBeCloseTo(0.5, 6);
    expect(fr.walk_r).toBeCloseTo(0.5, 6);
    const bl = blend2D(-d, -d, w, native).weights;
    expect(bl.walk_b).toBeCloseTo(0.5, 6);
    expect(bl.walk_l).toBeCloseTo(0.5, 6);
    const slow = blend2D(0, w / 4, w, native).weights;
    expect(slow.walk_f).toBeCloseTo(0.25, 6);
    expect(slow.idle).toBeCloseTo(0.75, 6);
    for (const v of [fr, bl, slow]) expect(sum(v)).toBeCloseTo(1, 6);
    expect(blend2D(0, 0, w, native).weights).toEqual({ idle: 1 });
  });

  it("2D 재생 배속은 섞인 방향 클립의 고유 속도 평균 기준", () => {
    const w = PLAYER_MOVEMENT.walkSpeed;
    const d = Math.SQRT1_2 * w;
    const expected = w / (((native.walk_f ?? 1) + (native.walk_r ?? 1)) / 2);
    expect(blend2D(d, d, w, native).rate).toBeCloseTo(Math.min(RATE_MAX, expected), 6);
  });

  it("월드 속도 → 캐릭터 기준 (yaw +Z=0, +X 쪽 증가)", () => {
    const r6 = (v: number) => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(6));
    const f = toLocal(0, 1, 0);
    expect([f.x, f.z].map(r6)).toEqual([0, 1]);
    const r = toLocal(1, 0, 0);
    expect([r.x, r.z].map(r6)).toEqual([1, 0]);
    // 캐릭터가 +X를 보고 있으면(yaw 90°) 월드 +X 이동은 앞, 월드 -Z 이동은 오른쪽
    const a = toLocal(1, 0, Math.PI / 2);
    expect([a.x, a.z].map(r6)).toEqual([0, 1]);
    const b = toLocal(0, -1, Math.PI / 2);
    expect([b.x, b.z].map(r6)).toEqual([1, 0]);
  });
});
