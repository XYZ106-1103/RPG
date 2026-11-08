/**
 * 캐릭터 애니메이터: sim 상태 → 애니메이션 상태(stateMap) → 크로스페이드(mixer) → 블렌드 트리 → AnimationGroup 가중치.
 *
 * 시간은 Babylon 애니메이션 시계를 쓰지 않고 직접 정한다 (그룹은 속도 0으로 재생하고 매 프레임 goToFrame):
 *  - 행동 클립(공격/구르기 등): sim 진행도(상태 틱 ÷ 타임라인 길이) → 판정 프레임과 화면 동작이 정확히 맞는다
 *  - 이동 클립: 섞이는 클립끼리 정규화 위상을 공유 (접지 프레임이 같아 발이 꼬이지 않는다), 배속 = 실제 속도 ÷ 고유 속도
 *  - 나머지(피격/사망/가드): 렌더 시간
 * 히트스톱 중에는 timeScale 0 → 모든 시간과 크로스페이드가 멈춘다 (행동 클립은 표시 틱이 멈춘 값을 따른다).
 */
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { PlayerActionId } from "../sim/data/playerTimelines";
import { PLAYER_MOVEMENT } from "../sim/data/player";
import type { PlayerStateId } from "../sim/player/types";
import { blend1D, blend2D, toLocal, type BlendWeights, type Blend1DPoint } from "./blendTree";
import type { CharacterProfile } from "./characters/hero";
import type { AnimName } from "./clips";
import type { Clip, ClipLibrary } from "./clipLibrary";
import { CrossfadeMixer } from "./mixer";
import { ANIM_STATES, REACTION_ALLOWED, resolveAnimState, type AnimStateId, type ReactionId } from "./stateMap";
import { crossfadeSeconds } from "./transitions";

/** 1D 블렌드 기준 속도 = sim 이동 속도 (그 속도에서 해당 클립 100%) */
export const LOCOMOTION_POINTS: readonly Blend1DPoint[] = [
  { clip: "idle", speed: 0 },
  { clip: "walk_f", speed: PLAYER_MOVEMENT.walkSpeed },
  { clip: "run_f", speed: PLAYER_MOVEMENT.runSpeed },
  { clip: "sprint", speed: PLAYER_MOVEMENT.sprintSpeed },
];

/** 이동 속도 스무딩 (블렌드가 덜컥거리지 않게, 1/초) */
const VELOCITY_LAMBDA = 14;
const MIN_WEIGHT = 1e-3;

export interface AnimatorInput {
  state: PlayerStateId;
  action: PlayerActionId | null;
  /** 행동 상태일 때 진행도 0~1 (표시 틱 기준 — 히트스톱이면 멈춰 있다) */
  actionProgress: number;
  lockedOn: boolean;
  /** 목표 이동 속도 (월드 XZ, m/s) — sim PlayerState.moveX/moveZ */
  moveX: number;
  moveZ: number;
  /** 표시 중인 방향 (sim 규약: +Z가 0) */
  yaw: number;
  /** 0이면 히트스톱 정지 */
  timeScale: number;
}

export interface AnimatorDebug {
  state: AnimStateId | null;
  weights: string;
  rate: number;
}

export class CharacterAnimator {
  readonly mixer = new CrossfadeMixer<AnimStateId>();
  private readonly freeTime = new Map<AnimStateId, number>();
  private readonly actionTime = new Map<AnimStateId, number>();
  private locoPhase = 0;
  private idleTime = 0;
  private velX = 0;
  private velZ = 0;
  private reaction: { id: ReactionId; t: number; duration: number } | null = null;
  private lastRate = 1;
  /** 그룹별 이번 프레임 (가중치, 시간초, 클립) */
  private readonly frameWeights = new Map<AnimationGroup, { w: number; best: number; time: number; clip: Clip }>();
  private readonly playing = new Set<AnimationGroup>();

  constructor(
    private readonly lib: ClipLibrary,
    private readonly profile: CharacterProfile,
  ) {}

  /** 피격/패리 반응 (sim 이벤트). 지금 sim 상태에서 허용되지 않으면 무시 */
  react(id: ReactionId, state: PlayerStateId): void {
    if (!REACTION_ALLOWED[id].has(state)) return;
    this.reaction = { id, t: 0, duration: this.lib.get(id).duration };
  }

  get debug(): AnimatorDebug {
    const parts: string[] = [];
    for (const v of this.frameWeights.values()) if (v.w > 0.02) parts.push(`${v.clip.name}${v.clip.fallback ? "(대체)" : ""} ${v.w.toFixed(2)}`);
    return { state: this.mixer.current, weights: parts.join(" "), rate: this.lastRate };
  }

