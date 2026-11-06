/**
 * 장치 입력 → 액션 변환기 (순수 로직, DOM 비의존).
 *
 * DOM 이벤트/게임패드 폴링은 InputManager가 받아 이 클래스의 메서드로 넘긴다.
 * 그래서 키보드/마우스/게임패드 조합 동작을 Vitest로 검증할 수 있다.
 *
 * 두 가지 소비 경로:
 *  - consumeLook(): 렌더 프레임마다 카메라가 회전량(라디안)을 가져간다.
 *  - sampleFrame(): sim 틱마다 InputFrame 스냅샷을 만든다. 틱 사이의 눌림/뗌은 래치되어 유실되지 않는다.
 */
import { BUTTON, createInputFrame, quantizeInputFrame, type InputFrame } from "../../sim/inputFrame";
import type { BindTarget, InputBindings } from "./bindings";
import { applyRadialDeadzone, clampLength, type Vec2 } from "./deadzone";
import type { InputSettings } from "./settings";
import { TapHoldResolver } from "./tapHold";

/** DOM Gamepad과 구조적으로 호환되는 최소 스냅샷 (테스트에서 가짜 객체 주입) */
export interface GamepadSnapshot {
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  readonly axes: readonly number[];
}

export type InputDevice = "keyboardMouse" | "gamepad";

type DodgeSource = "keyboard" | "mouse" | "gamepad";

/** 바인딩 대상이 버튼 액션이면 그 비트, "dodge"면 0 */
function bitOf(target: BindTarget): number {
  return target === "dodge" ? 0 : BUTTON[target];
}

export class ActionMapper {
  private readonly heldKeys = new Set<string>();
  private readonly heldMouse = new Set<number>();
  private padMask = 0;
  private readonly padMove: Vec2 = { x: 0, y: 0 };
  private readonly padLookRate: Vec2 = { x: 0, y: 0 };

  private readonly dodge: Record<DodgeSource, TapHoldResolver>;
  private padDodgeDown = false;

  /** 현재 집계된 held 비트 */
  private held = 0;
  private pressedLatch = 0;
  private releasedLatch = 0;
  private readonly look: Vec2 = { x: 0, y: 0 };
  private readonly tmp: Vec2 = { x: 0, y: 0 };

  private lastDevice: InputDevice = "keyboardMouse";

  constructor(
    private bindings: InputBindings,
    private settings: InputSettings,
  ) {
    const ms = settings.dodgeHoldMs;
    this.dodge = { keyboard: new TapHoldResolver(ms), mouse: new TapHoldResolver(ms), gamepad: new TapHoldResolver(ms) };
  }

  /** 마지막으로 사용한 장치 (UI 버튼 아이콘 전환용) */
  get activeDevice(): InputDevice {
    return this.lastDevice;
  }

  setSettings(settings: InputSettings): void {
    this.settings = settings;
    for (const r of Object.values(this.dodge)) r.holdMs = settings.dodgeHoldMs;
  }

  setBindings(bindings: InputBindings): void {
    this.releaseAll();
    this.bindings = bindings;
  }

  // -------------------------------------------------------------------------
  // 키보드 / 마우스
  // -------------------------------------------------------------------------

  /** @returns 이 키가 바인딩되어 있는가 (호출자가 preventDefault 여부 판단) */
  keyDown(code: string, nowMs: number): boolean {
    if (!this.isBoundKey(code)) return false;
    this.lastDevice = "keyboardMouse";
    if (this.heldKeys.has(code)) return true; // 키 반복
    this.heldKeys.add(code);
    if (this.bindings.keyboardMouse.keys[code] === "dodge") this.dodge.keyboard.down(nowMs);
    this.refresh();
    return true;
  }

  keyUp(code: string, nowMs: number): boolean {
    if (!this.heldKeys.delete(code)) return this.isBoundKey(code);
    if (this.bindings.keyboardMouse.keys[code] === "dodge" && !this.anyHeldKeyBoundTo("dodge")) {
      this.resolveDodgeUp("keyboard", nowMs);
    }
    this.refresh();
    return true;
  }

  /** @returns 이 버튼이 바인딩되어 있는가 */
  mouseDown(button: number, nowMs: number): boolean {
    const target = this.bindings.keyboardMouse.mouseButtons[button];
    if (target === undefined) return false;
    this.lastDevice = "keyboardMouse";
    if (this.heldMouse.has(button)) return true;
    this.heldMouse.add(button);
    if (target === "dodge") this.dodge.mouse.down(nowMs);
    this.refresh();
    return true;
  }

