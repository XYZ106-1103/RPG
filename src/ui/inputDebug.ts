/**
 * 입력 디버그 오버레이 (개발용). 현재 InputFrame과 장치 상태를 화면 왼쪽 위에 보여준다.
 * 키 배치/게임패드 매핑을 브라우저에서 직접 확인하기 위한 도구.
 */
import { BUTTON_ACTIONS, BUTTON, type InputFrame } from "../sim/inputFrame";

/** 눌림 표시를 유지하는 시간 */
const FLASH_MS = 400;

export class InputDebugOverlay {
  private readonly root: HTMLDivElement;
  private readonly lastPressedAt = new Map<string, number>();
  private lastText = "";

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "fixed",
      top: "12px",
      left: "12px",
      padding: "10px 12px",
      font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      color: "#e8dccb",
      background: "rgba(8, 8, 12, 0.72)",
      borderRadius: "6px",
      whiteSpace: "pre",
      pointerEvents: "none",
      userSelect: "none",
      zIndex: "10",
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.root);
  }

  /** sim 틱에서 받은 프레임의 눌림을 기록 (렌더 주기와 달라도 놓치지 않게) */
  recordFrame(frame: Readonly<InputFrame>, nowMs: number): void {
    if (frame.pressed === 0) return;
    for (const a of BUTTON_ACTIONS) if (frame.pressed & BUTTON[a]) this.lastPressedAt.set(a, nowMs);
  }

  update(
    frame: Readonly<InputFrame>,
    info: { device: string; pointerLocked: boolean; gamepad: boolean; lanternOn: boolean; extra?: readonly string[] },
    nowMs: number,
  ): void {
    const held: string[] = [];
    const flashed: string[] = [];
    for (const a of BUTTON_ACTIONS) {
      if (frame.held & BUTTON[a]) held.push(a);
      const t = this.lastPressedAt.get(a);
      if (t !== undefined && nowMs - t < FLASH_MS) flashed.push(a);
    }
    const lines = [
      `입력 디버그 (?noinputdebug 로 숨김)`,
      `장치: ${info.device}${info.gamepad ? " · 게임패드 연결됨" : ""}`,
      `마우스: ${info.pointerLocked ? "잠금됨 (Esc로 해제)" : "화면을 클릭하면 잠금"}`,
      `move: (${frame.moveX.toFixed(2)}, ${frame.moveY.toFixed(2)})  viewYaw: ${((frame.viewYaw * 180) / Math.PI).toFixed(0)}°`,
      `held: ${held.join(", ") || "-"}`,
      `pressed: ${flashed.join(", ") || "-"}`,
      `등불: ${info.lanternOn ? "켜짐" : "꺼짐"}`,
      ...(info.extra ?? []),
    ];
    const text = lines.join("\n");
    if (text !== this.lastText) {
      this.root.textContent = text;
      this.lastText = text;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
