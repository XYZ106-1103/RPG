/**
 * sim이 매 틱 읽는 입력 스냅샷 (InputFrame).
 *
 * - 장치(키보드/마우스/게임패드)와 무관한 "액션" 단위로만 표현한다.
 * - 버튼은 비트마스크: held(현재 누르고 있음), pressed/released(직전 틱 이후 눌림/뗌 발생).
 *   틱 사이에 짧게 눌렀다 뗀 입력도 pressed로 남는다.
 * - 멀티플레이에서 그대로 서버로 보낼 수 있도록 18바이트 고정 크기로 직렬화한다.
 *   클라이언트도 quantizeInputFrame()을 거친 값으로 시뮬레이션해야 서버와 결과가 같다(결정성).
 *
 * look(카메라 회전)은 렌더 프레임 단위로 카메라가 직접 소비하고, sim에는 결과인 viewYaw만 넘긴다.
 */

/** 버튼 액션 비트 (최대 16개 — 직렬화가 u16) */
export const BUTTON = {
  attack_light: 1 << 0,
  attack_heavy: 1 << 1,
  roll: 1 << 2,
  guard: 1 << 3,
  lock_on: 1 << 4,
  use_item: 1 << 5,
  toggle_lantern: 1 << 6,
  interact: 1 << 7,
  sprint: 1 << 8,
} as const;

export type ButtonAction = keyof typeof BUTTON;

export const BUTTON_ACTIONS = Object.keys(BUTTON) as ButtonAction[];

export interface InputFrame {
  /** 이 입력이 적용될 sim 틱 */
  tick: number;
  /** 이동 입력 (스틱 공간: x=오른쪽, y=앞). 크기 0~1 */
  moveX: number;
  moveY: number;
  /** 카메라 yaw (라디안, [0, 2π)). sim이 이동 방향을 월드로 바꾸고 락온 대상을 고르는 데 쓴다 */
  viewYaw: number;
  /** 현재 누르고 있는 버튼 */
  held: number;
  /** 직전 틱 이후 눌림이 발생한 버튼 */
  pressed: number;
  /** 직전 틱 이후 뗌이 발생한 버튼 */
  released: number;
  /**
   * 락온 대상 엔티티 id (0 = 없음). 대상 선택은 클라이언트 카메라가 하고(화면 중앙/거리 기준),
   * sim은 유효성(살아 있는 적, 거리 이내)만 확인해 그 대상을 바라본다.
   */
  lockTarget: number;
}

export function createInputFrame(): InputFrame {
  return { tick: 0, moveX: 0, moveY: 0, viewYaw: 0, held: 0, pressed: 0, released: 0, lockTarget: 0 };
}

export function copyInputFrame(out: InputFrame, src: Readonly<InputFrame>): InputFrame {
  out.tick = src.tick;
  out.moveX = src.moveX;
  out.moveY = src.moveY;
  out.viewYaw = src.viewYaw;
  out.held = src.held;
  out.pressed = src.pressed;
  out.released = src.released;
  out.lockTarget = src.lockTarget;
  return out;
}

export function isHeld(frame: Readonly<InputFrame>, action: ButtonAction): boolean {
  return (frame.held & BUTTON[action]) !== 0;
}

export function wasPressed(frame: Readonly<InputFrame>, action: ButtonAction): boolean {
  return (frame.pressed & BUTTON[action]) !== 0;
}

export function wasReleased(frame: Readonly<InputFrame>, action: ButtonAction): boolean {
  return (frame.released & BUTTON[action]) !== 0;
}

// ---------------------------------------------------------------------------
// 양자화 / 직렬화
// ---------------------------------------------------------------------------

export const INPUT_FRAME_BYTES = 18;

const TAU = Math.PI * 2;
const MOVE_SCALE = 127;
const YAW_STEPS = 65536;
const BUTTON_MASK = 0xffff;

function quantizeMove(v: number): number {
  const c = Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0));
  return Math.round(c * MOVE_SCALE);
}

function quantizeYaw(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  const wrapped = ((yaw % TAU) + TAU) % TAU;
  return Math.round((wrapped / TAU) * YAW_STEPS) % YAW_STEPS;
}

/** 네트워크 왕복 후와 같은 값이 되도록 제자리에서 양자화한다. */
export function quantizeInputFrame(frame: InputFrame): InputFrame {
  frame.tick = frame.tick >>> 0;
  frame.moveX = quantizeMove(frame.moveX) / MOVE_SCALE;
  frame.moveY = quantizeMove(frame.moveY) / MOVE_SCALE;
  frame.viewYaw = (quantizeYaw(frame.viewYaw) / YAW_STEPS) * TAU;
  frame.held &= BUTTON_MASK;
  frame.pressed &= BUTTON_MASK;
  frame.released &= BUTTON_MASK;
  frame.lockTarget = Number.isFinite(frame.lockTarget) ? frame.lockTarget >>> 0 : 0;
  return frame;
}

/**
 * 레이아웃 (리틀 엔디언, 14바이트):
 *   u32 tick | i8 moveX | i8 moveY | u16 viewYaw | u16 held | u16 pressed | u16 released | u32 lockTarget
 */
export function encodeInputFrame(frame: Readonly<InputFrame>, view: DataView, offset = 0): number {
  view.setUint32(offset, frame.tick >>> 0, true);
  view.setInt8(offset + 4, quantizeMove(frame.moveX));
  view.setInt8(offset + 5, quantizeMove(frame.moveY));
  view.setUint16(offset + 6, quantizeYaw(frame.viewYaw), true);
  view.setUint16(offset + 8, frame.held & BUTTON_MASK, true);
  view.setUint16(offset + 10, frame.pressed & BUTTON_MASK, true);
  view.setUint16(offset + 12, frame.released & BUTTON_MASK, true);
  view.setUint32(offset + 14, Number.isFinite(frame.lockTarget) ? frame.lockTarget >>> 0 : 0, true);
  return offset + INPUT_FRAME_BYTES;
}

export function decodeInputFrame(view: DataView, offset = 0, out: InputFrame = createInputFrame()): InputFrame {
  out.tick = view.getUint32(offset, true);
  out.moveX = view.getInt8(offset + 4) / MOVE_SCALE;
  out.moveY = view.getInt8(offset + 5) / MOVE_SCALE;
  out.viewYaw = (view.getUint16(offset + 6, true) / YAW_STEPS) * TAU;
  out.held = view.getUint16(offset + 8, true);
  out.pressed = view.getUint16(offset + 10, true);
  out.released = view.getUint16(offset + 12, true);
  out.lockTarget = view.getUint32(offset + 14, true);
  return out;
}
