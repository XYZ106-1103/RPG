/**
 * sim 상태 → 애니메이션 상태 매핑. **이 파일의 SIM_TO_ANIM 테이블 한 곳에서만** 정한다 (Babylon 비의존).
 *
 * 애니메이션 상태 종류:
 *  - locomotion1d: 속도로 idle/walk/run/sprint 1D 블렌드 (자유 이동)
 *  - locomotion2d: 락온 중 walk_f/b/l/r 2D 블렌드 (대각은 인접 두 개)
 *  - clip: 클립 하나. time "action"이면 sim 상태 틱으로 시간을 정해 판정 프레임과 화면을 맞춘다
 *  - 반응(hit_front/hit_back/parry): sim 상태가 아니라 sim 이벤트로 잠깐 재생하는 클립
 */
import type { AnimName } from "./clips";
import type { PlayerActionId } from "../sim/data/playerTimelines";
import type { PlayerStateId } from "../sim/player/types";

export type AnimStateId =
  | "locomotion"
  | "locomotion_lock"
  | "guard"
  | "drink"
  | "roll_f"
  | "attack_light_1"
  | "attack_light_2"
  | "attack_light_3"
  | "attack_heavy"
  | "attack_run"
  | "stagger"
  | "death"
  | "hit_front"
  | "hit_back"
  | "parry";

export interface AnimStateDef {
  kind: "locomotion1d" | "locomotion2d" | "clip";
  clip?: AnimName;
  /** free: 렌더 시간으로 재생 / action: sim 상태 틱(진행도)으로 시간을 정함 */
  time: "free" | "action";
  loop: boolean;
  /** 끝에서 멈춤: "last" = 마지막 프레임, 숫자 = 그 프레임(30fps)에서 정지 (가드 자세 유지 등) */
  hold?: "last" | number;
}

export const ANIM_STATES: Readonly<Record<AnimStateId, AnimStateDef>> = {
  locomotion: { kind: "locomotion1d", time: "free", loop: true },
  locomotion_lock: { kind: "locomotion2d", time: "free", loop: true },
  // guard 클립은 막기 동작 전체(36f)라, 들어 올린 자세(12f)에서 멈춰 버티는 동안 유지한다 TODO(애니): 가드 유지 루프 클립
  guard: { kind: "clip", clip: "guard", time: "free", loop: false, hold: 12 },
  drink: { kind: "clip", clip: "drink", time: "action", loop: false },
  roll_f: { kind: "clip", clip: "roll_f", time: "action", loop: false },
  attack_light_1: { kind: "clip", clip: "attack_light_1", time: "action", loop: false },
  attack_light_2: { kind: "clip", clip: "attack_light_2", time: "action", loop: false },
  attack_light_3: { kind: "clip", clip: "attack_light_3", time: "action", loop: false },
  attack_heavy: { kind: "clip", clip: "attack_heavy", time: "action", loop: false },
  attack_run: { kind: "clip", clip: "attack_run", time: "action", loop: false },
  stagger: { kind: "clip", clip: "stagger", time: "free", loop: false, hold: "last" },
  death: { kind: "clip", clip: "death", time: "free", loop: false, hold: "last" },
  hit_front: { kind: "clip", clip: "hit_front", time: "free", loop: false },
  hit_back: { kind: "clip", clip: "hit_back", time: "free", loop: false },
  parry: { kind: "clip", clip: "parry", time: "free", loop: false },
};

type FreeOrLocked = { free: AnimStateId; locked: AnimStateId };

/** ★ sim 상태 → 애니메이션 상태 (유일한 매핑 테이블) */
export const SIM_TO_ANIM: {
  readonly [S in PlayerStateId]: S extends "attack" ? Readonly<Record<Extract<PlayerActionId, `attack_${string}`>, AnimStateId>> : AnimStateId | FreeOrLocked;
} = {
  idle: { free: "locomotion", locked: "locomotion_lock" },
  move: { free: "locomotion", locked: "locomotion_lock" },
  sprint: "locomotion", // 질주는 락온 중에도 정면으로 달린다
  guard: "guard",
  attack: {
    attack_light_1: "attack_light_1",
    attack_light_2: "attack_light_2",
    attack_light_3: "attack_light_3",
    attack_heavy: "attack_heavy",
    attack_run: "attack_run",
  },
  roll: "roll_f", // sim은 구르는 방향으로 몸을 돌리므로 정면 구르기 하나
  backstep: "locomotion", // 백스텝은 idle 자세 그대로 뒤로 미끄러진다 (행동 중 이동 속도 0 → idle 100%, 서 있던 idle에서 끊김 없이)
  drink: "drink",
  stagger: "stagger",
  death: "death",
};

export type ReactionId = "hit_front" | "hit_back" | "parry";

/**
 * 반응별로 재생해도 되는 sim 상태.
 *  - hit_front/hit_back (sim hit 이벤트): 자유 상태에서만 — 공격/구르기 중에는 판정 궤적과 어긋나므로 재생하지 않는다
 *  - parry (내 공격이 패리당함 → sim은 stagger / 벽에 튕김 → sim은 attack 유지): 튕겨 나는 반동 클립
 */
export const REACTION_ALLOWED: Readonly<Record<ReactionId, ReadonlySet<PlayerStateId>>> = {
  hit_front: new Set<PlayerStateId>(["idle", "move", "sprint", "guard"]),
  hit_back: new Set<PlayerStateId>(["idle", "move", "sprint", "guard"]),
  parry: new Set<PlayerStateId>(["attack", "stagger"]),
};

export function resolveAnimState(state: PlayerStateId, action: PlayerActionId | null, lockedOn: boolean): AnimStateId {
  if (state === "attack") {
    const table = SIM_TO_ANIM.attack;
    return action && action in table ? table[action as keyof typeof table] : "locomotion";
  }
  const entry = SIM_TO_ANIM[state];
  return typeof entry === "string" ? entry : lockedOn ? entry.locked : entry.free;
}
