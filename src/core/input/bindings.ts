/**
 * 기본 키 배치. 키보드는 KeyboardEvent.code(물리 키 위치 — 자판 배열과 무관), 마우스는 MouseEvent.button,
 * 게임패드는 W3C 표준 매핑(Gamepad.mapping === "standard") 인덱스를 쓴다.
 */
import type { ButtonAction } from "../../sim/inputFrame";

/** "dodge": 탭하면 roll, 길게 누르면 sprint (소울라이크 겸용 버튼) */
export type BindTarget = ButtonAction | "dodge";

export interface KeyboardMouseBindings {
  move: { forward: string[]; back: string[]; left: string[]; right: string[] };
  /** KeyboardEvent.code → 액션 */
  keys: Record<string, BindTarget>;
  /** MouseEvent.button → 액션 (0=좌, 1=휠, 2=우, 3/4=사이드) */
  mouseButtons: Record<number, BindTarget>;
}

export interface GamepadBindings {
  /** 표준 매핑 버튼 인덱스 → 액션 */
  buttons: Record<number, BindTarget>;
  /** 아날로그 값을 triggerThreshold로 판정할 버튼 (L2/R2) */
  analogButtons: number[];
  /** 이동 스틱 축 [x, y] */
  moveAxes: [number, number];
  /** 시점 스틱 축 [x, y] */
  lookAxes: [number, number];
}

export interface InputBindings {
  keyboardMouse: KeyboardMouseBindings;
  gamepad: GamepadBindings;
}

/** W3C 표준 게임패드 버튼 인덱스 (Xbox 표기 / PlayStation 표기) */
export const PAD = {
  A: 0, // ✕ (아래)
  B: 1, // ○ (오른쪽)
  X: 2, // □ (왼쪽)
  Y: 3, // △ (위)
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  SELECT: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

export const MOUSE = { LEFT: 0, MIDDLE: 1, RIGHT: 2 } as const;

export const DEFAULT_BINDINGS: Readonly<InputBindings> = {
  keyboardMouse: {
    move: { forward: ["KeyW"], back: ["KeyS"], left: ["KeyA"], right: ["KeyD"] },
    keys: {
      Space: "dodge", // 탭: 구르기 / 길게: 스프린트
      KeyQ: "lock_on",
      KeyF: "toggle_lantern",
      KeyE: "interact",
      KeyR: "use_item",
      // 가드는 기본 배치 요청에 없어 왼쪽 Shift에 둔다. (Ctrl은 Ctrl+W가 탭을 닫으므로 피함)
      ShiftLeft: "guard",
    },
    mouseButtons: {
      [MOUSE.LEFT]: "attack_light",
      [MOUSE.RIGHT]: "attack_heavy",
    },
  },
  gamepad: {
    buttons: {
      [PAD.R1]: "attack_light",
      [PAD.R2]: "attack_heavy",
      [PAD.L1]: "guard",
      [PAD.B]: "dodge",
      [PAD.R3]: "lock_on",
      [PAD.A]: "interact",
      [PAD.X]: "use_item",
      [PAD.Y]: "toggle_lantern",
    },
    analogButtons: [PAD.L2, PAD.R2],
    moveAxes: [0, 1],
    lookAxes: [2, 3],
  },
};
