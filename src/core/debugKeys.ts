/**
 * 개발용 단축키 (F3 물리 디버그 등). 게임 입력(InputFrame)과 별개로 DOM에서 직접 받는다.
 */
export interface DebugKeyTarget {
  addEventListener(type: "keydown", listener: (e: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", listener: (e: KeyboardEvent) => void): void;
}

/**
 * @param code KeyboardEvent.code (예: "F3")
 * @returns 해제 함수
 */
export function bindDebugKey(code: string, handler: () => void, target: DebugKeyTarget = window): () => void {
  const listener = (e: KeyboardEvent): void => {
    if (e.code !== code) return;
    // F3은 브라우저 "다음 찾기" 등 기본 동작이 있으므로 막는다
    e.preventDefault();
    if (e.repeat) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    handler();
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}
