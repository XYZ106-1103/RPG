/**
 * 강인도 공통 규칙. 원형별 최대치/회복량은 archetypes.ts.
 */
export const POISE_RULES = {
  /** 슈퍼아머(강공격 등) 중 받는 강인도 피해 배율 */
  superArmorDamageMultiplier: 0.5,
  /** 붕괴 후 강인도를 최대치로 되돌린다 (연속 경직 방지) */
  resetOnBreak: true,
} as const;
