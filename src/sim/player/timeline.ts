/**
 * 행동 타임라인: 상태 진입 시점(0틱)부터 센 sim 틱 단위 구간들.
 * 구간은 반열린 [start, end) — start 틱부터 end 직전 틱까지.
 *
 * 기본값은 data/playerTimelines.ts의 추정치이며, 애니메이션이 들어오면
 * src/anim/events/<캐릭터>.json(30fps 프레임 단위)을 TimelineLoader로 읽어 덮어쓴다.
 */

export interface TickWindow {
  start: number;
  end: number;
}

export interface ActionTimeline {
  /** 전체 길이 (틱). 이 틱에 도달하면 행동이 끝난다 */
  length: number;
  /** 공격 판정 구간 (hit_start ~ hit_end) */
  hit?: TickWindow;
  /** 무적 구간 (iframe_start ~ iframe_end) */
  iframes?: TickWindow;
  /** 슈퍼아머 구간 (강공격 등) */
  superArmor?: TickWindow;
  /**
   * 입력 버퍼 구간 (input_buffer_start ~ ): 이 안에서 누른 행동은 예약되어 캔슬 시점에 실행된다.
   * 없으면 행동 중 입력은 모두 무시된다.
   */
  buffer?: TickWindow;
  /** 캔슬 윈도우 시작 (cancel_window): 이 틱부터 예약/새 입력이 바로 실행되고 이동으로 끊을 수 있다 */
  cancel: number;
  /** 효과 적용 틱 (회복약의 회복 시점 등) */
  effect?: number;
}

export function inWindow(w: TickWindow | undefined, tick: number): boolean {
  return w !== undefined && tick >= w.start && tick < w.end;
}

// ---------------------------------------------------------------------------
// 로더 인터페이스 (구현은 애니메이션 작업 때 — src/anim/에서 JSON을 읽어 변환)
// ---------------------------------------------------------------------------

/** CLAUDE.md의 애니메이션 이벤트 이름 */
export type AnimEventName =
  | "hit_start"
  | "hit_end"
  | "iframe_start"
  | "iframe_end"
  | "input_buffer_start"
  | "cancel_window"
  | `sfx:${string}`;

/** src/anim/events/<캐릭터>.json 형식 (프레임은 fps 기준, 보통 30) */
export interface AnimEventsFile {
  fps: number;
  animations: Record<
    string,
    {
      /** 애니메이션 길이 (프레임) */
      length: number;
      events: { frame: number; name: AnimEventName }[];
    }
  >;
}

/**
 * 타임라인 로더. 애니메이션 이름 → 60Hz 틱 타임라인으로 변환한 결과를 돌려준다.
 * 반환하지 않은 행동은 기본 타임라인(data/playerTimelines.ts)을 그대로 쓴다.
 * 로드는 sim 바깥(클라이언트 부트스트랩 / 서버 시작)에서 끝내고, 결과를 SimWorld 옵션으로 넘긴다
 * — sim 틱 안에서는 비동기 I/O를 하지 않는다 (결정성).
 */
export interface TimelineLoader<ActionId extends string = string> {
  load(character: string): Promise<Partial<Record<ActionId, ActionTimeline>>>;
}
