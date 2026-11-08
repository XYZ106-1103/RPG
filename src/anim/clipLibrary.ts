/**
 * AnimationGroup을 이름 규칙으로 찾는다. 이름 규칙에 없는 그룹, 없는 애니메이션은 콘솔 경고 후 idle로 대체한다.
 */
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { ANIM_NAMES, isAnimName, type AnimName } from "./clips";

export interface Clip {
  name: AnimName;
  group: AnimationGroup;
  /** 그룹의 시작/끝 프레임과 초당 프레임 (Babylon 프레임 단위) */
  from: number;
  to: number;
  fps: number;
  /** 길이 (초) */
  duration: number;
  /** idle로 대체된 것인가 */
  fallback: boolean;
}

export class ClipLibrary {
  private readonly clips = new Map<AnimName, Clip>();
  readonly missing: AnimName[] = [];
  readonly unknown: string[] = [];

  constructor(groups: readonly AnimationGroup[], character: string) {
    const byName = new Map<AnimName, AnimationGroup>();
    for (const g of groups) {
      if (isAnimName(g.name)) byName.set(g.name, g);
      else this.unknown.push(g.name);
    }
    if (this.unknown.length) console.warn(`[anim] ${character}: 이름 규칙에 없는 애니메이션 (쓰지 않음): ${this.unknown.join(", ")}`);
    const idle = byName.get("idle") ?? groups[0];
    if (!idle) throw new Error(`[anim] ${character}: 애니메이션이 하나도 없습니다.`);
    if (!byName.has("idle")) console.warn(`[anim] ${character}: idle이 없어 '${idle.name}'을 기본으로 씁니다.`);
    for (const name of ANIM_NAMES) {
      const g = byName.get(name);
      if (!g) this.missing.push(name);
      this.clips.set(name, makeClip(name, g ?? idle, !g));
    }
    if (this.missing.length) console.warn(`[anim] ${character}: 없는 애니메이션은 idle로 대체: ${this.missing.join(", ")}`);
  }

  get(name: AnimName): Clip {
    const c = this.clips.get(name);
    if (!c) throw new Error(`클립 없음: ${name}`);
    return c;
  }

  all(): Clip[] {
    return [...this.clips.values()];
  }
}

function makeClip(name: AnimName, group: AnimationGroup, fallback: boolean): Clip {
  const fps = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
  return { name, group, from: group.from, to: group.to, fps, duration: Math.max(1e-6, (group.to - group.from) / fps), fallback };
}
