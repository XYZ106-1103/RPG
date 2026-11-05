/**
 * 이동 포트: sim은 "의도"(원하는 속도 또는 루트 모션 이동량)만 정하고, 실제 위치는 이동 구현이 정해 엔티티에 다시 써넣는다.
 *
 *   틱 순서: 스탯 → 플레이어 상태 머신(의도) → 이동(MovementPort) → 전투 판정
 *
 * 클라이언트는 physics/character/의 Havok 캐릭터 컨트롤러(벽, 경사, 계단, 중력)를 주입하고,
 * 테스트/서버는 기본 구현 FlatMovement(평지 위 단순 적분)를 쓴다.
 */
import type { Entity, EntityId } from "./entity";

export type MovementMode = "velocity" | "rootMotion";

export interface MovementIntent {
  /**
   * velocity: velX/velZ(m/s)로 걷는다 — 중력/경사/계단은 이동 구현이 처리
   * rootMotion: 이번 틱 이동량 dx/dz(m)를 그대로 적용한다 — 벽/경사에는 막힘
   */
  mode: MovementMode;
  velX: number;
  velZ: number;
  dx: number;
  dz: number;
}

export function createMovementIntent(): MovementIntent {
  return { mode: "velocity", velX: 0, velZ: 0, dx: 0, dz: 0 };
}

export function clearMovementIntent(i: MovementIntent): MovementIntent {
  i.mode = "velocity";
  i.velX = 0;
  i.velZ = 0;
  i.dx = 0;
  i.dz = 0;
  return i;
}

export interface MovementPort {
  /** 엔티티가 월드에 들어올 때 (캡슐 컨트롤러 생성) */
  add(entity: Entity): void;
  remove(id: EntityId): void;
  /** 의도를 적용하고 entity.position / entity.grounded를 갱신한다 */
  move(entity: Entity, intent: Readonly<MovementIntent>, dt: number): void;
}

/**
 * 순수 TS 기본 구현: 높이를 유지한 채 XZ만 움직인다 (충돌 없음, 항상 접지).
 * 서버 권위 이동이 필요해지면 지형 높이 함수/간단한 충돌을 여기에 더한다.
 */
export class FlatMovement implements MovementPort {
  add(entity: Entity): void {
    entity.grounded = true;
  }

  remove(): void {}

  move(entity: Entity, intent: Readonly<MovementIntent>, dt: number): void {
    if (intent.mode === "rootMotion") {
      entity.position.x += intent.dx;
      entity.position.z += intent.dz;
    } else {
      entity.position.x += intent.velX * dt;
      entity.position.z += intent.velZ * dt;
    }
    entity.grounded = true;
  }
}
