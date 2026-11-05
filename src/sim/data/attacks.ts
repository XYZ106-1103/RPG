/**
 * 공격 데이터 (AttackDef). 밸런스 조정은 이 파일만 고치면 된다.
 *
 * 무기 궤적(어디를 지나가는가)은 애니메이션이 정하므로 여기에는 판정 캡슐의 반경만 둔다.
 * 판정 구간(hit_start ~ hit_end)은 애니메이션 이벤트(src/anim/events/)가 setAttackActive로 열고 닫는다.
 */

export interface AttackDef {
  /** 체력 피해 */
  damage: number;
  /** 강인도 피해 */
  poiseDamage: number;
  /** 공격자가 공격 시작 시 쓰는 스태미나 */
  staminaCost: number;
  /** 공격 후 공격자의 스태미나 회복 지연 (초) */
  staminaRegenDelaySeconds: number;
  /** 가드한 상대에게 깎는 스태미나 */
  guardStaminaDamage: number;
  /** 히트스톱 (프레임 = sim 틱, 2~4) */
  hitstopFrames: 2 | 3 | 4;
  /** 넉백 속도 (m/s, 공격자 → 피격자 수평 방향) */
  knockback: number;
  /** 판정 형태: 무기 궤적을 따라 스윕하는 캡슐 */
  hitbox: { radius: number };
  /** 패리 가능한 공격인가 (보스의 잡기/강공격 등은 false) */
  parryable: boolean;
}

export const ATTACKS = {
  // --- 플레이어 (직검) ---
  attack_light_1: { damage: 22, poiseDamage: 14, staminaCost: 18, staminaRegenDelaySeconds: 0.6, guardStaminaDamage: 18, hitstopFrames: 3, knockback: 1.5, hitbox: { radius: 0.12 }, parryable: true },
  attack_light_2: { damage: 24, poiseDamage: 14, staminaCost: 18, staminaRegenDelaySeconds: 0.6, guardStaminaDamage: 18, hitstopFrames: 3, knockback: 1.5, hitbox: { radius: 0.12 }, parryable: true },
  attack_light_3: { damage: 32, poiseDamage: 22, staminaCost: 22, staminaRegenDelaySeconds: 0.7, guardStaminaDamage: 26, hitstopFrames: 4, knockback: 2.5, hitbox: { radius: 0.14 }, parryable: true },
  attack_heavy: { damage: 48, poiseDamage: 40, staminaCost: 32, staminaRegenDelaySeconds: 0.9, guardStaminaDamage: 45, hitstopFrames: 4, knockback: 3.5, hitbox: { radius: 0.16 }, parryable: true },
  attack_run: { damage: 30, poiseDamage: 24, staminaCost: 24, staminaRegenDelaySeconds: 0.7, guardStaminaDamage: 26, hitstopFrames: 3, knockback: 3, hitbox: { radius: 0.14 }, parryable: true },

  // --- 재의 망자 ---
  hollow_slash: { damage: 16, poiseDamage: 18, staminaCost: 15, staminaRegenDelaySeconds: 0.8, guardStaminaDamage: 20, hitstopFrames: 3, knockback: 2, hitbox: { radius: 0.14 }, parryable: true },
  hollow_overhead: { damage: 26, poiseDamage: 30, staminaCost: 25, staminaRegenDelaySeconds: 1.0, guardStaminaDamage: 35, hitstopFrames: 4, knockback: 3, hitbox: { radius: 0.16 }, parryable: true },

  // --- 잿빛 사냥개 ---
  hound_bite: { damage: 11, poiseDamage: 10, staminaCost: 10, staminaRegenDelaySeconds: 0.5, guardStaminaDamage: 14, hitstopFrames: 2, knockback: 1.2, hitbox: { radius: 0.18 }, parryable: true },
  hound_lunge: { damage: 17, poiseDamage: 20, staminaCost: 20, staminaRegenDelaySeconds: 0.8, guardStaminaDamage: 22, hitstopFrames: 3, knockback: 2.5, hitbox: { radius: 0.2 }, parryable: true },

  // --- 꺼진 태양의 기사 (보스) ---
  ash_knight_sweep: { damage: 28, poiseDamage: 30, staminaCost: 0, staminaRegenDelaySeconds: 0, guardStaminaDamage: 40, hitstopFrames: 4, knockback: 3.5, hitbox: { radius: 0.25 }, parryable: true },
  ash_knight_slam: { damage: 46, poiseDamage: 60, staminaCost: 0, staminaRegenDelaySeconds: 0, guardStaminaDamage: 70, hitstopFrames: 4, knockback: 5, hitbox: { radius: 0.35 }, parryable: false },
  ash_knight_charge: { damage: 34, poiseDamage: 45, staminaCost: 0, staminaRegenDelaySeconds: 0, guardStaminaDamage: 50, hitstopFrames: 4, knockback: 5, hitbox: { radius: 0.3 }, parryable: false },
} as const satisfies Record<string, AttackDef>;

export type AttackId = keyof typeof ATTACKS;

export function isAttackId(id: string): id is AttackId {
  return Object.prototype.hasOwnProperty.call(ATTACKS, id);
}
