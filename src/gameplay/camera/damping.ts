/**
 * 프레임 독립 감쇠 (Babylon 비의존).
 *
 * current를 target 쪽으로 지수 감쇠: x(t+dt) = target + (x - target)·e^(-λ·dt)
 * 같은 시간만큼 진행하면 프레임을 어떻게 나눠도 결과가 같다 (30fps든 144fps든 같은 느낌).
 * λ(1/초)가 클수록 빨리 따라간다. 대략 1/λ초에 남은 차이가 37%가 된다.
 */

export function damp(current: number, target: number, lambda: number, dt: number): number {
  if (!(lambda > 0) || !(dt > 0)) return lambda > 0 ? current : target;
  return target + (current - target) * Math.exp(-lambda * dt);
}

/** 각도 감쇠: 최단 방향으로 돈다. 결과는 감싸지 않은 연속 값 (current 기준) */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let d = (target - current) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return damp(current, current + d, lambda, dt);
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export function dampVec3(out: Vec3Like, target: Readonly<Vec3Like>, lambda: number, dt: number): Vec3Like {
  out.x = damp(out.x, target.x, lambda, dt);
  out.y = damp(out.y, target.y, lambda, dt);
  out.z = damp(out.z, target.z, lambda, dt);
  return out;
}
