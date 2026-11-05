import { describe, expect, it } from "vitest";
import {
  COLLISION_TABLE,
  LAYER,
  LAYER_NAMES,
  collideMaskOf,
  findAsymmetricPairs,
  isOverlapOnly,
  membershipOf,
  shouldCollide,
  type LayerName,
} from "../../src/physics/layers";

describe("충돌 레이어 표", () => {
  it("대칭이다: A가 B와 충돌하면 B도 A와 충돌한다", () => {
    expect(findAsymmetricPairs()).toEqual([]);
    for (const a of LAYER_NAMES) {
      for (const b of LAYER_NAMES) {
        expect(COLLISION_TABLE[a].includes(b), `${a}→${b}`).toBe(COLLISION_TABLE[b].includes(a));
      }
    }
  });

  it("비대칭 검사기는 실제로 비대칭을 잡는다 (CLAUDE.md 수정 전 표)", () => {
    const before: Record<LayerName, LayerName[]> = {
      PLAYER: ["ENVIRONMENT", "ENEMY", "TRIGGER"],
      ENEMY: ["ENVIRONMENT", "PLAYER", "ENEMY"],
      ENVIRONMENT: ["PLAYER", "ENEMY", "ENVIRONMENT", "TRIGGER", "PROJECTILE"],
      TRIGGER: ["PLAYER"],
      PROJECTILE: ["ENVIRONMENT", "PLAYER", "ENEMY"],
    };
    expect(findAsymmetricPairs(before)).toEqual([
      ["ENVIRONMENT", "TRIGGER"],
      ["PROJECTILE", "PLAYER"],
      ["PROJECTILE", "ENEMY"],
    ]);
  });

  it("레이어 비트는 서로 겹치지 않는 단일 비트", () => {
    const bits = LAYER_NAMES.map((n) => LAYER[n]);
    for (const b of bits) expect(b & (b - 1)).toBe(0);
    expect(new Set(bits).size).toBe(bits.length);
  });

  it("membership은 자기 비트, collide 마스크는 표의 대상 비트 합", () => {
    expect(membershipOf("PLAYER")).toBe(LAYER.PLAYER);
    expect(collideMaskOf("TRIGGER")).toBe(LAYER.PLAYER);
    expect(collideMaskOf("PLAYER")).toBe(LAYER.ENVIRONMENT | LAYER.ENEMY | LAYER.TRIGGER | LAYER.PROJECTILE);
  });

  it("shouldCollide는 표와 일치한다 (Havok 양방향 규칙)", () => {
    for (const a of LAYER_NAMES) for (const b of LAYER_NAMES) expect(shouldCollide(a, b), `${a}-${b}`).toBe(COLLISION_TABLE[a].includes(b));
  });

  it("CLAUDE.md 의도: 트리거는 플레이어만, 투사체는 투사체끼리 안 부딪힘, 적끼리는 부딪힘", () => {
    for (const other of LAYER_NAMES) expect(shouldCollide("TRIGGER", other), other).toBe(other === "PLAYER");
    expect(shouldCollide("PROJECTILE", "PROJECTILE")).toBe(false);
    expect(shouldCollide("PROJECTILE", "PLAYER")).toBe(true);
    expect(shouldCollide("PROJECTILE", "ENEMY")).toBe(true);
    expect(shouldCollide("ENEMY", "ENEMY")).toBe(true);
    expect(shouldCollide("PLAYER", "PLAYER")).toBe(false);
  });

  it("TRIGGER만 오버랩 전용", () => {
    expect(LAYER_NAMES.filter(isOverlapOnly)).toEqual(["TRIGGER"]);
  });
});
