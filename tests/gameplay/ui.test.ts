import { describe, expect, it } from "vitest";
import { textBar } from "../../src/ui/debugPanel";
import { FpsMeter } from "../../src/ui/fpsMeter";

describe("FPS 측정", () => {
  it("측정 구간마다 프레임 수 / 시간", () => {
    const m = new FpsMeter(0.5);
    for (let i = 0; i < 30; i++) m.update(1 / 60);
    expect(m.fps).toBeCloseTo(60, 6);
    for (let i = 0; i < 15; i++) m.update(1 / 30);
    expect(m.fps).toBeCloseTo(30, 6);
  });

  it("구간의 가장 긴 프레임을 기록한다", () => {
    const m = new FpsMeter(0.5);
    for (let i = 0; i < 20; i++) m.update(1 / 60);
    m.update(0.2);
    expect(m.worstFrameMs).toBeCloseTo(200, 6);
  });

  it("0/음수/NaN 프레임은 무시", () => {
    const m = new FpsMeter(0.1);
    m.update(0);
    m.update(-1);
    m.update(Number.NaN);
    expect(m.fps).toBe(0);
  });
});

describe("텍스트 막대", () => {
  it("비율만큼 채운다 (범위 밖은 자른다)", () => {
    expect(textBar(0.5, 4)).toBe("██░░");
    expect(textBar(2, 3)).toBe("███");
    expect(textBar(-1, 3)).toBe("░░░");
    expect(textBar(Number.NaN, 2)).toBe("░░");
  });
});

import { PLAYER_STATES } from "../../src/sim/player/types";
import { VIEW_COLORS, playerColorKey } from "../../src/gameplay/player/stateColors";

describe("상태별 캡슐 색", () => {
  it("모든 플레이어 상태에 색이 있다", () => {
    for (const s of PLAYER_STATES) expect(VIEW_COLORS[playerColorKey(s, null)], s).toBeDefined();
  });

  it("약공격/강공격/달리기 공격을 구분한다", () => {
    expect(playerColorKey("attack", "attack_light_2")).toBe("attackLight");
    expect(playerColorKey("attack", "attack_heavy")).toBe("attackHeavy");
    expect(playerColorKey("attack", "attack_run")).toBe("attackHeavy");
  });

  it("상태끼리 색이 겹치지 않는다 (눈으로 구분 가능)", () => {
    const keys = [...PLAYER_STATES.map((s) => playerColorKey(s, null)), "attackHeavy" as const];
    const colors = new Set(keys.map((k) => VIEW_COLORS[k].join(",")));
    expect(colors.size).toBe(new Set(keys).size);
  });
});
