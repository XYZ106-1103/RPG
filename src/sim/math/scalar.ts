/**
 * sim 전용 스칼라/각도 유틸 (Babylon 비의존).
 */

export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** current를 target 쪽으로 최대 maxStep만큼 이동 */
export function approach(current: number, target: number, maxStep: number): number {
  if (current < target) return Math.min(target, current + maxStep);
  return Math.max(target, current - maxStep);
}

/** 각도를 (-PI, PI] 범위로 */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  else if (r > Math.PI) r -= TAU;
  return r;
}

/** a → b 최단 회전량 */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** 각도를 target 쪽으로 최대 maxStep 라디안 회전 */
export function approachAngle(current: number, target: number, maxStep: number): number {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(d) * maxStep);
}

export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + angleDelta(a, b) * t);
}
