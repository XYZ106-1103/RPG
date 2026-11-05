/**
 * 한 공격이 한 대상에 닿았을 때의 판정 (순수 규칙).
 *
 * 판정 순서:
 *  1. 무시: 자기 자신, 같은 팀(friendlyFire=false), 이미 사망, 이 공격에 이미 맞음
 *  2. i-frame(INVULNERABLE): 판정 무시. 히트 목록에 넣지 않으므로 무적이 끝난 뒤 같은 휘두름에 맞을 수는 있다
 *  3. 히트 목록에 추가 (이후 같은 공격으로는 다시 맞지 않음)
 *  4. 백어택이면 가드/패리 불가, 피해 배율 적용
 *  5. 정면 + 패리 윈도우 + 패리 가능 공격 → 패리 성공: 피해 없음, 공격자 경직, 공격 종료
 *  6. 정면 + 가드 → 스태미나로 피해 흡수. 스태미나가 바닥나면 가드 브레이크(가드한 쪽 경직)
 *  7. 그 외 → 피격: 체력/강인도 피해
 *
 * 이벤트 순서: hit/guard/parry → (death | stagger)
 */
import { ATTACKS } from "../data/attacks";
import { COMBAT_RULES } from "../data/combat";
import { FLAG, hasFlag, isDead, type Entity, type EntityId } from "../entity";
import type { EventSink } from "../events";
import { scale, vec3, type ReadonlyVec3, type Vec3 } from "../math/vec3";
import { applyDamage, applyHit, breakPoise, spendStamina } from "../stats";
import { attackDirection, isBackAttack, isGuardableFrom } from "./facing";
import type { AttackInstance, HitOutcome } from "./types";

export interface ResolveContext extends EventSink {
  /** 공격 인스턴스를 종료한다 (패리당함) */
  endAttack(instanceId: number): void;
}

const scratchDir = vec3();

function copyPoint(p: ReadonlyVec3): Vec3 {
  return vec3(p.x, p.y, p.z);
}

function emitDeathOrStagger(ctx: EventSink, target: Entity, killer: EntityId, killed: boolean, staggered: boolean): void {
  if (killed) ctx.emit("death", { entity: target.id, killer });
  else if (staggered) ctx.emit("stagger", { entity: target.id, durationTicks: target.staggerTicks });
}

export function resolveHit(
  ctx: ResolveContext,
  inst: AttackInstance,
  attacker: Entity,
  target: Entity,
  point: ReadonlyVec3,
): HitOutcome {
  if (target.id === attacker.id) return "ignored";
  if (!COMBAT_RULES.friendlyFire && target.team === attacker.team) return "ignored";
  if (isDead(target) || inst.hitList.has(target.id)) return "ignored";
  if (hasFlag(target, FLAG.INVULNERABLE)) return "dodged";

  inst.hitList.add(target.id);
  const def = ATTACKS[inst.attack];
  const backAttack = isBackAttack(attacker, target, scratchDir);
  const frontal = !backAttack && isGuardableFrom(target, attacker);
  const dir = attackDirection(attacker, target, scratchDir);

  // --- 패리 ---
  if (frontal && def.parryable && hasFlag(target, FLAG.PARRY)) {
    ctx.emit("parry", { parrier: target.id, attacker: attacker.id, attack: inst.attack, point: copyPoint(point) });
    ctx.endAttack(inst.id);
    breakPoise(attacker, ctx); // stagger 이벤트
    return "parry";
  }

  // --- 가드 ---
  if (frontal && hasFlag(target, FLAG.GUARDING)) {
    const broken = target.stamina - def.guardStaminaDamage <= 0;
    const staminaDamage = spendStamina(target, def.guardStaminaDamage, COMBAT_RULES.guardRegenDelaySeconds);
    const dmg = applyDamage(target, def.damage * (1 - COMBAT_RULES.guardAbsorb), attacker.id);
    let staggered = false;
    if (broken && !dmg.killed) {
      breakPoise(target); // 이벤트는 아래에서 순서대로 낸다
      staggered = true;
    }
    ctx.emit("guard", {
      attacker: attacker.id,
      target: target.id,
      attack: inst.attack,
      chipDamage: dmg.applied,
      staminaDamage,
      broken,
      point: copyPoint(point),
      hitstopFrames: def.hitstopFrames,
      knockback: scale(vec3(), dir, def.knockback * COMBAT_RULES.guardKnockbackMultiplier),
    });
    emitDeathOrStagger(ctx, target, attacker.id, dmg.killed, staggered);
    return broken ? "guard_break" : "guard";
  }

  // --- 피격 ---
  const dmgMult = backAttack ? COMBAT_RULES.backAttackDamageMultiplier : 1;
  const poiseMult = backAttack ? COMBAT_RULES.backAttackPoiseMultiplier : 1;
  const res = applyHit(target, def.damage * dmgMult, def.poiseDamage * poiseMult, attacker.id);
  ctx.emit("hit", {
    attacker: attacker.id,
    target: target.id,
    attack: inst.attack,
    damage: res.applied,
    point: copyPoint(point),
    backAttack,
    hitstopFrames: def.hitstopFrames,
    knockback: scale(vec3(), dir, def.knockback),
    staggered: res.staggered,
    killed: res.killed,
  });
  emitDeathOrStagger(ctx, target, attacker.id, res.killed, res.staggered);
  return "hit";
}
