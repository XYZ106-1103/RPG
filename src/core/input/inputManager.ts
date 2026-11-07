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
import { MouseButtonTracker } from "./mouseButtons";
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
  /** 마우스 버튼 상태 (포인터 이벤트 buttons 마스크 기반 — mouseButtons.ts 참고) */
  private readonly mouseButtons = new MouseButtonTracker();
  /** unadjustedMovement 옵션이 거부된 적이 있으면 다음부터 옵션 없이 요청한다 */
  private unadjustedSupported = true;
  private lockFailed = false;
  /** requestPointerLock이 Promise를 돌려주지 않는 구형 브라우저면 pointerlockerror 이벤트로 실패를 안다 */
  private lockErrorFromEvent = false;

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

  /** 마지막 포인터 락 요청이 실패했는가 (다시 클릭하라는 안내용, 잠기면 false) */
  get pointerLockFailed(): boolean {
    return this.lockFailed && !this.isPointerLocked;
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

  /**
   * 클릭(사용자 제스처) 안에서 호출해야 한다.
   * unadjustedMovement(OS 마우스 가속을 끈 원시 이동량)는 지원 브라우저에서만 쓴다. 거부되면 기억해 두고
   * 옵션 없이 다시 요청한다 — 이 재시도는 제스처 밖이라 브라우저에 따라 실패할 수 있으므로,
   * 그때는 안내를 띄우고 다음 클릭부터 처음부터 옵션 없이 요청한다.
   */
  async requestPointerLock(): Promise<void> {
    if (this.isPointerLocked) return;
    if (this.unadjustedSupported) {
      try {
        await this.lock({ unadjustedMovement: true });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotSupportedError") {
          this.unadjustedSupported = false;
          console.info("[input] 원시 마우스 입력(unadjustedMovement) 미지원 — 일반 포인터 락으로 전환");
        } else {
          this.onLockError(err);
          return;
        }
      }
    }
    try {
      await this.lock();
    } catch (err) {
      this.onLockError(err);
    }
  }

  private async lock(options?: PointerLockOptions): Promise<void> {
    const result: unknown = this.canvas.requestPointerLock(options);
    this.lockErrorFromEvent = !(result instanceof Promise);
    await result;
  }

  private onLockError(err: unknown): void {
    this.lockFailed = true;
    console.warn("[input] 포인터 락 요청 실패 — 화면을 다시 클릭하세요", err);
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

  /** sim 틱마다 호출. lockTarget은 카메라 락온이 고른 엔티티 id (0 = 없음) */
  sampleFrame(tick: number, viewYaw: number, out?: InputFrame, lockTarget = 0): InputFrame {
    return this.mapper.sampleFrame(tick, viewYaw, out, lockTarget);
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

    // 마우스 버튼은 포인터 이벤트로 받는다. Babylon이 pointerdown에서 preventDefault()를 하면
    // mousedown/mouseup이 오지 않기 때문이다 (mouseButtons.ts 참고).
    // 잠기지 않은 상태에서 누른 버튼은 포인터 락 요청에만 쓰고, 뗄 때까지 게임에 전달하지 않는다.
    const onButtons = (e: PointerEvent): void => {
      if (e.pointerType !== "mouse") return;
      this.mouseButtons.update(e.buttons, this.isPointerLocked, (button, down) => {
        if (down) this.mapper.mouseDown(button, performance.now());
        else this.mapper.mouseUp(button, performance.now());
      });
    };
    onCanvas("pointerdown", (e) => {
      if (e.pointerType === "mouse" && !this.isPointerLocked && this.lockOnClick && e.button === 0) void this.requestPointerLock();
    });
    // 캔버스 밖에서 떼도 받을 수 있게 window에서 듣는다 (pointerdown은 캔버스에서 시작해 window까지 버블된다)
    on(window, "pointerdown", onButtons);
    on(window, "pointerup", onButtons);
    on(window, "pointercancel", () => {
      this.mouseButtons.reset();
      this.mapper.releaseMouse();
    });
    on(window, "pointermove", (e) => {
      onButtons(e); // 두 번째 버튼부터는 pointermove로 온다
      if (this.isPointerLocked) this.mapper.mouseMove(e.movementX, e.movementY);
    });
    onCanvas("contextmenu", (e) => e.preventDefault());

    onDoc("pointerlockchange", () => {
      if (this.isPointerLocked) {
        this.lockFailed = false;
      } else {
        this.mouseButtons.ignoreHeld();
        this.mapper.releaseMouse();
      }
    });
    onDoc("pointerlockerror", () => {
      // Promise를 돌려주는 브라우저는 거부(reject)로 이미 처리한다 — 같은 실패가 이벤트로도 오므로 무시
      if (this.lockErrorFromEvent) this.onLockError(new Error("pointerlockerror"));
    });
    onDoc("visibilitychange", () => {
      if (document.hidden) {
        this.mouseButtons.reset();
        this.mapper.releaseAll();
      }
    });
    // 포커스를 잃으면 keyup이 오지 않으므로 모두 뗀 것으로 처리 (키가 눌린 채로 남는 버그 방지)
    on(window, "blur", () => {
      this.mouseButtons.reset();
      this.mapper.releaseAll();
    });

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
