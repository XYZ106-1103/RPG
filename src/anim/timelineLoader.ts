/**
 * 애니메이션 이벤트 파일(src/anim/events/<캐릭터>.json)을 읽어 sim 타임라인으로 바꾸는 로더 (sim의 TimelineLoader 구현).
 * 로드는 sim 바깥(세션 생성 시)에서 끝내고 결과를 SimWorld 옵션으로 넘긴다.
 */
import type { PlayerActionId } from "../sim/data/playerTimelines";
import type { ActionTimeline, AnimEventsFile, TimelineLoader } from "../sim/player/timeline";
import { timelinesFromEvents } from "../sim/player/timelineFromEvents";

const files = import.meta.glob<AnimEventsFile>("./events/*.json", { import: "default" });

export async function loadAnimEvents(character: string): Promise<AnimEventsFile | null> {
  const load = files[`./events/${character}.json`];
  return load ? load() : null;
}

export const animEventsTimelineLoader: TimelineLoader<PlayerActionId> = {
  async load(character: string): Promise<Partial<Record<PlayerActionId, ActionTimeline>>> {
    const file = await loadAnimEvents(character);
    if (!file) {
      console.warn(`[anim] 이벤트 파일 없음: src/anim/events/${character}.json — 기본 타임라인 사용`);
      return {};
    }
    const { timelines, warnings } = timelinesFromEvents(file);
    for (const w of warnings) console.warn(`[anim] ${character}: ${w}`);
    return timelines;
  },
};
