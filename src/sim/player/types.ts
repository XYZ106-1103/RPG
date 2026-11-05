/**
 * 플레이어 행동 상태 머신의 상태 정의. PlayerState는 평범한 객체라 그대로 직렬화된다.
 */
import type { PlayerActionId } from "../data/playerTimelines";
import type { EntityId } from "../entity";

export const PLAYER_STATES = ["idle", "move", "sprint", "guard", "attack", "roll", "backstep", "drink", "stagger", "death"] as const;

export type PlayerStateId = (typeof PLAYER_STATES)[number];

/** 타임라인을 따라 진행되는 행동 상태 */
export const ACTION_STATES: readonly PlayerStateId[] = ["attack", "roll", "backstep", "drink"];

/** 입력이 요청하는 행동 (실행 시점의 맥락에 따라 실제 행동으로 해석: light → 콤보 몇 타째인지 등) */
export const PLAYER_VERBS = ["light", "heavy", "roll", "drink"] as const;

export type PlayerVerb = (typeof PLAYER_VERBS)[number];

export interface PlayerState {
  entityId: EntityId;
  state: PlayerStateId;
  /** 행동 상태일 때 진행 중인 행동, 그 외 null */
  action: PlayerActionId | null;
  /** 현재 상태에 들어온 뒤 지난 틱 (진입한 틱 = 0) */
  stateTick: number;
  /** 입력 버퍼에 예약된 다음 행동 */
  reserved: PlayerVerb | null;
  /** 진행 중인 공격 인스턴스 (combat) */
  attackInstance: number | null;
  /** 남은 회복약 */
  flasks: number;
  /** 구르기/백스텝 이동 방향 (yaw) — 이동 시스템이 루트 모션을 이 방향으로 적용한다 */
  actionYaw: number;
  /** 로코모션 목표 속도 (m/s, 월드 XZ) — 이동 시스템이 캐릭터 컨트롤러에 넘긴다 */
  moveX: number;
  moveZ: number;
}

export function isActionState(s: PlayerStateId): boolean {
  return ACTION_STATES.includes(s);
}
