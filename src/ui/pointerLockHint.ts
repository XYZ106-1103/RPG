/**
 * 화면 중앙 안내: 마우스가 잠기지 않았을 때 "클릭해서 마우스 고정".
 * 포인터 락 요청이 실패했으면 다시 클릭하라고 바꿔 보여 준다. 게임패드를 쓰는 중이면 숨긴다.
 * TODO(아트): 최종 UI 디자인으로 교체
 */
export class PointerLockHint {
  private readonly el: HTMLDivElement;
  private text = "";

  constructor() {
    this.el = document.createElement("div");
    Object.assign(this.el.style, {
      position: "fixed",
      left: "50%",
      top: "58%",
      transform: "translate(-50%, -50%)",
      padding: "8px 16px",
      color: "#f3e3cf",
      background: "rgba(8, 9, 12, 0.6)",
      border: "1px solid rgba(255, 210, 160, 0.25)",
      borderRadius: "6px",
      font: "14px/1.4 system-ui, sans-serif",
      pointerEvents: "none",
      display: "none",
      zIndex: "12",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.el);
  }

  update(state: { pointerLocked: boolean; failed: boolean; usingGamepad: boolean }): void {
    const text = state.pointerLocked || state.usingGamepad ? "" : state.failed ? "마우스 고정 실패 — 화면을 다시 클릭하세요" : "화면을 클릭하면 마우스가 고정됩니다 (Esc로 해제)";
    if (text === this.text) return;
    this.text = text;
    this.el.textContent = text;
    this.el.style.display = text ? "block" : "none";
  }

  dispose(): void {
    this.el.remove();
  }
}