  mouseUp(button: number, nowMs: number): boolean {
    const target = this.bindings.keyboardMouse.mouseButtons[button];
    if (!this.heldMouse.delete(button)) return target !== undefined;
    if (target === "dodge") this.resolveDodgeUp("mouse", nowMs);
    this.refresh();
    return true;
  }

  /** 포인터 락 상태의 마우스 이동량 (픽셀) */
  mouseMove(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.lastDevice = "keyboardMouse";
    const s = this.settings.mouseSensitivity;
    const inv = this.settings.invertY ? -1 : 1;
    this.look.x += dx * s;
    this.look.y += -dy * s * inv;
  }

  // -------------------------------------------------------------------------
  // 게임패드 (폴링)
  // -------------------------------------------------------------------------

  /** 매 렌더 프레임 폴링 결과를 넘긴다. 연결 해제 시 null */
  setGamepad(pad: GamepadSnapshot | null, nowMs: number): void {
    const gb = this.bindings.gamepad;
    let mask = 0;
    let dodgeDown = false;
    if (pad) {
      for (const [indexStr, target] of Object.entries(gb.buttons)) {
        const index = Number(indexStr);
        const b = pad.buttons[index];
        if (!b) continue;
        const down = gb.analogButtons.includes(index) ? b.value >= this.settings.triggerThreshold : b.pressed;
        if (!down) continue;
        if (target === "dodge") dodgeDown = true;
        else mask |= bitOf(target);
      }
      const s = this.settings;
      applyRadialDeadzone(
        pad.axes[gb.moveAxes[0]] ?? 0,
        -(pad.axes[gb.moveAxes[1]] ?? 0), // 스틱 위 = -1 → 앞 = +y
        s.stickDeadzoneInner,
        s.stickDeadzoneOuter,
        this.padMove,
      );
      applyRadialDeadzone(
        pad.axes[gb.lookAxes[0]] ?? 0,
        -(pad.axes[gb.lookAxes[1]] ?? 0),
        s.stickDeadzoneInner,
        s.stickDeadzoneOuter,
        this.padLookRate,
        s.gamepadLookExponent,
      );
      if (mask !== 0 || dodgeDown || this.padMove.x !== 0 || this.padMove.y !== 0 || this.padLookRate.x !== 0 || this.padLookRate.y !== 0) {
        this.lastDevice = "gamepad";
      }
    } else {
      this.padMove.x = this.padMove.y = 0;
      this.padLookRate.x = this.padLookRate.y = 0;
    }

    if (dodgeDown && !this.padDodgeDown) this.dodge.gamepad.down(nowMs);
    else if (!dodgeDown && this.padDodgeDown) {
      if (pad) this.resolveDodgeUp("gamepad", nowMs);
      else this.dodge.gamepad.cancel(); // 연결 해제: 구르기를 발동하지 않는다
    }
    this.padDodgeDown = dodgeDown;
    this.padMask = mask;
    this.refresh();
  }

  // -------------------------------------------------------------------------
  // 프레임 처리
  // -------------------------------------------------------------------------

  /** 매 렌더 프레임: 탭/홀드 타이머와 게임패드 시점 회전을 반영한다. */
  update(nowMs: number, frameSeconds: number): void {
    let changed = false;
    for (const r of Object.values(this.dodge)) changed = r.update(nowMs) || changed;
    if (changed) this.refresh();

    if (frameSeconds > 0 && (this.padLookRate.x !== 0 || this.padLookRate.y !== 0)) {
      const k = this.settings.gamepadLookSpeed * frameSeconds;
      const inv = this.settings.invertY ? -1 : 1;
      this.look.x += this.padLookRate.x * k;
      this.look.y += this.padLookRate.y * k * inv;
    }
  }

  /** 누적된 시점 회전량(라디안)을 out에 담고 비운다. x=yaw(+오른쪽), y=pitch(+위) */
  consumeLook(out: Vec2): Vec2 {
    out.x = this.look.x;
    out.y = this.look.y;
    this.look.x = 0;
    this.look.y = 0;
    return out;
  }

