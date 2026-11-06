/**
 * 화면 구석 디버그 패널 (DOM). 줄 단위 텍스트를 받아 바뀐 경우에만 갱신한다.
 */
export class DebugPanel {
  private readonly root: HTMLDivElement;
  private last = "";

  constructor(corner: "top-left" | "top-right" = "top-right") {
    this.root = document.createElement("div");
    Object.assign(this.root.style, {
      position: "fixed",
      top: "12px",
      [corner === "top-right" ? "right" : "left"]: "12px",
      minWidth: "260px",
      padding: "10px 12px",
      font: "12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      color: "#e8dccb",
      background: "rgba(8, 8, 12, 0.72)",
      borderRadius: "6px",
      whiteSpace: "pre",
      pointerEvents: "none",
      userSelect: "none",
      zIndex: "10",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.root);
  }

  setLines(lines: readonly string[]): void {
    const text = lines.join("\n");
    if (text === this.last) return;
    this.root.textContent = text;
    this.last = text;
  }

  dispose(): void {
    this.root.remove();
  }
}

/** 0~1 비율을 텍스트 막대로 (예: ████░░░░) */
export function textBar(ratio: number, width = 12): string {
  const r = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  const filled = Math.round(r * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}
