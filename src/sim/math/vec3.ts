/**
 * sim 전용 3차원 벡터 (Babylon 비의존).
 *
 * 할당을 피하기 위해 모든 연산은 결과를 out 파라미터에 쓰고 out을 반환한다.
 * out은 입력 인자와 같은 객체여도 안전하다 (예: add(a, a, b)).
 * 새 벡터는 vec3()로 초기화 시점에만 만들고, 매 틱 루프 안에서는 만들지 않는다.
 *
 * 좌표계는 Babylon과 같은 왼손 좌표계, Y 위. yaw=0이면 +Z를 바라보고 +X 쪽으로 증가한다.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type ReadonlyVec3 = Readonly<Vec3>;

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy(out: Vec3, a: ReadonlyVec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function add(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function sub(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function scale(out: Vec3, a: ReadonlyVec3, s: number): Vec3 {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

/** out = a + b * s */
export function scaleAndAdd(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3, s: number): Vec3 {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  out.z = a.z + b.z * s;
  return out;
}

export function lerp(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

export function dot(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** 왼손 좌표계에서도 공식은 같다: cross(+X, +Y) = +Z */
export function cross(out: Vec3, a: ReadonlyVec3, b: ReadonlyVec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function lengthSq(a: ReadonlyVec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function length(a: ReadonlyVec3): number {
  return Math.sqrt(lengthSq(a));
}

export function distanceSq(a: ReadonlyVec3, b: ReadonlyVec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distance(a: ReadonlyVec3, b: ReadonlyVec3): number {
  return Math.sqrt(distanceSq(a, b));
}

/** 수평(XZ) 거리 — 지형 높이 차이를 무시한 거리 판정용 */
export function distanceXZ(a: ReadonlyVec3, b: ReadonlyVec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** 길이 1로 정규화. 길이가 0에 가까우면 out을 (0,0,0)으로 둔다. */
export function normalize(out: Vec3, a: ReadonlyVec3): Vec3 {
  const len = length(a);
  if (len < 1e-12) return set(out, 0, 0, 0);
  return scale(out, a, 1 / len);
}

/** Y축 기준 yaw 회전 (yaw 규약은 파일 머리말 참고) */
export function rotateY(out: Vec3, a: ReadonlyVec3, yaw: number): Vec3 {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const x = a.x * c + a.z * s;
  const z = -a.x * s + a.z * c;
  out.x = x;
  out.y = a.y;
  out.z = z;
  return out;
}

/** yaw 방향의 수평 단위 벡터 */
export function fromYaw(out: Vec3, yaw: number): Vec3 {
  return set(out, Math.sin(yaw), 0, Math.cos(yaw));
}

/** 수평 방향 벡터의 yaw (XZ가 0이면 0) */
export function toYaw(a: ReadonlyVec3): number {
  return a.x === 0 && a.z === 0 ? 0 : Math.atan2(a.x, a.z);
}

export function equalsApprox(a: ReadonlyVec3, b: ReadonlyVec3, epsilon = 1e-9): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon && Math.abs(a.z - b.z) <= epsilon;
}

export function isFiniteVec3(a: ReadonlyVec3): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
}
