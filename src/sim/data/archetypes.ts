/**
 * 캐릭터 원형별 기본 스탯. 밸런스 조정은 이 파일만 고치면 된다.
 * 시간은 초, 속도는 초당 값. (sim 내부에서 틱으로 변환)
 */

export interface ArchetypeStats {
  /** 표시 이름 */
  name: string;
  maxHealth: number;
  maxStamina: number;
  /** 회복 지연이 끝난 뒤 초당 스태미나 회복량 */
  staminaRegenPerSecond: number;
  maxPoise: number;
  /** 회복 지연이 끝난 뒤 초당 강인도 회복량 */
  poiseRegenPerSecond: number;
  /** 마지막 강인도 피해 후 회복이 시작되기까지 (초) */
  poiseRegenDelaySeconds: number;
  /** 강인도 붕괴 시 경직 시간 (초) */
  staggerSeconds: number;
  /** 캡슐 충돌 크기 (m) */
  radius: number;
  height: number;
}

export const ARCHETYPES = {
  player: {
    name: "등불지기",
    maxHealth: 100,
    maxStamina: 100,
    staminaRegenPerSecond: 45,
    maxPoise: 30,
    poiseRegenPerSecond: 15,
    poiseRegenDelaySeconds: 3,
    staggerSeconds: 1.0,
    radius: 0.35,
    height: 1.8,
  },
  hollow: {
    name: "재의 망자",
    maxHealth: 90,
    maxStamina: 80,
    staminaRegenPerSecond: 30,
    maxPoise: 25,
    poiseRegenPerSecond: 12,
    poiseRegenDelaySeconds: 3,
    staggerSeconds: 1.2,
    radius: 0.38,
    height: 1.75,
  },
  hound: {
    name: "잿빛 사냥개",
    maxHealth: 55,
    maxStamina: 60,
    staminaRegenPerSecond: 40,
    maxPoise: 12,
    poiseRegenPerSecond: 10,
    poiseRegenDelaySeconds: 2,
    staggerSeconds: 0.9,
    radius: 0.4,
    height: 1.0,
  },
  ash_knight: {
    name: "꺼진 태양의 기사",
    maxHealth: 950,
    maxStamina: 200,
    staminaRegenPerSecond: 50,
    maxPoise: 140,
    poiseRegenPerSecond: 20,
    poiseRegenDelaySeconds: 6,
    staggerSeconds: 2.2,
    radius: 0.85,
    height: 3.2,
  },
} as const satisfies Record<string, ArchetypeStats>;

export type ArchetypeId = keyof typeof ARCHETYPES;

export function isArchetypeId(id: string): id is ArchetypeId {
  return Object.prototype.hasOwnProperty.call(ARCHETYPES, id);
}
