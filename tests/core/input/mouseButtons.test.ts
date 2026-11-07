import { describe, expect, it } from "vitest";
import { MouseButtonTracker } from "../../../src/core/input/mouseButtons";

const LEFT = 1;
const RIGHT = 2;
const MIDDLE = 4;

function run(): { t: MouseButtonTracker; log: string[]; feed: (buttons: number, accept?: boolean) => void } {
  const t = new MouseButtonTracker();
  const log: string[] = [];
  const feed = (buttons: number, accept = true): void => t.update(buttons, accept, (b, down) => log.push(`${down ? "down" : "up"}${b}`));
  return { t, log, feed };
}

describe("MouseButtonTracker", () => {
  it("buttons 비트를 MouseEvent.button 번호로 바꾼다 (오른쪽=2, 가운데=1)", () => {
    const { log, feed } = run();
    feed(LEFT);
    feed(0);
    feed(RIGHT);
    feed(0);
    feed(MIDDLE);
    feed(0);
    expect(log).toEqual(["down0", "up0", "down2", "up2", "down1", "up1"]);
  });

  it("코드 버튼: 왼쪽을 누른 채 오른쪽을 누르고 떼는 경우 (pointermove로 오는 변화)", () => {
    const { log, feed } = run();
    feed(LEFT);
    feed(LEFT | RIGHT);
    feed(LEFT); // 같은 마스크가 반복돼도 (이동 이벤트) 다시 보내지 않는다
    feed(LEFT);
    feed(0);
    expect(log).toEqual(["down0", "down2", "up2", "up0"]);
  });

  it("accept=false일 때 눌린 버튼은 뗄 때까지 무시한다 (포인터 락 요청 클릭이 공격으로 나가지 않게)", () => {
    const { log, feed } = run();
    feed(LEFT, false);
    feed(LEFT, true); // 그사이 잠겨도 이미 눌린 버튼은 무시
    feed(LEFT | RIGHT, true); // 새로 누른 버튼은 전달
    feed(RIGHT, true); // 왼쪽 뗌: 무시
    feed(0, true);
    feed(LEFT, true); // 다시 누르면 정상 전달
    expect(log).toEqual(["down2", "up2", "down0"]);
  });

  it("ignoreHeld: 포인터 락 해제 시 눌려 있던 버튼의 뗌은 전달하지 않는다", () => {
    const { t, log, feed } = run();
    feed(LEFT);
    t.ignoreHeld();
    feed(0);
    expect(log).toEqual(["down0"]);
  });

  it("reset 후에는 상태를 모르므로 다음 마스크를 새 누름으로 본다", () => {
    const { t, log, feed } = run();
    feed(LEFT);
    t.reset();
    feed(LEFT);
    feed(0);
    expect(log).toEqual(["down0", "down0", "up0"]);
  });
});
