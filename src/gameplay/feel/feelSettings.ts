/**
 * 타격감 수치 (실시간 조정 대상 — ?tune 디버그 GUI가 이 객체를 직접 바꾼다).
 */
export interface ShakePreset {
  amplitude: number;
  duration: number;
}

export interface FeelSettings {
  hitstop: {
    enabled: boolean;
    /** 공격 데이터의 히트스톱 프레임(2~4)에 곱하는 배율 */
    scale: number;
    /** 가드/튕김/패리 히트스톱 (프레임, 1/60초) */
    guardFrames: number;
    bounceFrames: number;
    parryFrames: number;
    /** 정지가 끝난 뒤 실제 위치로 따라잡는 시간 (초) */
    catchUpSeconds: number;
  };
  shake: {
    enabled: boolean;
    frequency: number;
    light: ShakePreset;
    /** 강공격(히트스톱 4프레임 공격)/백어택/경직 유발 */
    heavy: ShakePreset;
    guard: ShakePreset;
    bounce: ShakePreset;
    parry: ShakePreset;
    /** 플레이어가 관련되지 않은 타격도 흔들지 (멀리서 적끼리 등) */
    shakeOnOthers: boolean;
  };
  reaction: {
    /** 피격자 밀림 거리 (m, 렌더 전용) */
    pushDistance: number;
    /** 밀렸다 돌아오는 시간 (초) */
    pushSeconds: number;
    /** 흰색 플래시 지속 (초) */
    flashSeconds: number;
    flashAlpha: number;
  };
  sparks: {
    enabled: boolean;
    hitCount: number;
    guardCount: number;
    bounceCount: number;
    speed: number;
    /** 퍼짐 (0=한 방향, 1=반구) */
    spread: number;
    life: number;
    gravity: number;
    size: number;
  };
}

export function createFeelSettings(): FeelSettings {
  return {
    hitstop: { enabled: true, scale: 1, guardFrames: 2, bounceFrames: 4, parryFrames: 6, catchUpSeconds: 0.08 },
    shake: {
      enabled: true,
      frequency: 24,
      light: { amplitude: 0.22, duration: 0.14 },
      heavy: { amplitude: 0.6, duration: 0.3 },
      guard: { amplitude: 0.32, duration: 0.18 },
      bounce: { amplitude: 0.45, duration: 0.22 },
      parry: { amplitude: 0.7, duration: 0.35 },
      shakeOnOthers: false,
    },
    reaction: { pushDistance: 0.12, pushSeconds: 0.14, flashSeconds: 0.09, flashAlpha: 0.85 },
    sparks: { enabled: true, hitCount: 14, guardCount: 22, bounceCount: 18, speed: 6, spread: 0.7, life: 0.28, gravity: 12, size: 0.05 },
  };
}

/** 히트스톱 프레임 → 초 (sim 60Hz 기준 프레임) */
export const HITSTOP_FRAME_SECONDS = 1 / 60;
