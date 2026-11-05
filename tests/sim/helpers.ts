import type { ArchetypeId } from "../../src/sim/data/archetypes";
import type { Team } from "../../src/sim/entity";
import { SimWorld } from "../../src/sim/world";

export function worldWith(archetype: ArchetypeId = "player", team: Team = "player") {
  const world = new SimWorld({ seed: 42 });
  const e = world.spawn(archetype, team, { x: 0, y: 0, z: 0 });
  return { world, e };
}

export function stepN(world: SimWorld, n: number): void {
  for (let i = 0; i < n; i++) world.step();
}
