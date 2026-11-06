/**
 * 플레이어 이동/아이템 수치.
 */
export const PLAYER_MOVEMENT = {
  /** 스틱을 살짝 기울였을 때 (m/s) */
  walkSpeed: 2.0,
  runSpeed: 4.6,
  sprintSpeed: 6.8,
  /** 가드 중 이동 속도 */
  guardSpeed: 1.6,
  /** 이 기울기 미만이면 걷기 */
  walkThreshold: 0.5,
  /** 이 기울기 미만이면 이동 입력 없음 (구르기 대신 백스텝) */
  moveDeadzone: 0.2,
  /** 이동 중 회전 속도 (rad/s) */
  turnRate: 12,
  /** 락온 유지 최대 거리 (m) — 클라이언트가 보낸 대상이 이보다 멀면 무시 */
  lockOnRange: 25,
} as const;

export const PLAYER_ITEMS = {
  /** 회복약 최대 개수 */
  maxFlasks: 4,
  /** 회복약 한 번에 회복하는 체력 (최대 체력 대비) */
  flaskHealFraction: 0.4,
} as const;
