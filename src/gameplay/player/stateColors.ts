/**
 * 상태별 캡슐 색 — 상태 머신 동작을 눈으로 확인하기 위한 임시 표현.
 * TODO(애니메이션): 캐릭터 모델 + 애니메이션이 들어오면 제거한다.
 */
import type { PlayerActionId } from "../../sim/data/playerTimelines";
import type { PlayerStateId } from "../../sim/player/types";

export type ViewColorKey =
  | "idle"
  | "move"
  | "sprint"
  | "guard"
  | "attackLight"
  | "attackHeavy"
  | "roll"
  | "backstep"
  | "drink"
  | "stagger"
  | "death"
  | "enemy"
  | "dummy";

/** sRGB 0~1 */
export const VIEW_COLORS: Readonly<Record<ViewColorKey, readonly [number, number, number]>> = {
  idle: [0.55, 0.55, 0.55],
  move: [0.45, 0.52, 0.62],
  sprint: [0.35, 0.8, 1.0],
  guard: [0.2, 0.35, 0.95],
  attackLight: [1.0, 0.55, 0.15],
  attackHeavy: [0.95, 0.15, 0.1],
  roll: [0.25, 0.85, 0.3],
  backstep: [0.15, 0.7, 0.65],
  drink: [0.6, 0.3, 0.85],
  stagger: [1.0, 0.9, 0.15],
  death: [0.06, 0.06, 0.06],
  enemy: [0.4, 0.13, 0.1],
  dummy: [0.42, 0.33, 0.22],
};

/** 플레이어 상태/행동 → 색 키 */
export function playerColorKey(state: PlayerStateId, action: PlayerActionId | null): ViewColorKey {
  switch (state) {
    case "attack":
      return action === "attack_heavy" || action === "attack_run" ? "attackHeavy" : "attackLight";
    default:
      return state;
  }
}
