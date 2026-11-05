/**
 * sim MovementPort의 Havok 구현: 엔티티마다 캡슐 캐릭터 컨트롤러를 두고,
 * sim의 이동 의도를 적용한 뒤 실제 위치/접지 여부를 엔티티에 다시 써넣는다.
 *
 *   sim(의도) ──move()──▶ CharacterController(충돌/중력/경사/계단) ──▶ entity.position, entity.grounded
 */
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { ARCHETYPES } from "../../sim/data/archetypes";
import type { Entity, EntityId } from "../../sim/entity";
import type { MovementIntent, MovementPort } from "../../sim/movement";
import type { PhysicsWorld } from "../physicsWorld";
import { CharacterController, type FootPosition } from "./characterController";

export class CharacterSystem implements MovementPort {
  private readonly controllers = new Map<EntityId, CharacterController>();
  private readonly bodyToEntity = new Map<PhysicsBody, EntityId>();
  private readonly foot: FootPosition = { x: 0, y: 0, z: 0 };

  constructor(private readonly world: PhysicsWorld) {}

  add(entity: Entity): void {
    if (this.controllers.has(entity.id)) return;
    const a = ARCHETYPES[entity.archetype];
    const c = new CharacterController(this.world, entity.position, {
      height: a.height,
      radius: a.radius,
      layer: entity.team === "player" ? "PLAYER" : "ENEMY",
    });
    this.controllers.set(entity.id, c);
    this.bodyToEntity.set(c.body, entity.id);
  }

  remove(id: EntityId): void {
    const c = this.controllers.get(id);
    if (!c) return;
    this.bodyToEntity.delete(c.body);
    c.dispose();
    this.controllers.delete(id);
  }

  move(entity: Entity, intent: Readonly<MovementIntent>, dt: number): void {
    const c = this.controllers.get(entity.id);
    if (!c) return;
    if (intent.mode === "rootMotion") c.moveRootMotion(intent.dx, intent.dz, dt);
    else c.moveVelocity(intent.velX, intent.velZ, dt);
    c.getFootPosition(this.foot);
    entity.position.x = this.foot.x;
    entity.position.y = this.foot.y;
    entity.position.z = this.foot.z;
    entity.grounded = c.grounded;
  }

  /** 엔티티를 순간이동시킨다 (리스폰 등). sim 위치도 같이 맞춘다 */
  teleport(entity: Entity, foot: FootPosition): void {
    this.controllers.get(entity.id)?.teleport(foot);
    entity.position.x = foot.x;
    entity.position.y = foot.y;
    entity.position.z = foot.z;
  }

  get(id: EntityId): CharacterController | undefined {
    return this.controllers.get(id);
  }

  bodyOf(id: EntityId): PhysicsBody | undefined {
    return this.controllers.get(id)?.body;
  }

  entityOfBody(body: PhysicsBody): EntityId | undefined {
    return this.bodyToEntity.get(body);
  }

  dispose(): void {
    for (const id of [...this.controllers.keys()]) this.remove(id);
  }
}
