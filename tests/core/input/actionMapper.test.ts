import { beforeEach, describe, expect, it } from "vitest";
import { ActionMapper, KEYBOARD_WALK_MAGNITUDE, type GamepadSnapshot } from "../../../src/core/input/actionMapper";
import { DEFAULT_BINDINGS, MOUSE, PAD } from "../../../src/core/input/bindings";
import { DEFAULT_INPUT_SETTINGS, type InputSettings } from "../../../src/core/input/settings";
import { PLAYER_MOVEMENT } from "../../../src/sim/data/player";
import { BUTTON, type InputFrame } from "../../../src/sim/inputFrame";

const HOLD_MS = DEFAULT_INPUT_SETTINGS.dodgeHoldMs;

function makePad(opts: { buttons?: Record<number, number>; axes?: number[] } = {}): GamepadSnapshot {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const v = opts.buttons?.[i] ?? 0;
    return { pressed: v > 0.5, value: v };
  });
  return { buttons, axes: opts.axes ?? [0, 0, 0, 0] };
}

let tick = 0;
function sample(m: ActionMapper, viewYaw = 0): InputFrame {
  return m.sampleFrame(++tick, viewYaw);
}

function mapper(settings: Partial<InputSettings> = {}): ActionMapper {
  return new ActionMapper(DEFAULT_BINDINGS, { ...DEFAULT_INPUT_SETTINGS, ...settings });
}

beforeEach(() => {
  tick = 0;
});

describe("ActionMapper — 키보드/마우스", () => {
  it("WASD 이동: 대각선은 길이 1로 정규화, 반대 키는 상쇄", () => {
    const m = mapper();
    m.keyDown("KeyW", 0);
    m.keyDown("KeyD", 0);
    let f = sample(m);
    expect(Math.hypot(f.moveX, f.moveY)).toBeCloseTo(1, 1);
    expect(f.moveX).toBeGreaterThan(0);
    expect(f.moveY).toBeGreaterThan(0);
    m.keyDown("KeyS", 0);
    m.keyUp("KeyD", 0);
    f = sample(m);
    expect(f.moveX).toBe(0);
    expect(f.moveY).toBe(0);
    m.keyDown("KeyA", 0);
    expect(sample(m).moveX).toBe(-1);
  });

  it("Z를 누르고 있으면 키보드 이동이 걷기 세기(데드존 < 0.4 < 걷기 기준)로 줄고, 버튼 비트는 없다", () => {
    const m = mapper();
    m.keyDown("KeyW", 0);
    expect(sample(m).moveY).toBeCloseTo(1, 2);
    expect(m.keyDown("KeyZ", 0)).toBe(true); // 바인딩됨 → preventDefault
    let f = sample(m);
    expect(f.moveY).toBeCloseTo(KEYBOARD_WALK_MAGNITUDE, 1);
    expect(f.moveY).toBeGreaterThan(PLAYER_MOVEMENT.moveDeadzone);
    expect(f.moveY).toBeLessThan(PLAYER_MOVEMENT.walkThreshold);
    expect(f.held).toBe(0);
    m.keyDown("KeyD", 0); // 대각선도 같은 세기
    f = sample(m);
    expect(Math.hypot(f.moveX, f.moveY)).toBeCloseTo(KEYBOARD_WALK_MAGNITUDE, 1);
    m.keyUp("KeyZ", 0);
    expect(Math.hypot(sample(m).moveX, sample(m).moveY)).toBeCloseTo(1, 1);
  });

  it("기본 키 배치: 좌클릭 약공, 우클릭 강공, Q 락온, F 등불, E 상호작용, R 아이템, Shift 가드", () => {
    const m = mapper();
    m.mouseDown(MOUSE.LEFT, 0);
    m.mouseDown(MOUSE.RIGHT, 0);
    for (const k of ["KeyQ", "KeyF", "KeyE", "KeyR", "ShiftLeft"]) m.keyDown(k, 0);
    const f = sample(m);
    const expected =
      BUTTON.attack_light | BUTTON.attack_heavy | BUTTON.lock_on | BUTTON.toggle_lantern | BUTTON.interact | BUTTON.use_item | BUTTON.guard;
    expect(f.held).toBe(expected);
    expect(f.pressed).toBe(expected);
  });

  it("눌림은 한 번만 pressed로 보고되고, held는 유지, 떼면 released", () => {
    const m = mapper();
    m.mouseDown(MOUSE.LEFT, 0);
    let f = sample(m);
    expect(f.pressed & BUTTON.attack_light).toBeTruthy();
    f = sample(m);
    expect(f.pressed).toBe(0);
    expect(f.held & BUTTON.attack_light).toBeTruthy();
    m.mouseUp(MOUSE.LEFT, 10);
    f = sample(m);
    expect(f.held).toBe(0);
    expect(f.released & BUTTON.attack_light).toBeTruthy();
    expect(sample(m).released).toBe(0);
  });

  it("틱 사이에 짧게 눌렀다 뗀 입력도 유실되지 않는다", () => {
    const m = mapper();
    m.mouseDown(MOUSE.LEFT, 0);
    m.mouseUp(MOUSE.LEFT, 5);
    const f = sample(m);
    expect(f.pressed & BUTTON.attack_light).toBeTruthy();
    expect(f.released & BUTTON.attack_light).toBeTruthy();
    expect(f.held).toBe(0);
  });

  it("키 반복(auto-repeat)은 추가 눌림을 만들지 않는다", () => {
    const m = mapper();
    m.keyDown("KeyQ", 0);
    sample(m);
    m.keyDown("KeyQ", 30);
    m.keyDown("KeyQ", 60);
    expect(sample(m).pressed).toBe(0);
  });

  it("바인딩된 키만 true를 반환한다 (preventDefault 판단)", () => {
    const m = mapper();
    expect(m.keyDown("KeyW", 0)).toBe(true);
    expect(m.keyDown("Space", 0)).toBe(true);
    expect(m.keyDown("KeyX", 0)).toBe(false);
    expect(m.keyUp("KeyX", 0)).toBe(false);
    expect(m.mouseDown(MOUSE.MIDDLE, 0)).toBe(false);
  });

  it("마우스 시점: 감도 적용, 아래로 움직이면 pitch 감소, consumeLook은 누적을 비운다", () => {
    const m = mapper({ mouseSensitivity: 0.01 });
    m.mouseMove(10, 0);
    m.mouseMove(5, 20);
    const look = m.consumeLook({ x: 0, y: 0 });
    expect(look.x).toBeCloseTo(0.15, 9);
    expect(look.y).toBeCloseTo(-0.2, 9);
    expect(m.consumeLook({ x: 1, y: 1 })).toEqual({ x: 0, y: 0 });
  });

  it("invertY는 세로 시점을 뒤집는다", () => {
    const m = mapper({ mouseSensitivity: 0.01, invertY: true });
    m.mouseMove(0, 10);
    expect(m.consumeLook({ x: 0, y: 0 }).y).toBeCloseTo(0.1, 9);
  });
});

