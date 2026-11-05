/**
 * 방향 판정: 정면 아크(가드/패리), 백어택.
 * 모두 수평(XZ) 평면에서 판단한다.
 */
import { COMBAT_RULES } from "../data/combat";
import type { Entity } from "../entity";
import { angleDelta } from "../math/scalar";
import { set, type ReadonlyVec3, type Vec3 } from "../math/vec3";

const DEG = Math.PI / 180;

/** from 지점이 entity의 정면 ±halfAngle 안에 있는가 */
export function isInFrontArc(entity: Readonly<Entity>, from: ReadonlyVec3, halfAngleRad: number): boolean {
  const dx = from.x - entity.position.x;
  const dz = from.z - entity.position.z;
  if (dx === 0 && dz === 0) return true; // 같은 위치면 정면으로 본다
  return Math.abs(angleDelta(entity.yaw, Math.atan2(dx, dz))) <= halfAngleRad;
}

/** 공격 방향: 공격자 → 피격자 수평 단위 벡터. 같은 위치면 공격자가 보는 방향. */
export function attackDirection(attacker: Readonly<Entity>, target: Readonly<Entity>, out: Vec3): Vec3 {
  const dx = target.position.x - attacker.position.x;
  const dz = target.position.z - attacker.position.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return set(out, Math.sin(attacker.yaw), 0, Math.cos(attacker.yaw));
  return set(out, dx / len, 0, dz / len);
}

/**
 * 백어택: 공격 방향과 피격자 정면이 이루는 각도가 backAttackHalfAngleDeg 이하.
 * (공격이 피격자의 등 쪽에서 앞쪽으로 날아온다 = 피격자가 공격 방향과 같은 쪽을 보고 있다)
 */
export function isBackAttack(attacker: Readonly<Entity>, target: Readonly<Entity>, scratch: Vec3): boolean {
  const dir = attackDirection(attacker, target, scratch);
  const attackYaw = Math.atan2(dir.x, dir.z);
  return Math.abs(angleDelta(target.yaw, attackYaw)) <= COMBAT_RULES.backAttackHalfAngleDeg * DEG;
}

/** 공격자가 가드/패리 가능한 정면 아크 안에 있는가 */
export function isGuardableFrom(target: Readonly<Entity>, attacker: Readonly<Entity>): boolean {
  return isInFrontArc(target, attacker.position, COMBAT_RULES.guardHalfAngleDeg * DEG);
}