  update(dt: number, input: Readonly<AnimatorInput>): void {
    const dte = Math.max(0, dt * input.timeScale);

    // 1. 목표 애니메이션 상태 (반응이 진행 중이고 허용되는 상태면 반응이 우선)
    let target = resolveAnimState(input.state, input.action, input.lockedOn);
    if (this.reaction) {
      this.reaction.t += dte;
      if (this.reaction.t >= this.reaction.duration || !REACTION_ALLOWED[this.reaction.id].has(input.state)) this.reaction = null;
      else target = this.reaction.id;
    }
    if (target !== this.mixer.current) {
      this.mixer.play(target, crossfadeSeconds(this.mixer.current, target));
      if (ANIM_STATES[target].time === "free") this.freeTime.set(target, this.reaction?.id === target ? this.reaction.t : 0);
    }
    this.mixer.update(dte);

    // 2. 이동 블렌드 (속도 스무딩은 히트스톱 중 멈춤)
    const k = 1 - Math.exp(-VELOCITY_LAMBDA * dte);
    this.velX += (input.moveX - this.velX) * k;
    this.velZ += (input.moveZ - this.velZ) * k;
    const speed = Math.hypot(this.velX, this.velZ);
    const loco1d = blend1D(speed, LOCOMOTION_POINTS, this.profile.nativeSpeeds);
    const local = toLocal(this.velX, this.velZ, input.yaw);
    const loco2d = blend2D(local.x, local.z, PLAYER_MOVEMENT.walkSpeed, this.profile.nativeSpeeds);
    this.advanceLocomotion(dte, loco1d, loco2d);

    // 3. 상태별 클립 가중치/시간 → 그룹별 합산
    this.frameWeights.clear();
    const current = this.mixer.current;
    for (const [state, W] of this.mixer.active()) {
      const def = ANIM_STATES[state];
      if (def.kind === "locomotion1d") this.addBlend(loco1d, W);
      else if (def.kind === "locomotion2d") this.addBlend(loco2d, W);
      else if (def.clip) {
        const clip = this.lib.get(def.clip);
        let time: number;
        if (def.time === "action") {
          // 진행 중인 행동은 sim 진행도, 페이드 아웃 중인 이전 행동은 마지막 시간에 멈춤
          if (state === current) this.actionTime.set(state, Math.min(1, Math.max(0, input.actionProgress)) * clip.duration);
          time = this.actionTime.get(state) ?? 0;
        } else {
          const t = (this.freeTime.get(state) ?? 0) + dte;
          this.freeTime.set(state, t);
          time = t;
        }
        if (def.hold === "last") time = Math.min(time, clip.duration);
        else if (typeof def.hold === "number") time = Math.min(time, def.hold / 30);
        else if (def.loop) time %= clip.duration;
        else time = Math.min(time, clip.duration);
        this.addClip(clip, W, time);
      }
    }
    this.apply();
  }

  private advanceLocomotion(dte: number, a: BlendWeights, b: BlendWeights): void {
    const wa = this.mixer.weight("locomotion");
    const wb = this.mixer.weight("locomotion_lock");
    const total = wa + wb;
    this.idleTime += dte;
    if (total <= 0) return;
    // 섞인 이동 클립의 평균 길이로 정규화 위상을 진행 (idle은 따로)
    let dur = 0;
    let wsum = 0;
    for (const [blend, W] of [
      [a, wa],
      [b, wb],
    ] as const) {
      for (const [name, w] of Object.entries(blend.weights) as [AnimName, number][]) {
        if (name === "idle" || !(w > 0)) continue;
        dur += this.lib.get(name).duration * w * W;
        wsum += w * W;
      }
    }
    const rate = (a.rate * wa + b.rate * wb) / total;
    this.lastRate = rate;
    if (wsum > 0 && dur > 0) this.locoPhase = (this.locoPhase + (dte * rate) / (dur / wsum)) % 1;
  }

  private addBlend(blend: BlendWeights, W: number): void {
    for (const [name, w] of Object.entries(blend.weights) as [AnimName, number][]) {
      if (!(w > 0)) continue;
      const clip = this.lib.get(name);
      const time = name === "idle" ? this.idleTime % clip.duration : this.locoPhase * clip.duration;
      this.addClip(clip, W * w, time);
    }
  }

  private addClip(clip: Clip, w: number, time: number): void {
    if (!(w > 0)) return;
    const e = this.frameWeights.get(clip.group);
    if (!e) {
      this.frameWeights.set(clip.group, { w, best: w, time, clip });
      return;
    }
    e.w += w;
    // 같은 그룹을 여러 상태가 쓰면(대체 클립 등) 가중치가 큰 쪽 시간
    if (w > e.best) {
      e.best = w;
      e.time = time;
      e.clip = clip;
    }
  }

  private apply(): void {
    for (const [group, v] of this.frameWeights) {
      if (v.w < MIN_WEIGHT) continue;
      if (!this.playing.has(group)) {
        group.start(true, 0, v.clip.from, v.clip.to);
        this.playing.add(group);
      }
      group.goToFrame(v.clip.from + v.time * v.clip.fps);
      group.setWeightForAllAnimatables(Math.min(1, v.w));
    }
    for (const group of [...this.playing]) {
      const v = this.frameWeights.get(group);
      if (!v || v.w < MIN_WEIGHT) {
        group.stop();
        this.playing.delete(group);
      }
    }
  }

  dispose(): void {
    for (const g of this.playing) g.stop();
    this.playing.clear();
  }
}
