/**
 * 임시 무기 자세 (애니메이션이 없는 동안): 공격 진행도에 따라 칼이 호를 그린다.
 * 손잡이/칼끝 두 소켓의 월드 위치를 돌려주며, 물리의 무기 스윕과 렌더의 칼 메시가 같은 값을 쓴다.
 *
 * TODO(에셋): 믹사모 캐릭터가 들어오면 오른손 본(mixamorig:RightHand)에 붙인 손잡이/칼끝 소켓 위치로 교체한다.
 *
 * Babylon 비의존 (순수 함수) — sim 타입만 사용.
 */
import type { AttackInstance } from "../sim/combat/types";
import type { AttackId } from "../sim/data/attacks";
import { PLAYER_TIMELINES, type PlayerActionId } from "../sim/data/playerTimelines";
import type { Entity } from "../sim/entity";
import type { Vec3 } from "../sim/math/vec3";

export interface SwingArc {
  /** 정면 기준 시작/끝 각도 (도, +는 오른쪽) */
  yawFrom: number;
  yawTo: number;
  /** 발 기준 칼날 높이 (m) */
  heightFrom: number;
  heightTo: number;
  /** 캐릭터 중심에서 손잡이/칼끝까지 거리 (m) */
  reachHilt: number;
  reachTip: number;
}

const arc = (yawFrom: number, yawTo: number, heightFrom: number, heightTo: number, reachHilt: number, reachTip: number): SwingArc => ({
  yawFrom,
  yawTo,
  heightFrom,
  heightTo,
  reachHilt,
  reachTip,
});

/** 공격별 휘두름 궤적 (추정치) */
export const SWING_ARCS: Readonly<Record<AttackId, SwingArc>> = {
  attack_light_1: arc(70, -60, 1.25, 1.0, 0.4, 1.6), // 오른쪽 → 왼쪽 가로 베기
  attack_light_2: arc(-65, 65, 1.0, 1.3, 0.4, 1.6), // 왼쪽 → 오른쪽
  attack_light_3: arc(8, 0, 2.0, 0.3, 0.4, 1.7), // 위 → 아래 내려 베기
  attack_heavy: arc(5, 0, 2.2, 0.2, 0.4, 1.8),
  attack_run: arc(25, -25, 1.2, 1.1, 0.3, 1.8),
  hollow_slash: arc(55, -55, 1.3, 0.9, 0.3, 1.5),
  hollow_overhead: arc(6, 0, 2.1, 0.3, 0.3, 1.6),
  hound_bite: arc(20, -20, 0.7, 0.6, 0.2, 1.2),
  hound_lunge: arc(10, -10, 0.8, 0.6, 0.2, 1.3),
  ash_knight_sweep: arc(75, -70, 2.0, 1.1, 0.8, 3.2),
  ash_knight_slam: arc(4, 0, 4.0, 0.2, 0.8, 3.6),
  ash_knight_charge: arc(20, -20, 1.6, 1.3, 0.6, 3.0),
};

/** 타임라인이 없는 공격(적)의 판정 구간 추정 (공격 시작 기준 틱) */
const DEFAULT_HIT_WINDOW = { start: 12, end: 20 };

export function hitWindowOf(attack: AttackId): { start: number; end: number } {
  const tl = (PLAYER_TIMELINES as Partial<Record<string, (typeof PLAYER_TIMELINES)[PlayerActionId]>>)[attack];
  return tl?.hit ?? DEFAULT_HIT_WINDOW;
}

export interface WeaponPose {
  hilt: Vec3;
  tip: Vec3;
}

/**
 * 공격 인스턴스의 tick 시점 칼 위치. tick은 소수도 된다 (렌더 보간용).
 * 판정 구간 전에는 시작 자세(들어 올림), 후에는 끝 자세에 머문다.
 */
export function samplePlaceholderWeapon(attacker: Readonly<Entity>, instance: Readonly<AttackInstance>, tick: number, out: WeaponPose): WeaponPose {
  const a = SWING_ARCS[instance.attack];
  const w = hitWindowOf(instance.attack);
  const t = tick - instance.startTick;
  // 판정 구간은 [start, end) — 마지막 판정 틱(end-1)에 끝 자세에 도달하도록
  const u = Math.min(1, Math.max(0, (t - w.start) / Math.max(1, w.end - 1 - w.start)));
  const yaw = attacker.yaw + ((a.yawFrom + (a.yawTo - a.yawFrom) * u) * Math.PI) / 180;
  const h = a.heightFrom + (a.heightTo - a.heightFrom) * u;
  const sx = Math.sin(yaw);
  const sz = Math.cos(yaw);
  const p = attacker.position;
  out.hilt.x = p.x + sx * a.reachHilt;
  out.hilt.y = p.y + h;
  out.hilt.z = p.z + sz * a.reachHilt;
  out.tip.x = p.x + sx * a.reachTip;
  out.tip.y = p.y + h;
  out.tip.z = p.z + sz * a.reachTip;
  return out;
}

/** 공격 중이 아닐 때 칼을 드는 기본 자세 (오른쪽 허리, 칼끝은 앞 아래) — 렌더용 */
export function sampleIdleWeapon(attacker: Readonly<Entity>, out: WeaponPose): WeaponPose {
  const yaw = attacker.yaw;
  const sx = Math.sin(yaw);
  const sz = Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const p = attacker.position;
  out.hilt.x = p.x + rx * 0.35 + sx * 0.15;
  out.hilt.y = p.y + 0.95;
  out.hilt.z = p.z + rz * 0.35 + sz * 0.15;
  out.tip.x = p.x + rx * 0.45 + sx * 1.1;
  out.tip.y = p.y + 0.55;
  out.tip.z = p.z + rz * 0.45 + sz * 1.1;
  return out;
}
