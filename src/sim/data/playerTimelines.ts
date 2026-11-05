/**
 * 플레이어 행동 타임라인 기본값 (60Hz 틱, 상태 진입 = 0틱).
 *
 * 애니메이션이 아직 없어 일반적인 소울라이크 모션 길이를 기준으로 추정한 값이다 (CLAUDE.md: Claude 추정 → 사용자 조정).
 * 믹사모 애니메이션이 들어오면 src/anim/events/player.json을 TimelineLoader로 읽어 덮어쓴다.
 */
import type { ActionTimeline } from "../player/timeline";

export const PLAYER_ACTIONS = ["attack_light_1", "attack_light_2", "attack_light_3", "attack_heavy", "attack_run", "roll", "backstep", "drink"] as const;

export type PlayerActionId = (typeof PLAYER_ACTIONS)[number];

export type PlayerTimelineTable = Readonly<Record<PlayerActionId, ActionTimeline>>;

/** 루트 모션 추정치 (애니메이션이 없어 거리 곡선으로 대신함 — TODO(에셋): Hips XZ 추출 곡선으로 교체) */
const rm = (distance: number, start: number, end: number, curve: "linear" | "easeOut" = "easeOut") => ({ distance, start, end, curve });

export const PLAYER_TIMELINES: PlayerTimelineTable = {
  //                길이   판정            버퍼            캔슬        루트 모션(거리 m, 구간)
  attack_light_1: { length: 36, hit: { start: 10, end: 16 }, buffer: { start: 6, end: 36 }, cancel: 22, rootMotion: rm(0.5, 6, 14) },
  attack_light_2: { length: 38, hit: { start: 11, end: 17 }, buffer: { start: 6, end: 38 }, cancel: 24, rootMotion: rm(0.5, 6, 15) },
  attack_light_3: { length: 48, hit: { start: 16, end: 24 }, buffer: { start: 10, end: 48 }, cancel: 34, rootMotion: rm(0.8, 10, 22) },
  attack_heavy: { length: 60, hit: { start: 24, end: 32 }, superArmor: { start: 12, end: 32 }, buffer: { start: 16, end: 60 }, cancel: 44, rootMotion: rm(0.9, 16, 30) },
  attack_run: { length: 44, hit: { start: 12, end: 20 }, buffer: { start: 8, end: 44 }, cancel: 30, rootMotion: rm(2.0, 0, 18) },
  //                         무적
  roll: { length: 36, iframes: { start: 3, end: 16 }, buffer: { start: 12, end: 36 }, cancel: 26, rootMotion: rm(3.4, 0, 24) },
  backstep: { length: 26, iframes: { start: 2, end: 8 }, buffer: { start: 8, end: 26 }, cancel: 18, rootMotion: rm(1.6, 0, 14) },
  // 회복약: 버퍼/캔슬 없음 (끝까지 마셔야 함), 40틱에 회복
  drink: { length: 70, effect: 40, cancel: 70 },
};
