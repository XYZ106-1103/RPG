/**
 * 애니메이션 이름 규칙 (CLAUDE.md "애니메이션 이름 규칙"). 코드는 이 이름으로만 애니메이션을 참조한다.
 * tools/blender/lib_assets.py의 ANIMATION_NAMES와 같은 목록이다.
 */
export const ANIM_NAMES = [
  "idle",
  "guard",
  "drink",
  "walk_f",
  "walk_b",
  "walk_l",
  "walk_r",
  "run_f",
  "sprint",
  "roll_f",
  "roll_b",
  "backstep",
  "attack_light_1",
  "attack_light_2",
  "attack_light_3",
  "attack_heavy",
  "attack_run",
  "hit_front",
  "hit_back",
  "stagger",
  "parry",
  "death",
] as const;

export type AnimName = (typeof ANIM_NAMES)[number];

export function isAnimName(name: string): name is AnimName {
  return (ANIM_NAMES as readonly string[]).includes(name);
}
