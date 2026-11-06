/**
 * 락온 마커: 대상 가슴 위치에 작은 원 + 점. DOM 오버레이 (캔버스 위).
 * TODO(아트): 최종 UI 디자인으로 교체
 */
export class LockOnMarker {
  private readonly el: HTMLDivElement;
  private shown = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.el = document.createElement("div");
    Object.assign(this.el.style, {
      position: "fixed",
      width: "22px",
      height: "22px",
      marginLeft: "-11px",
      marginTop: "-11px",
      border: "2px solid rgba(255, 236, 200, 0.9)",
      borderRadius: "50%",
      boxShadow: "0 0 6px rgba(255, 180, 90, 0.8)",
      pointerEvents: "none",
      display: "none",
      zIndex: "11",
    } satisfies Partial<CSSStyleDeclaration>);
    const dot = document.createElement("div");
    Object.assign(dot.style, {
      position: "absolute",
      left: "8px",
      top: "8px",
      width: "6px",
      height: "6px",
      borderRadius: "50%",
      background: "rgba(255, 236, 200, 0.95)",
    } satisfies Partial<CSSStyleDeclaration>);
    this.el.appendChild(dot);
    document.body.appendChild(this.el);
  }

  /** x, y: 캔버스 렌더 픽셀 좌표 */
  update(visible: boolean, x: number, y: number, renderWidth: number, renderHeight: number): void {
    if (!visible) {
      if (this.shown) this.el.style.display = "none";
      this.shown = false;
      return;
    }
    // 렌더 해상도(고DPI) → CSS 픽셀
    const rect = this.canvas.getBoundingClientRect();
    this.el.style.left = `${rect.left + (x / renderWidth) * rect.width}px`;
    this.el.style.top = `${rect.top + (y / renderHeight) * rect.height}px`;
    if (!this.shown) this.el.style.display = "block";
    this.shown = true;
  }

  dispose(): void {
    this.el.remove();
  }
}
