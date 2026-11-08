import { describe, expect, it } from "vitest";
import { buildEventsFile, estimateEvents, formatTable } from "../../tools/gen_anim_events.mjs";

const frameOf = (evs: { frame: number; name: string }[], name: string) => evs.find((e) => e.name === name)?.frame;

describe("애니메이션 이벤트 추정", () => {
  it("공격: hit 35~55%, 버퍼 40%, 캔슬 70%, 휘두름 소리는 hit_start 2프레임 전, 모두 '추정값' 주석", () => {
    const evs = estimateEvents("attack_light_1", 26, {});
    expect(frameOf(evs, "hit_start")).toBe(9);
    expect(frameOf(evs, "hit_end")).toBe(14);
    expect(frameOf(evs, "input_buffer_start")).toBe(10);
    expect(frameOf(evs, "cancel_window")).toBe(18);
    expect(frameOf(evs, "sfx:swing")).toBe(7);
    expect(evs.every((e) => e.note.startsWith("추정값"))).toBe(true);
    expect(evs.map((e) => e.frame)).toEqual([...evs.map((e) => e.frame)].sort((a, b) => a - b));
  });

  it("구르기: 무적 10~45%, 캔슬 75%", () => {
    const evs = estimateEvents("roll_f", 28, {});
    expect([frameOf(evs, "iframe_start"), frameOf(evs, "iframe_end"), frameOf(evs, "cancel_window")]).toEqual([3, 13, 21]);
  });

  it("이동: animations.json 접지 프레임이 있으면 발소리에 그 값", () => {
    const evs = estimateEvents("walk_f", 32, { contacts: { L: 0, R: 16 } });
    expect(evs.map((e) => [e.name, e.frame])).toEqual([["sfx:step_l", 0], ["sfx:step_r", 16]]);
  });

  it("파일: 원본 이름 → 이름 규칙(mapping), 길이 = 초 × 30, 작성자 값은 source", () => {
    const f = buildEventsFile({ SlashL: 0.8667, Idle: 3 }, { SlashL: { events: { hit: 11 } } }, { SlashL: "attack_light_1", Idle: "idle" }, "hero");
    expect(Object.keys(f.animations)).toEqual(["Idle", "SlashL"]); // GLB 이름(이미 merge에서 규칙 이름이 된 상태가 정상)
    expect(f.animations.SlashL?.length).toBe(26);
    const g = buildEventsFile({ attack_light_1: 0.8667, idle: 3 }, { SlashL: { events: { hit: 11 } } }, { SlashL: "attack_light_1" }, "hero");
    expect(g.animations.attack_light_1?.source).toEqual({ events: { hit: 11 } });
    expect(g.animations.idle?.loop).toBe(true);
    expect(formatTable(g)).toContain("| attack_light_1 | 26 |");
  });
});