describe("ActionMapper — Space 구르기/스프린트 겸용", () => {
  it("짧게 누르면 뗄 때 구르기 (held에는 남지 않음)", () => {
    const m = mapper();
    m.keyDown("Space", 0);
    m.update(100, 0.1);
    expect(sample(m).pressed & BUTTON.roll).toBe(0); // 누르는 순간에는 아직 판정 전
    m.keyUp("Space", 150);
    const f = sample(m);
    expect(f.pressed & BUTTON.roll).toBeTruthy();
    expect(f.released & BUTTON.roll).toBeTruthy(); // 순간 입력: 눌림과 뗌이 같은 틱
    expect(f.held & BUTTON.roll).toBe(0);
    expect(f.held & BUTTON.sprint).toBe(0);
  });

  it("포커스를 잃은 뒤 다시 짧게 누르면 정상적으로 구르기 (이전 눌림 시각이 남지 않음)", () => {
    const m = mapper();
    m.keyDown("Space", 0);
    m.releaseAll(); // Space를 누른 채 창 포커스 상실 → keyup이 오지 않음
    sample(m);
    m.keyDown("Space", 5000);
    m.update(5050, 0.016);
    m.keyUp("Space", 5100);
    const f = sample(m);
    expect(f.pressed & BUTTON.roll).toBeTruthy();
    expect(f.held & BUTTON.sprint).toBe(0);
  });

  it("길게 누르면 스프린트, 떼도 구르기가 나가지 않는다", () => {
    const m = mapper();
    m.keyDown("Space", 0);
    m.update(HOLD_MS, 0.016);
    let f = sample(m);
    expect(f.held & BUTTON.sprint).toBeTruthy();
    expect(f.pressed & BUTTON.sprint).toBeTruthy();
    m.update(2000, 0.016);
    expect(sample(m).held & BUTTON.sprint).toBeTruthy();
    m.keyUp("Space", 2100);
    f = sample(m);
    expect(f.held & BUTTON.sprint).toBe(0);
    expect(f.released & BUTTON.sprint).toBeTruthy();
    expect(f.pressed & BUTTON.roll).toBe(0);
  });

  it("프레임이 끊겨 update가 없었어도 홀드 시간을 넘겨 떼면 구르기가 아니다", () => {
    const m = mapper();
    m.keyDown("Space", 0);
    m.keyUp("Space", HOLD_MS + 50);
    expect(sample(m).pressed & BUTTON.roll).toBe(0);
  });
});

