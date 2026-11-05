/**
 * 플레이어 시스템: 플레이어 엔티티별 상태 머신 상태와 이번 틱 입력을 보관하고 매 틱 진행한다.
 *
 *   world.players.setInput(playerId, frame);  // sim 틱마다 (클라이언트: InputManager.sampleFrame / 서버: 네트워크 수신)
 *   world.step();                             // 스탯 → 플레이어 → 전투
 *
 * 입력이 오지 않은 틱은 빈 입력(아무것도 누르지 않음)으로 처리한다. 입력은 그 틱에만 쓰이고 상태에 남지 않는다.
 */
import { PLAYER_TIMELINES, type PlayerActionId, type PlayerTimelineTable } from "../data/playerTimelines";
import type { EntityId } from "../entity";
import { copyInputFrame, createInputFrame, type InputFrame } from "../inputFrame";
import { clearMovementIntent, type MovementIntent } from "../movement";
import { createPlayerState, stepPlayer, type PlayerWorld } from "./controller";
import type { ActionTimeline } from "./timeline";
import type { PlayerState } from "./types";

export type PlayerTimelineOverrides = Partial<Record<PlayerActionId, ActionTimeline>>;

const EMPTY_INPUT: Readonly<InputFrame> = Object.freeze(createInputFrame());

export class PlayerSystem {
  readonly timelines: PlayerTimelineTable;
  /** entityId 오름차순 */
  private readonly players: PlayerState[] = [];
  /** 이번 틱 입력 (플레이어별로 재사용하는 버퍼) */
  private readonly inputs = new Map<EntityId, InputFrame>();
  private readonly hasInput = new Set<EntityId>();

  /** @param overrides TimelineLoader로 읽은 애니메이션 타임라인 (없는 행동은 기본값) */
  constructor(overrides: PlayerTimelineOverrides = {}) {
    this.timelines = { ...PLAYER_TIMELINES, ...overrides };
  }

  get all(): readonly PlayerState[] {
    return this.players;
  }

  get(entityId: EntityId): PlayerState | undefined {
    return this.players.find((p) => p.entityId === entityId);
  }

  add(entityId: EntityId): PlayerState {
    const existing = this.get(entityId);
    if (existing) return existing;
    const p = createPlayerState(entityId);
    this.players.push(p);
    this.players.sort((a, b) => a.entityId - b.entityId);
    return p;
  }

  remove(entityId: EntityId): void {
    const i = this.players.findIndex((p) => p.entityId === entityId);
    if (i >= 0) this.players.splice(i, 1);
    this.inputs.delete(entityId);
    this.hasInput.delete(entityId);
  }

  /** 다음 step()에서 쓸 입력. 값을 복사하므로 호출자는 frame 객체를 재사용해도 된다. */
  setInput(entityId: EntityId, frame: Readonly<InputFrame>): void {
    let buf = this.inputs.get(entityId);
    if (!buf) {
      buf = createInputFrame();
      this.inputs.set(entityId, buf);
    }
    copyInputFrame(buf, frame);
    this.hasInput.add(entityId);
  }

  step(world: PlayerWorld): void {
    for (const p of this.players) {
      const e = world.get(p.entityId);
      if (!e) continue;
      const frame = this.hasInput.has(p.entityId) ? (this.inputs.get(p.entityId) ?? EMPTY_INPUT) : EMPTY_INPUT;
      stepPlayer(world, this.timelines, p, e, frame);
    }
    this.hasInput.clear();
  }

  /** 이 엔티티의 이번 틱 이동 의도를 out에 담는다. 플레이어가 아니면 false (out은 정지 의도로 초기화) */
  intentOf(entityId: EntityId, out: MovementIntent): boolean {
    clearMovementIntent(out);
    const p = this.get(entityId);
    if (!p) return false;
    out.mode = p.moveMode;
    out.velX = p.moveX;
    out.velZ = p.moveZ;
    out.dx = p.rootDeltaX;
    out.dz = p.rootDeltaZ;
    return true;
  }

  toState(): PlayerState[] {
    return this.players.map((p) => ({ ...p }));
  }

  loadState(states: readonly PlayerState[]): void {
    this.players.length = 0;
    this.inputs.clear();
    this.hasInput.clear();
    for (const s of states) this.players.push({ ...s });
    this.players.sort((a, b) => a.entityId - b.entityId);
  }
}
