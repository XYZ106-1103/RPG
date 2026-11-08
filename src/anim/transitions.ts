/**
 * 상태 전환별 크로스페이드 시간 (초). 위에서부터 처음 맞는 줄을 쓴다 ("*" = 아무 상태). Babylon 비의존.
 */
import type { AnimStateId } from "./stateMap";

type Pattern = AnimStateId | "*" | "attack_*";

/** [from, to, 초] */
export const TRANSITIONS: readonly (readonly [Pattern, Pattern, number])[] = [
  ["*", "death", 0.12],
  ["*", "hit_front", 0.05],
  ["*", "hit_back", 0.05],
  ["*", "stagger", 0.06],
  ["*", "parry", 0.04],
  ["attack_*", "attack_*", 0.08], // 콤보: 빨리 이어 붙인다
  ["*", "attack_*", 0.1],
  ["*", "roll_f", 0.06],
  ["roll_f", "*", 0.18],
  ["attack_*", "*", 0.22], // 공격 후 복귀는 천천히
  ["locomotion", "locomotion_lock", 0.25],
  ["locomotion_lock", "locomotion", 0.25],
  ["*", "guard", 0.12],
  ["guard", "*", 0.18],
  ["*", "drink", 0.15],
  ["*", "*", 0.15], // 기본
];

function match(p: Pattern, s: AnimStateId): boolean {
  return p === "*" || p === s || (p === "attack_*" && s.startsWith("attack_"));
}

export function crossfadeSeconds(from: AnimStateId | null, to: AnimStateId): number {
  if (from === null) return 0;
  for (const [f, t, sec] of TRANSITIONS) if (match(f, from) && match(t, to)) return sec;
  return 0.15;
}
