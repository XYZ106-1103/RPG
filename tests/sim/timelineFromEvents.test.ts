import { describe, expect, it } from "vitest";
import heroEvents from "../../src/anim/events/hero.json";
import { PLAYER_ACTIONS, PLAYER_TIMELINES } from "../../src/sim/data/playerTimelines";
import { rootMotionProgress, type AnimEventsFile } from "../../src/sim/player/timeline";
import { PLAYER_ACTION_ANIMS, timelinesFromEvents } from "../../src/sim/player/timelineFromEvents";

const file = (animations: AnimEventsFile["animations"]): AnimEventsFile => ({ fps: 30, animations });

describe("timelinesFromEvents", () => {
  it("30fps 프레임 → 60Hz 틱 (×2), 이벤트 → 구간", () => {
    const { timelines, warnings } = timelinesFromEvents(
      file({
        attack_light_1: {
          length: 26,
          events: [
            { frame: 9, name: "hit_start" },
            { frame: 14, name: "hit_end" },
            { frame: 10, name: "input_buffer_start" },
            { frame: 18, name: "cancel_window" },
            { frame: 7, name: "sfx:swing" },
          ],
        },
      }),
    );
    expect(timelines.attack_light_1).toMatchObject({ length: 52, hit: { start: 18, end: 28 }, buffer: { start: 20, end: 52 }, cancel: 36 });
    expect(warnings.some((w) => w.startsWith("roll:"))).toBe(true); // 없는 애니메이션은 경고 + 기본값
    expect(timelines.roll).toBeUndefined();
  });

  it("이벤트에 없는 값(슈퍼아머/루트 모션 구간/효과 틱)은 기본값을 길이 비율로", () => {
    const def = PLAYER_TIMELINES.attack_heavy; // 60틱, 슈퍼아머 12~32, 루트 모션 16~30
    const { timelines } = timelinesFromEvents(file({ attack_heavy: { length: 60, events: [{ frame: 20, name: "hit_start" }, { frame: 30, name: "hit_end" }] } }));
    const t = timelines.attack_heavy;
    expect(t?.length).toBe(120);
    expect(t?.superArmor).toEqual({ start: 24, end: 64 });
    expect(t?.rootMotion).toMatchObject({ distance: def.rootMotion?.distance, start: 32, end: 60 });
    // cancel_window가 없으면 기본 캔슬을 비율로
    expect(t?.cancel).toBe(Math.round(def.cancel * 2));
  });

  it("잘못된 구간이나 한쪽만 있는 이벤트는 경고하고 기본값", () => {
    const { timelines, warnings } = timelinesFromEvents(
      file({
        roll_f: { length: 36, events: [{ frame: 10, name: "iframe_start" }, { frame: 5, name: "iframe_end" }] },
        backstep: { length: 13, events: [{ frame: 2, name: "iframe_start" }] },
      }),
    );
    expect(warnings.some((w) => w.includes("roll") && w.includes("잘못됨"))).toBe(true);
    expect(warnings.some((w) => w.includes("backstep") && w.includes("하나만"))).toBe(true);
    expect(timelines.roll?.iframes).toEqual({ start: 6, end: 32 }); // 기본 3~16을 ×2
  });

  it("smooth 곡선: 천천히 출발 → 가속 → 천천히 정지 (시작/끝 기울기 0, 가운데 0.5)", () => {
    const rm = { distance: 2, start: 0, end: 10, curve: "smooth" as const };
    expect(rootMotionProgress(rm, 0)).toBe(0);
    expect(rootMotionProgress(rm, 5)).toBeCloseTo(0.5, 9);
    expect(rootMotionProgress(rm, 10)).toBe(1);
    expect(rootMotionProgress(rm, 1)).toBeLessThan(0.1 * 0.5); // linear(0.1)보다 훨씬 느린 출발
    expect(rootMotionProgress(rm, 9)).toBeGreaterThan(1 - 0.1 * 0.5);
  });

  it("이벤트 파일의 rootMotion이 있으면 그 구간/거리/곡선, 잘못되면 경고하고 기본값", () => {
    const { timelines, warnings } = timelinesFromEvents(
      file({
        roll_f: { length: 28, events: [], rootMotion: { start: 3, end: 22, distance: 2.17, curve: "smooth" } },
        backstep: { length: 13, events: [], rootMotion: { start: 5, end: 99, distance: 1.6, curve: "smooth" } },
        attack_run: { length: 22, events: [], rootMotion: { start: 0, end: 15, distance: 2, curve: "wobble" } },
      }),
    );
    expect(timelines.roll?.rootMotion).toEqual({ distance: 2.17, start: 6, end: 44, curve: "smooth" });
    expect(warnings.some((w) => w.startsWith("backstep: rootMotion이 잘못됨"))).toBe(true);
    expect(warnings.some((w) => w.startsWith("attack_run: rootMotion이 잘못됨"))).toBe(true);
    expect(timelines.backstep?.rootMotion?.curve).toBe(PLAYER_TIMELINES.backstep.rootMotion?.curve); // 기본값
  });

  it("hero.json: 모든 행동이 경고 없이 변환되고 구간이 길이 안에 있다", () => {
    const { timelines, warnings } = timelinesFromEvents(heroEvents as AnimEventsFile);
    expect(warnings).toEqual([]);
    for (const a of PLAYER_ACTIONS) {
      const t = timelines[a];
      const anim = (heroEvents as AnimEventsFile).animations[PLAYER_ACTION_ANIMS[a]];
      expect(t, a).toBeDefined();
      expect(t?.length, a).toBe((anim?.length ?? 0) * 2);
      for (const w of [t?.hit, t?.iframes, t?.superArmor, t?.buffer]) {
        if (w) expect(w.start >= 0 && w.start < w.end && w.end <= (t?.length ?? 0), `${a} ${JSON.stringify(w)}`).toBe(true);
      }
      expect(t?.cancel ?? 0, a).toBeLessThanOrEqual(t?.length ?? 0);
    }
    // 공격은 판정 구간, 구르기/백스텝은 무적 구간이 있어야 한다
    for (const a of ["attack_light_1", "attack_light_2", "attack_light_3", "attack_heavy", "attack_run"] as const) expect(timelines[a]?.hit, a).toBeDefined();
    expect(timelines.roll?.iframes).toBeDefined();
    expect(timelines.backstep?.iframes).toBeDefined();
    expect(timelines.roll?.rootMotion).toMatchObject({ distance: 2.17, start: 6, end: 44, curve: "smooth" });
    expect(timelines.roll?.cancel).toBe(48); // 24프레임 — 일어나는 동작 뒤
    expect(timelines.backstep?.rootMotion).toMatchObject({ distance: 1.6, start: 0, end: 20, curve: "smooth" });
  });
});
