/**
 * 등불(포인트 라이트) 큐브 그림자 컬링 — Babylon 비의존 순수 계산.
 *
 * 큐브맵 그림자는 6면을 각각 그리므로, 면마다 그 면의 시야(90° 사각뿔) 안에 걸치는 캐스터만 넘기면
 * 대부분의 물체는 1~3면에만 그려진다. 등불 범위 밖의 물체는 아예 빠진다.
 */

const SQRT2 = Math.SQRT2;

/**
 * 구(중심 = 광원 기준 상대 위치 d, 반지름 r)가 등불 범위 안에 걸치는가
 */
export function sphereWithinRange(dx: number, dy: number, dz: number, r: number, range: number): boolean {
  const reach = range + r;
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

/**
 * 구가 큐브맵 한 면의 시야(축 방향 90° 사각뿔)에 걸치는가 — 보수적 판정 (걸칠 수 있으면 true).
 * axis는 좌표축 방향 단위 벡터 (±X, ±Y, ±Z). 면의 네 경계 평면 (u ∓ v ≥ 0, u ∓ w ≥ 0)에서
 * 구 중심까지의 거리가 -r 이상이면 걸친다 (u = 축 방향 성분, v·w = 나머지 두 성분).
 */
export function sphereInCubeFace(dx: number, dy: number, dz: number, r: number, ax: number, ay: number, az: number): boolean {
  let u: number;
  let v: number;
  let w: number;
  if (ax !== 0) {
    u = ax * dx;
    v = dy;
    w = dz;
  } else if (ay !== 0) {
    u = ay * dy;
    v = dx;
    w = dz;
  } else {
    u = az * dz;
    v = dx;
    w = dy;
  }
  const m = -r * SQRT2;
  return u - v >= m && u + v >= m && u - w >= m && u + w >= m;
}
