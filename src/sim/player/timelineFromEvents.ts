/**
 * 애니메이션 이벤트 파일(src/anim/events/<캐릭터>.json, 30fps 프레임) → 플레이어 행동 타임라인(60Hz 틱).
 * Babylon/I/O 비의존 순수 함수 — 로드(JSON 읽기)는 sim 바깥(anim/timelineLoader.ts)이 하고 결과만 SimWorld에 넘긴다.
 *
 * 이벤트 → 타임라인:
 *   length                → 길이 (틱)
 *   hit_start / hit_end   → hit [start, end)
 *   iframe_start / _end   → iframes [start, end)
 *   input_buffer_start    → buffer [start, length)
 *   cancel_window         → cancel (없으면 길이 끝)
 * 이벤트에 없는 값(슈퍼아머, 효과 틱, 루트 모션 구간)은 기본 타임라인을 길이 비율로 늘이거나 줄여 쓴다.
 * 루트 모션 거리는 기본값(data/playerTimelines.ts) 그대로.
 */
import { PLAYER_ACTIONS, PLAYER_TIMELINES, type PlayerActionId, type PlayerTimelineTable } from "../data/playerTimelines";
import { SIM_HZ } from "../time";
import type { PlayerTimelineOverrides } from "./system";
import type { ActionTimeline, AnimEventsFile, TickWindow } from "./timeline";

/** sim 행동 → 애니메이션 이름 규칙 (sim의 구르기는 입력 방향으로 몸을 돌려 구르므로 roll_f 하나) */
export const PLAYER_ACTION_ANIMS: Readonly<Record<PlayerActionId, string>> = {
  attack_light_1: "attack_light_1",
  attack_light_2: "attack_light_2",
  attack_light_3: "attack_light_3",
  attack_heavy: "attack_heavy",
  attack_run: "attack_run",
  roll: "roll_f",
  backstep: "backstep",
  drink: "drink",
};

export interface TimelineConversion {
  timelines: PlayerTimelineOverrides;
  /** 사람이 볼 경고 (빠진 애니메이션/이벤트, 잘못된 구간) */
  warnings: string[];
}

function scaleWindow(w: Readonly<TickWindow> | undefined, k: number, length: number): TickWindow | undefined {
  if (!w) return undefined;
  const start = Math.min(length, Math.round(w.start * k));
  return { start, end: Math.min(length, Math.max(start + 1, Math.round(w.end * k))) };
}

export function timelinesFromEvents(file: Readonly<AnimEventsFile>, defaults: PlayerTimelineTable = PLAYER_TIMELINES): TimelineConversion {
  const warnings: string[] = [];
  const timelines: PlayerTimelineOverrides = {};
  const fps = file.fps > 0 ? file.fps : 30;
  const toTick = (frame: number): number => Math.round((frame * SIM_HZ) / fps);

  for (const action of PLAYER_ACTIONS) {
    const animName = PLAYER_ACTION_ANIMS[action];
    const anim = file.animations[animName];
    const def = defaults[action];
    if (!anim) {
      warnings.push(`${action}: 애니메이션 '${animName}' 이벤트가 없어 기본 타임라인 사용`);
      continue;
    }
    const length = Math.max(1, toTick(anim.length));
    const frameOf = (name: string): number | undefined => anim.events.find((e) => e.name === name)?.frame;
    const window = (startName: string, endName: string, fallback: TickWindow | undefined, k: number): TickWindow | undefined => {
      const s = frameOf(startName);
      const e = frameOf(endName);
      if (s === undefined && e === undefined) {
        if (fallback) warnings.push(`${action}: ${startName}/${endName} 이벤트가 없어 기본값을 길이 비율로 사용`);
        return scaleWindow(fallback, k, length);
      }
      if (s === undefined || e === undefined) {
        warnings.push(`${action}: ${startName}와 ${endName} 중 하나만 있음 — 무시하고 기본값 사용`);
        return scaleWindow(fallback, k, length);
      }
      const w = { start: toTick(s), end: toTick(e) };
      if (!(w.start >= 0 && w.start < w.end && w.end <= length)) {
        warnings.push(`${action}: ${startName}~${endName} 구간이 잘못됨 (${s}~${e}프레임, 길이 ${anim.length}) — 기본값 사용`);
        return scaleWindow(fallback, k, length);
      }
      return w;
    };

    const k = length / def.length;
    const t: ActionTimeline = { length, cancel: length };
    const hit = window("hit_start", "hit_end", def.hit, k);
    if (hit) t.hit = hit;
    const iframes = window("iframe_start", "iframe_end", def.iframes, k);
    if (iframes) t.iframes = iframes;
    const superArmor = scaleWindow(def.superArmor, k, length);
    if (superArmor) t.superArmor = superArmor;
    const bufferStart = frameOf("input_buffer_start");
    if (bufferStart !== undefined) t.buffer = { start: Math.min(length, toTick(bufferStart)), end: length };
    else if (def.buffer) t.buffer = scaleWindow(def.buffer, k, length);
    const cancel = frameOf("cancel_window");
    t.cancel = cancel !== undefined ? Math.min(length, toTick(cancel)) : def.buffer ? Math.min(length, Math.round(def.cancel * k)) : length;
    if (def.effect !== undefined) t.effect = Math.min(length, Math.round(def.effect * k));
    if (def.rootMotion) {
      const w = scaleWindow(def.rootMotion, k, length) ?? { start: 0, end: length };
      t.rootMotion = { ...def.rootMotion, start: w.start, end: w.end };
    }
    timelines[action] = t;
  }
  return { timelines, warnings };
}
