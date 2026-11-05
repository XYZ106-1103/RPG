import type { Entity } from "../entity";
import { tickPoise } from "./poise";
import { tickStamina } from "./stamina";

export * from "./health";
export * from "./poise";
export * from "./stamina";

/** 엔티티 한 개의 스탯을 한 틱 진행한다 */
export function tickStats(e: Entity): void {
  tickPoise(e);
  tickStamina(e);
}
