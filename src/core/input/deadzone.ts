/**
 * 아날로그 스틱 데드존 (순수 함수).
 *
 * 축별(사각형) 데드존은 대각선 입력이 축 방향으로 끌려가므로, 방향을 보존하는 원형(radial) 데드존을 쓴다.
 * 안쪽 데드존~바깥쪽 데드존 구간을 0~1로 다시 늘려(rescale) 데드존 경계에서 값이 튀지 않게 한다.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * @param inner 이 크기 이하는 0
 * @param outer 이 크기 이상은 1
 * @param exponent 응답 곡선 (1=선형). 크기에만 적용해 방향은 유지
 */
export function applyRadialDeadzone(x: number, y: number, inner: number, outer: number, out: Vec2, exponent = 1): Vec2 {
  const mag = Math.hypot(x, y);
  if (!(mag > inner) || !Number.isFinite(mag)) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const span = Math.max(1e-6, outer - inner);
  let scaled = Math.min(1, (mag - inner) / span);
  if (exponent !== 1) scaled = Math.pow(scaled, exponent);
  const k = scaled / mag;
  out.x = x * k;
  out.y = y * k;
  return out;
}

/** 길이가 1을 넘으면 1로 자른다 (키보드 대각선 이동 등). */
export function clampLength(v: Vec2, max = 1): Vec2 {
  const mag = Math.hypot(v.x, v.y);
  if (mag > max) {
    v.x = (v.x / mag) * max;
    v.y = (v.y / mag) * max;
  }
  return v;
}
