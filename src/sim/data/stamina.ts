/**
 * 스태미나 소모 테이블과 공통 규칙. 밸런스 조정은 이 파일만 고치면 된다.
 * 행동 이름은 애니메이션 이름 규칙(CLAUDE.md)을 따른다.
 */

export interface StaminaActionCost {
  /** 행동 시작 시 즉시 소모량 */
  cost: number;
  /** 소모 후 회복이 시작되기까지 (초) */
  regenDelaySeconds: number;
}

/** 즉시 소모 행동 */
export const STAMINA_ACTIONS = {
  attack_light: { cost: 18, regenDelaySeconds: 0.6 },
  attack_heavy: { cost: 32, regenDelaySeconds: 0.9 },
  attack_run: { cost: 24, regenDelaySeconds: 0.7 },
  roll: { cost: 20, regenDelaySeconds: 0.6 },
  backstep: { cost: 12, regenDelaySeconds: 0.5 },
  drink: { cost: 0, regenDelaySeconds: 0 },
} as const satisfies Record<string, StaminaActionCost>;

export type StaminaActionId = keyof typeof STAMINA_ACTIONS;

export const STAMINA_RULES = {
  /**
   * 행동 가능 최소 스태미나. 소울라이크 관례대로 남은 양이 소모량보다 적어도 0보다 크면 행동할 수 있고,
   * 소모 후 0에서 멈춘다 (음수 없음). 0이면 모든 소모 행동이 막힌다.
   */
  minToAct: 1e-6,
  /** 스태미나를 0까지 다 쓰면 회복 지연이 이 값 이상으로 늘어난다 (탈진 페널티, 초) */
  exhaustedRegenDelaySeconds: 1.2,
  /** 가드 중 회복 배율 */
  guardRegenMultiplier: 0.35,
  /** 스프린트 초당 소모량 */
  sprintDrainPerSecond: 14,
  /** 스프린트 중 회복 지연 (멈춘 뒤 이만큼 지나야 회복) */
  sprintRegenDelaySeconds: 0.5,
} as const;
