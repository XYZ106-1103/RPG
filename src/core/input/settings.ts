/**
 * 입력 설정 (감도, 데드존 등). 옵션 메뉴에서 바꿀 수 있는 값들.
 */
export interface InputSettings {
  /** 마우스 감도: 픽셀당 회전량 (라디안) */
  mouseSensitivity: number;
  /** 게임패드 오른쪽 스틱을 끝까지 밀었을 때 회전 속도 (라디안/초) */
  gamepadLookSpeed: number;
  /** 오른쪽 스틱 응답 곡선 지수 (1=선형, 클수록 미세 조준이 쉬움) */
  gamepadLookExponent: number;
  /** 세로 시점 반전 */
  invertY: boolean;
  /** 스틱 안쪽 데드존 (0~1) — 이 이하 기울기는 0으로 */
  stickDeadzoneInner: number;
  /** 스틱 바깥쪽 데드존 (0~1) — 이 이상 기울기는 1로 */
  stickDeadzoneOuter: number;
  /** 아날로그 트리거(R2/L2)를 눌림으로 보는 임계값 (0~1) */
  triggerThreshold: number;
  /** 구르기/스프린트 겸용 버튼: 이 시간(ms) 안에 떼면 구르기, 넘게 누르면 스프린트 */
  dodgeHoldMs: number;
}

export const DEFAULT_INPUT_SETTINGS: Readonly<InputSettings> = {
  mouseSensitivity: 0.0025,
  gamepadLookSpeed: 3.2,
  gamepadLookExponent: 1.6,
  invertY: false,
  stickDeadzoneInner: 0.15,
  stickDeadzoneOuter: 0.95,
  triggerThreshold: 0.35,
  dodgeHoldMs: 280,
};
