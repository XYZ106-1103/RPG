/**
 * 임시 무기 소켓 공급원: anim/placeholderWeapon의 절차적 휘두름 자세를 그대로 쓴다.
 * TODO(에셋): 손 본 소켓 기반 공급원으로 교체.
 */
import { samplePlaceholderWeapon } from "../../anim/placeholderWeapon";
import type { AttackInstance } from "../../sim/combat/types";
import type { Entity } from "../../sim/entity";
import type { WeaponSocketProvider, WeaponSockets } from "./havokHitQuery";

export const placeholderSockets: WeaponSocketProvider = {
  sample(attacker: Readonly<Entity>, instance: Readonly<AttackInstance>, tick: number, out: WeaponSockets): boolean {
    samplePlaceholderWeapon(attacker, instance, tick, out);
    return true;
  },
};