describe("ActionMapper — 게임패드 (표준 매핑, 소울라이크 배치)", () => {
  it("R1 약공, R2 강공(아날로그 임계값), L1 가드, R3 락온, A 상호작용, X 아이템, Y 등불", () => {
    const m = mapper({ triggerThreshold: 0.35 });
    m.setGamepad(makePad({ buttons: { [PAD.R1]: 1, [PAD.R2]: 0.3 } }), 0);
    let f = sample(m);
    expect(f.held).toBe(BUTTON.attack_light); // R2 0.3 < 0.35
    m.setGamepad(makePad({ buttons: { [PAD.R2]: 0.4, [PAD.L1]: 1, [PAD.R3]: 1, [PAD.A]: 1, [PAD.X]: 1, [PAD.Y]: 1 } }), 16);
    f = sample(m);
    expect(f.held).toBe(BUTTON.attack_heavy | BUTTON.guard | BUTTON.lock_on | BUTTON.interact | BUTTON.use_item | BUTTON.toggle_lantern);
    expect(f.released & BUTTON.attack_light).toBeTruthy();
  });

  it("B: 탭하면 구르기, 길게 누르면 스프린트", () => {
    const m = mapper();
    m.setGamepad(makePad({ buttons: { [PAD.B]: 1 } }), 0);
    m.setGamepad(makePad(), 120);
    expect(sample(m).pressed & BUTTON.roll).toBeTruthy();

    m.setGamepad(makePad({ buttons: { [PAD.B]: 1 } }), 1000);
    m.update(1000 + HOLD_MS, 0.016);
    expect(sample(m).held & BUTTON.sprint).toBeTruthy();
    m.setGamepad(makePad(), 3000);
    const f = sample(m);
    expect(f.held & BUTTON.sprint).toBe(0);
    expect(f.pressed & BUTTON.roll).toBe(0);
  });

  it("B를 누른 채 패드 연결이 끊기면 구르기를 발동하지 않는다", () => {
    const m = mapper();
    m.setGamepad(makePad({ buttons: { [PAD.B]: 1 } }), 0);
    m.setGamepad(null, 50);
    expect(sample(m).pressed & BUTTON.roll).toBe(0);
  });

  it("왼쪽 스틱 이동: 데드존 적용, 스틱 위(-1)는 앞(+y)", () => {
    const m = mapper({ stickDeadzoneInner: 0.15, stickDeadzoneOuter: 0.95 });
    m.setGamepad(makePad({ axes: [0.1, -0.05, 0, 0] }), 0);
    let f = sample(m);
    expect(f.moveX).toBe(0);
    expect(f.moveY).toBe(0);
    m.setGamepad(makePad({ axes: [0, -1, 0, 0] }), 16);
    f = sample(m);
    expect(f.moveY).toBe(1);
    m.setGamepad(makePad({ axes: [0.55, 0, 0, 0] }), 32);
    expect(sample(m).moveX).toBeCloseTo(0.5, 1);
  });

  it("오른쪽 스틱 시점: 회전 속도 × 프레임 시간만큼 누적, 데드존 안쪽은 0", () => {
    const m = mapper({ gamepadLookSpeed: 2, gamepadLookExponent: 1 });
    m.setGamepad(makePad({ axes: [0, 0, 1, 0] }), 0);
    m.update(0, 0.5);
    m.update(16, 0.25);
    expect(m.consumeLook({ x: 0, y: 0 }).x).toBeCloseTo(1.5, 9);
    m.setGamepad(makePad({ axes: [0, 0, 0.05, 0.05] }), 32);
    m.update(32, 1);
    expect(m.consumeLook({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("키보드와 패드가 같은 액션을 누르면, 한쪽을 떼도 held 유지 (뗌 이벤트 없음)", () => {
    const m = mapper();
    m.keyDown("ShiftLeft", 0);
    m.setGamepad(makePad({ buttons: { [PAD.L1]: 1 } }), 0);
    sample(m);
    m.keyUp("ShiftLeft", 10);
    const f = sample(m);
    expect(f.held & BUTTON.guard).toBeTruthy();
    expect(f.released).toBe(0);
  });

  it("이동은 키보드와 스틱 중 크기가 큰 쪽", () => {
    const m = mapper();
    m.setGamepad(makePad({ axes: [0.5, 0, 0, 0] }), 0);
    m.keyDown("KeyW", 0);
    const f = sample(m);
    expect(f.moveY).toBe(1);
    expect(f.moveX).toBe(0);
  });

  it("마지막으로 사용한 장치를 추적한다", () => {
    const m = mapper();
    expect(m.activeDevice).toBe("keyboardMouse");
    m.setGamepad(makePad({ buttons: { [PAD.A]: 1 } }), 0);
    expect(m.activeDevice).toBe("gamepad");
    m.setGamepad(makePad(), 16); // 아무것도 안 누른 폴링으로는 바뀌지 않는다
    expect(m.activeDevice).toBe("gamepad");
    m.mouseMove(3, 0);
    expect(m.activeDevice).toBe("keyboardMouse");
  });
});

describe("ActionMapper — 스냅샷/포커스", () => {
  it("sampleFrame은 락온 대상 id를 담는다 (기본 0)", () => {
    const m = mapper();
    expect(m.sampleFrame(1, 0).lockTarget).toBe(0);
    expect(m.sampleFrame(2, 0, undefined, 7).lockTarget).toBe(7);
  });

  it("sampleFrame은 tick/viewYaw를 담고 양자화된 값을 낸다", () => {
    const m = mapper();
    m.setGamepad(makePad({ axes: [0.3333, 0, 0, 0] }), 0);
    const f = m.sampleFrame(42, 1.0);
    expect(f.tick).toBe(42);
    expect(f.viewYaw).toBeCloseTo(1.0, 4);
    expect(Number.isInteger(f.moveX * 127)).toBe(true);
  });

  it("releaseAll: 누르던 액션은 released로 보고하고, 구르기 탭은 발동하지 않는다", () => {
    const m = mapper();
    m.keyDown("KeyW", 0);
    m.keyDown("ShiftLeft", 0);
    m.keyDown("Space", 0);
    m.mouseMove(50, 50);
    sample(m);
    m.releaseAll();
    const f = sample(m);
    expect(f.held).toBe(0);
    expect(f.moveY).toBe(0);
    expect(f.released & BUTTON.guard).toBeTruthy();
    expect(f.pressed & BUTTON.roll).toBe(0);
    expect(m.consumeLook({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    // 포커스 복귀 후 키 반복 keyup이 늦게 와도 문제없다
    expect(() => m.keyUp("Space", 100)).not.toThrow();
    expect(sample(m).pressed & BUTTON.roll).toBe(0);
  });

  it("releaseMouse는 마우스 버튼만 뗀다 (포인터 락 해제)", () => {
    const m = mapper();
    m.keyDown("ShiftLeft", 0);
    m.mouseDown(MOUSE.LEFT, 0);
    sample(m);
    m.releaseMouse();
    const f = sample(m);
    expect(f.held).toBe(BUTTON.guard);
    expect(f.released).toBe(BUTTON.attack_light);
  });

  it("바인딩을 바꿀 수 있다 (예: 구르기를 마우스 사이드 버튼으로)", () => {
    const m = mapper();
    m.setBindings({
      ...DEFAULT_BINDINGS,
      keyboardMouse: { ...DEFAULT_BINDINGS.keyboardMouse, mouseButtons: { 3: "dodge", [MOUSE.LEFT]: "attack_light" } },
    });
    m.mouseDown(3, 0);
    m.mouseUp(3, 50);
    expect(sample(m).pressed & BUTTON.roll).toBeTruthy();
  });
});
