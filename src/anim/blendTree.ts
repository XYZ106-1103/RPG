/**
 * 이동 블렌드 트리 (Babylon 비의존, 순수 함수).
 *  - 1D: 속도로 idle / walk_f / run_f / sprint (기준 속도 = sim 이동 속도)
 *  - 2D: 락온 중 이동 방향(캐릭터 기준)으로 walk_f / walk_r / walk_b / walk_l — 대각은 인접 두 개를 섞는다
 * 재생 배속: 실제 속도 ÷ 섞인 클립들의 고유 속도 (발이 미끄러지지 않게), RATE_MIN~RATE_MAX로 제한.
 */
import type { AnimName } from "./clips";

export const RATE_MIN = 0.7;
export const RATE_MAX = 1.8;

export interface BlendWeights {
  /** 클립별 가중치 (합 1) */
  weights: Partial<Record<AnimName, number>>;
  /** 이동 클립 재생 배속 */
  rate: number;
}

export interface Blend1DPoint {
  clip: AnimName;
  /** 이 클립이 100%가 되는 속도 (m/s) */
  speed: number;
}

/** 클립 고유 속도 (애니메이션이 제자리에서 표현하는 이동 속도, m/s) */
export type NativeSpeeds = Partial<Record<AnimName, number>>;

function rateFor(speed: number, weights: Partial<Record<AnimName, number>>, native: NativeSpeeds): number {
  let sum = 0;
  let wsum = 0;
  for (const [clip, w] of Object.entries(weights) as [AnimName, number][]) {
    const n = native[clip];
    if (n && n > 0 && w > 0) {
      sum += n * w;
      wsum += w;
    }
  }
  if (wsum <= 0 || sum <= 0) return 1;
  const blendedNative = sum / wsum;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, speed / blendedNative));
}

/** points는 speed 오름차순 (첫 점은 보통 idle, speed 0) */
export function blend1D(speed: number, points: readonly Blend1DPoint[], native: NativeSpeeds): BlendWeights {
  const weights: Partial<Record<AnimName, number>> = {};
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return { weights, rate: 1 };
  if (speed <= first.speed) weights[first.clip] = 1;
  else if (speed >= last.speed) weights[last.clip] = 1;
  else {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (a && b && speed >= a.speed && speed <= b.speed) {
        const u = (speed - a.speed) / (b.speed - a.speed);
        if (1 - u > 0) weights[a.clip] = (weights[a.clip] ?? 0) + (1 - u);
        if (u > 0) weights[b.clip] = (weights[b.clip] ?? 0) + u;
        break;
      }
    }
  }
  return { weights, rate: rateFor(speed, weights, native) };
}

/** 2D 방향 클립 (캐릭터 기준 각도: 0 = 앞, +90° = 오른쪽) */
const DIRS: readonly { clip: AnimName; angle: number }[] = [
  { clip: "walk_f", angle: 0 },
  { clip: "walk_r", angle: Math.PI / 2 },
  { clip: "walk_b", angle: Math.PI },
  { clip: "walk_l", angle: -Math.PI / 2 },
];

/**
 * @param localX 캐릭터 기준 오른쪽 성분 (m/s)
 * @param localZ 캐릭터 기준 앞 성분 (m/s)
 * @param fullSpeed 이 속도 이상이면 idle 없이 방향 클립만 (보통 걷기 속도)
 */
export function blend2D(localX: number, localZ: number, fullSpeed: number, native: NativeSpeeds): BlendWeights {
  const speed = Math.hypot(localX, localZ);
  const weights: Partial<Record<AnimName, number>> = {};
  if (speed < 1e-4) {
    weights.idle = 1;
    return { weights, rate: 1 };
  }
  const angle = Math.atan2(localX, localZ); // -π~π, 0 = 앞, + = 오른쪽
  // 인접 두 방향 사이 선형 보간 (90° 간격)
  const sector = ((angle + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2); // 0~4
  const i0 = Math.floor(sector) % 4;
  const i1 = (i0 + 1) % 4;
  const u = sector - Math.floor(sector);
  const move = Math.min(1, speed / Math.max(1e-6, fullSpeed));
  const d0 = DIRS[i0];
  const d1 = DIRS[i1];
  if (d0 && 1 - u > 1e-6) weights[d0.clip] = (1 - u) * move;
  if (d1 && u > 1e-6) weights[d1.clip] = (weights[d1.clip] ?? 0) + u * move;
  if (move < 1) weights.idle = 1 - move;
  return { weights, rate: rateFor(speed, weights, native) };
}

/** 월드 속도 → 캐릭터 기준 (yaw: +Z가 0, +X 쪽으로 증가 — sim 규약) */
export function toLocal(worldX: number, worldZ: number, yaw: number): { x: number; z: number } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  // 캐릭터 앞 = (sin yaw, cos yaw), 오른쪽 = (cos yaw, -sin yaw)
  return { x: worldX * c - worldZ * s, z: worldX * s + worldZ * c };
}
