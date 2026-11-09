/**
 * hero 캐릭터 설정: 클립 고유 속도, 소켓 본, 무기 크기. (Babylon 비의존 데이터)
 * 고유 속도 = raw/animations/hero/animations.json의 speed × 키 배율(1.8 / 1.163 = 1.5474).
 */
import type { NativeSpeeds } from "../blendTree";

export const HERO_SCALE = 1.8 / 1.163;

export interface CharacterProfile {
  glb: string;
  /** 캐릭터 이름 (이벤트 파일 src/anim/events/<name>.json) */
  name: string;
  nativeSpeeds: NativeSpeeds;
  /** 무기를 붙일 본 (리그의 오른손 소켓) */
  weaponBone: string;
  /** 등불(포인트 라이트)을 붙일 본 */
  lanternBone: string;
  /** 무기: 소켓 원점에서 손잡이/칼끝까지 (소켓 로컬, m). 칼 모델이 없어 기본 도형 칼날 — TODO(에셋) */
  weapon: { hilt: readonly [number, number, number]; tip: readonly [number, number, number]; width: number };
  /** LOD 전환 거리 (m): LOD1, LOD2 */
  lodDistances: readonly [number, number];
  /** 상체 뼈 (가드하며 걷기 등 상·하체 분리). 나머지는 하체 */
  upperBodyBones: RegExp;
}

export const HERO_PROFILE: CharacterProfile = {
  glb: "assets/characters/hero.glb",
  name: "hero",
  nativeSpeeds: {
    walk_f: 0.5625 * HERO_SCALE,
    walk_b: 0.5625 * HERO_SCALE,
    walk_l: 0.375 * HERO_SCALE,
    walk_r: 0.375 * HERO_SCALE,
    run_f: 1.5 * HERO_SCALE,
    sprint: 2.25 * HERO_SCALE,
  },
  weaponBone: "Socket.R",
  lanternBone: "Lantern",
  weapon: { hilt: [0, 0, 0], tip: [0, 1.0, 0], width: 0.05 },
  lodDistances: [15, 35],
  // 척추부터 위 (팔·손·머리·무기 소켓). 루트·골반·다리·망토·등불은 하체 — 걸음에 맞춰 흔들린다
  upperBodyBones: /^(Spine|Chest|UpperChest|Neck|Head|Shoulder|UpperArm|LowerArm|Hand|Fingers|Thumb|Socket)/,
};