  /** 현재 이동 입력 (키보드와 스틱 중 크기가 큰 쪽) */
  getMove(out: Vec2): Vec2 {
    const km = this.bindings.keyboardMouse.move;
    const kx = (this.anyHeld(km.right) ? 1 : 0) - (this.anyHeld(km.left) ? 1 : 0);
    const ky = (this.anyHeld(km.forward) ? 1 : 0) - (this.anyHeld(km.back) ? 1 : 0);
    this.tmp.x = kx;
    this.tmp.y = ky;
    clampLength(this.tmp);
    const kMag = Math.hypot(this.tmp.x, this.tmp.y);
    const pMag = Math.hypot(this.padMove.x, this.padMove.y);
    const src = pMag > kMag ? this.padMove : this.tmp;
    out.x = src.x;
    out.y = src.y;
    return out;
  }

  /**
   * sim 틱마다 호출: 현재 상태 + 직전 샘플 이후 래치된 눌림/뗌을 InputFrame에 담고 래치를 비운다.
   * 결과는 양자화되어 네트워크 왕복 값과 동일하다.
   */
  sampleFrame(tick: number, viewYaw: number, out: InputFrame = createInputFrame(), lockTarget = 0): InputFrame {
    this.getMove(this.tmp);
    out.tick = tick;
    out.moveX = this.tmp.x;
    out.moveY = this.tmp.y;
    out.viewYaw = viewYaw;
    out.held = this.held;
    out.pressed = this.pressedLatch;
    out.released = this.releasedLatch;
    out.lockTarget = lockTarget;
    this.pressedLatch = 0;
    this.releasedLatch = 0;
    return quantizeInputFrame(out);
  }

  /**
   * 모든 입력을 뗀 것으로 처리한다 (창 포커스 상실, 포인터 락 해제, 바인딩 변경).
   * 누르고 있던 액션은 released로 보고되며, 구르기 탭은 발동하지 않는다.
   */
  releaseAll(): void {
    this.heldKeys.clear();
    this.heldMouse.clear();
    this.padMask = 0;
    this.padDodgeDown = false;
    for (const r of Object.values(this.dodge)) r.cancel();
    this.look.x = this.look.y = 0;
    this.refresh();
  }

  /** 마우스 버튼만 뗀 것으로 처리 (포인터 락 해제 시 키보드는 유지) */
  releaseMouse(): void {
    if (this.heldMouse.size === 0) return;
    this.heldMouse.clear();
    this.dodge.mouse.cancel();
    this.refresh();
  }

  // -------------------------------------------------------------------------

  private resolveDodgeUp(source: DodgeSource, nowMs: number): void {
    if (this.dodge[source].up(nowMs) === "tap") {
      // 구르기는 순간 입력: 같은 틱에 눌림+뗌으로 보고 (held에는 남지 않음)
      this.pressedLatch |= BUTTON.roll;
      this.releasedLatch |= BUTTON.roll;
    }
  }

  /** 장치별 상태를 합쳐 held를 갱신하고, 변화한 비트를 눌림/뗌 래치에 쌓는다. */
  private refresh(): void {
    const km = this.bindings.keyboardMouse;
    let mask = this.padMask;
    for (const code of this.heldKeys) {
      const t = km.keys[code];
      if (t !== undefined) mask |= bitOf(t);
    }
    for (const b of this.heldMouse) {
      const t = km.mouseButtons[b];
      if (t !== undefined) mask |= bitOf(t);
    }
    if (this.dodge.keyboard.isHolding || this.dodge.mouse.isHolding || this.dodge.gamepad.isHolding) mask |= BUTTON.sprint;

    this.pressedLatch |= mask & ~this.held;
    this.releasedLatch |= this.held & ~mask;
    this.held = mask;
  }

  private isBoundKey(code: string): boolean {
    const km = this.bindings.keyboardMouse;
    if (km.keys[code] !== undefined) return true;
    return km.move.forward.includes(code) || km.move.back.includes(code) || km.move.left.includes(code) || km.move.right.includes(code);
  }

  private anyHeld(codes: readonly string[]): boolean {
    for (const c of codes) if (this.heldKeys.has(c)) return true;
    return false;
  }

  private anyHeldKeyBoundTo(target: BindTarget): boolean {
    for (const code of this.heldKeys) if (this.bindings.keyboardMouse.keys[code] === target) return true;
    return false;
  }
}
