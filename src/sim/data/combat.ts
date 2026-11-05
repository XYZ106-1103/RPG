/**
 * 전투 판정 공통 규칙.
 */
export const COMBAT_RULES = {
  /** 가드 성공 시 막아내는 체력 피해 비율 (나머지는 칩 데미지로 들어온다) */
  guardAbsorb: 0.85,
  /** 가드/패리가 통하는 정면 반각 (도) — 공격자가 피격자 정면에서 이 각도 안에 있어야 한다 */
  guardHalfAngleDeg: 70,
  /** 가드로 막았을 때 가드한 쪽의 스태미나 회복 지연 (초) */
  guardRegenDelaySeconds: 0.6,
  /** 가드 시 넉백 배율 */
  guardKnockbackMultiplier: 0.5,
  /**
   * 백어택 판정 반각 (도): 공격 방향(공격자 → 피격자)과 피격자 정면의 각도가 이 값 이하면 백어택.
   * 즉 피격자가 공격이 날아오는 방향과 같은 쪽을 보고 있다 = 등을 맞았다.
   */
  backAttackHalfAngleDeg: 60,
  /** 백어택 피해 배율 (백어택은 가드/패리 불가) */
  backAttackDamageMultiplier: 1.5,
  backAttackPoiseMultiplier: 1.5,
  /** 같은 팀끼리 맞는가 */
  friendlyFire: false,
} as const;
