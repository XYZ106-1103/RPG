/**
 * 상체/하체 분리 애니메이션 (가드하며 걷기 등): 클립을 뼈 이름으로 나눈 새 AnimationGroup을 만든다.
 * 원본과 같은 Animation 객체(키)를 공유하므로 메모리는 거의 들지 않는다. 프레임 번호도 원본과 같다.
 *
 * Babylon은 같은 뼈에 걸린 여러 그룹의 가중치를 합해 섞는다 — 상체판(가드)과 하체판(걷기)을 같은 가중치 W로 걸면
 * 상체 뼈는 가드 W, 하체 뼈는 걷기 W가 되어, 크로스페이드 중 다른 상태(전신, 1 − W)와 합쳐도 뼈마다 합이 1이다.
 */
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";

export type BodyPart = "upper" | "lower";

/** 그룹을 받아 상체/하체만 담은 그룹을 만든다 (ClipLibrary에 주입 — 테스트에서는 가짜로 바꾼다) */
export type GroupSplitter = (group: AnimationGroup, part: BodyPart) => AnimationGroup;

/** 상체 뼈 판정 (그 밖은 하체 — 루트·골반·다리·망토·등불은 걸음에 맞춰 흔들리도록 하체) */
export function makeGroupSplitter(isUpperBone: (boneName: string) => boolean): GroupSplitter {
  return (src, part) => {
    const g = new AnimationGroup(`${src.name}__${part}`, src.getScene());
    for (const ta of src.targetedAnimations) {
      const name = (ta.target as { name?: string } | null)?.name ?? "";
      if (isUpperBone(name) === (part === "upper")) g.addTargetedAnimation(ta.animation, ta.target);
    }
    return g;
  };
}
