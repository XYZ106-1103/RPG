/**
 * 충돌 레이어 (Havok 셰이프 필터 마스크). Babylon 비의존 — Node 테스트와 서버에서도 쓴다.
 *
 * Havok 규칙: 두 셰이프 A, B는
 *   (A.membership & B.collideMask) !== 0  그리고  (B.membership & A.collideMask) !== 0
 * 일 때만 충돌한다. 그래서 표가 대칭이어야 의도대로 동작한다 (tests/physics/layers.test.ts가 검사).
 *
 * CLAUDE.md 표 (2026-11 대칭으로 수정):
 * | 레이어       | 충돌 대상                                   |
 * |-------------|---------------------------------------------|
 * | PLAYER      | ENVIRONMENT, ENEMY, TRIGGER, PROJECTILE     |
 * | ENEMY       | ENVIRONMENT, PLAYER, ENEMY, PROJECTILE      |
 * | ENVIRONMENT | TRIGGER를 제외한 모두                        |
 * | TRIGGER     | PLAYER (오버랩만)                            |
 * | PROJECTILE  | ENVIRONMENT, PLAYER, ENEMY                  |
 */

export const LAYER = {
  PLAYER: 1 << 0,
  ENEMY: 1 << 1,
  ENVIRONMENT: 1 << 2,
  TRIGGER: 1 << 3,
  PROJECTILE: 1 << 4,
} as const;

export type LayerName = keyof typeof LAYER;

export const LAYER_NAMES = Object.keys(LAYER) as LayerName[];

/** 레이어별 충돌 대상 — CLAUDE.md 표를 그대로 옮긴 원본 데이터 */
export const COLLISION_TABLE: Readonly<Record<LayerName, readonly LayerName[]>> = {
  PLAYER: ["ENVIRONMENT", "ENEMY", "TRIGGER", "PROJECTILE"],
  ENEMY: ["ENVIRONMENT", "PLAYER", "ENEMY", "PROJECTILE"],
  ENVIRONMENT: ["PLAYER", "ENEMY", "ENVIRONMENT", "PROJECTILE"],
  TRIGGER: ["PLAYER"],
  PROJECTILE: ["ENVIRONMENT", "PLAYER", "ENEMY"],
};

/** 오버랩 이벤트만 내고 충돌 응답(밀어내기)은 하지 않는 레이어 */
export const OVERLAP_ONLY_LAYERS: readonly LayerName[] = ["TRIGGER"];

/** 셰이프의 filterMembershipMask: 자기 레이어 비트 */
export function membershipOf(layer: LayerName): number {
  return LAYER[layer];
}

/** 셰이프의 filterCollideMask: 표의 충돌 대상 비트 합 */
export function collideMaskOf(layer: LayerName): number {
  let mask = 0;
  for (const other of COLLISION_TABLE[layer]) mask |= LAYER[other];
  return mask;
}

/** Havok과 같은 양방향 규칙으로 두 레이어가 충돌(또는 오버랩)하는지 */
export function shouldCollide(a: LayerName, b: LayerName): boolean {
  return (membershipOf(a) & collideMaskOf(b)) !== 0 && (membershipOf(b) & collideMaskOf(a)) !== 0;
}

/** 한쪽만 상대를 지정한 쌍 (비어 있어야 정상) */
export function findAsymmetricPairs(table: Readonly<Record<LayerName, readonly LayerName[]>> = COLLISION_TABLE): [LayerName, LayerName][] {
  const out: [LayerName, LayerName][] = [];
  for (const a of LAYER_NAMES) {
    for (const b of table[a]) {
      if (!table[b].includes(a)) out.push([a, b]);
    }
  }
  return out;
}

export function isOverlapOnly(layer: LayerName): boolean {
  return OVERLAP_ONLY_LAYERS.includes(layer);
}
