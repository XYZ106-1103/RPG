/**
 * 브라우저 입력 연결 (DOM 이벤트, 포인터 락, 게임패드 폴링). Babylon 비의존.
 * 실제 변환 로직은 ActionMapper가 담당하고, 여기서는 이벤트를 받아 넘기기만 한다.
 *
 * 사용:
 *   const input = new InputManager(canvas);
 *   // 렌더 프레임마다
 *   input.update(now, frameSeconds); camera.rotate(input.consumeLook(tmp));
 *   // sim 틱마다
 *   const frame = input.sampleFrame(tick, camera.yaw);
 */
import type { InputFrame } from "../../sim/inputFrame";
import { ActionMapper, type GamepadSnapshot, type InputDevice } from "./actionMapper";
import { DEFAULT_BINDINGS, type InputBindings } from "./bindings";
import type { Vec2 } from "./deadzone";
import { DEFAULT_INPUT_SETTINGS, type InputSettings } from "./settings";

export interface InputManagerOptions {
  bindings?: InputBindings;
  settings?: InputSettings;
  /** 캔버스 클릭 시 포인터 락을 요청한다 (기본 true) */
  lockPointerOnClick?: boolean;
}

export class InputManager {
  readonly mapper: ActionMapper;
  private settings: InputSettings;
  private readonly lockOnClick: boolean;
  private readonly disposers: (() => void)[] = [];
  private padIndex: number | null = null;
  private warnedNonStandard = new Set<string>();
  /** 포인터 락이 걸린 그 클릭이 공격으로 나가지 않도록 한 번 무시한다 */
  private swallowNextMouseUp = -1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: InputManagerOptions = {},
  ) {
    this.settings = { ...(options.settings ?? DEFAULT_INPUT_SETTINGS) };
    this.mapper = new ActionMapper(options.bindings ?? DEFAULT_BINDINGS, this.settings);
    this.lockOnClick = options.lockPointerOnClick ?? true;
    this.attach();
  }

  get isPointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  get activeDevice(): InputDevice {
    return this.mapper.activeDevice;
  }

  get gamepadConnected(): boolean {
    return this.padIndex !== null;
  }

  getSettings(): Readonly<InputSettings> {
    return this.settings;
  }

  /** 감도/데드존 등 일부 설정 변경 */
  updateSettings(patch: Partial<InputSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.mapper.setSettings(this.settings);
  }

  setBindings(bindings: InputBindings): void {
    this.mapper.setBindings(bindings);
  }

  async requestPointerLock(): Promise<void> {
    if (this.isPointerLocked) return;
    try {
      // unadjustedMovement: OS 마우스 가속을 끈 원시 이동량 (지원 브라우저만)
      await this.canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        await this.canvas.requestPointerLock();
      } catch (err) {
        console.warn("[input] 포인터 락 요청 실패", err);
      }
    }
  }

  exitPointerLock(): void {
    if (this.isPointerLocked) document.exitPointerLock();
  }

  /** 렌더 프레임마다 호출: 게임패드 폴링, 탭/홀드 타이머, 스틱 시점 회전 */
  update(nowMs: number, frameSeconds: number): void {
    this.mapper.setGamepad(this.pollGamepad(), nowMs);
    this.mapper.update(nowMs, frameSeconds);
  }

  consumeLook(out: Vec2): Vec2 {
    return this.mapper.consumeLook(out);
  }

  /** sim 틱마다 호출 */
  sampleFrame(tick: number, viewYaw: number, out?: InputFrame): InputFrame {
    return this.mapper.sampleFrame(tick, viewYaw, out);
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.exitPointerLock();
    this.mapper.releaseAll();
  }

  // -------------------------------------------------------------------------

  private attach(): void {
    const on = <K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      target.addEventListener(type, fn, opts);
      this.disposers.push(() => target.removeEventListener(type, fn, opts));
    };
    const onCanvas = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void): void => {
      this.canvas.addEventListener(type, fn);
      this.disposers.push(() => this.canvas.removeEventListener(type, fn));
    };
    const onDoc = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void): void => {
      document.addEventListener(type, fn);
      this.disposers.push(() => document.removeEventListener(type, fn));
    };

    on(window, "keydown", (e) => {
      if (this.isTextInput(e.target)) return;
      // 브라우저 단축키(Ctrl/Meta 조합)는 가로채지 않는다
      if (e.ctrlKey || e.metaKey) return;
      if (this.mapper.keyDown(e.code, performance.now())) e.preventDefault(); // Space 스크롤 등 방지
    });
    on(window, "keyup", (e) => {
      if (this.mapper.keyUp(e.code, performance.now())) e.preventDefault();
    });

    onCanvas("mousedown", (e) => {
      if (!this.isPointerLocked) {
        // 잠기지 않은 상태의 클릭은 포인터 락 요청에만 쓰고 공격으로 보내지 않는다
        if (this.lockOnClick && e.button === 0) {
          this.swallowNextMouseUp = e.button;
          void this.requestPointerLock();
        }
        return;
      }
      if (this.mapper.mouseDown(e.button, performance.now())) e.preventDefault();
    });
    // 마우스를 캔버스 밖에서 떼도 받을 수 있게 window에서 듣는다
    on(window, "mouseup", (e) => {
      if (this.swallowNextMouseUp === e.button) {
        this.swallowNextMouseUp = -1;
        return;
      }
      this.mapper.mouseUp(e.button, performance.now());
    });
    on(window, "mousemove", (e) => {
      if (this.isPointerLocked) this.mapper.mouseMove(e.movementX, e.movementY);
    });
    onCanvas("contextmenu", (e) => e.preventDefault());

    onDoc("pointerlockchange", () => {
      if (!this.isPointerLocked) this.mapper.releaseMouse();
    });
    onDoc("visibilitychange", () => {
      if (document.hidden) this.mapper.releaseAll();
    });
    // 포커스를 잃으면 keyup이 오지 않으므로 모두 뗀 것으로 처리 (키가 눌린 채로 남는 버그 방지)
    on(window, "blur", () => this.mapper.releaseAll());

    on(window, "gamepadconnected", (e) => {
      console.info(`[input] 게임패드 연결: ${e.gamepad.id} (mapping: ${e.gamepad.mapping || "없음"})`);
    });
    on(window, "gamepaddisconnected", (e) => {
      console.info(`[input] 게임패드 해제: ${e.gamepad.id}`);
      if (this.padIndex === e.gamepad.index) this.padIndex = null;
    });
  }

  /** 연결된 첫 게임패드를 쓴다. 표준 매핑이 아니면 한 번 경고 후 그대로 시도한다. */
  private pollGamepad(): GamepadSnapshot | null {
    if (typeof navigator.getGamepads !== "function") return null;
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = this.padIndex !== null ? (pads[this.padIndex] ?? null) : null;
    if (!pad?.connected) {
      pad = null;
      for (const p of pads) {
        if (p?.connected) {
          pad = p;
          break;
        }
      }
    }
    this.padIndex = pad ? pad.index : null;
    if (pad && pad.mapping !== "standard" && !this.warnedNonStandard.has(pad.id)) {
      this.warnedNonStandard.add(pad.id);
      console.warn(`[input] 게임패드 '${pad.id}'는 표준 매핑이 아닙니다. 버튼 배치가 다를 수 있습니다.`);
    }
    return pad;
  }

  private isTextInput(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
  }
}
