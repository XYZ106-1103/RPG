/**
 * sim 월드: 엔티티 집합, 틱 카운터, 결정적 난수, 이벤트 큐.
 *
 * 결정성 규칙 (멀티플레이/리플레이):
 *  - 엔티티는 항상 id 오름차순으로 처리한다.
 *  - 난수는 world.rng만 쓴다 (Math.random 금지).
 *  - 상태는 toState()/SimWorld.fromState()로 완전히 저장·복원된다 (직렬화는 serialize.ts).
 */
import { CombatSystem, type CombatState } from "./combat/system";
import type { HitQuery } from "./combat/types";
import type { ArchetypeId } from "./data/archetypes";
import { createEntity, type Entity, type EntityId, type Team } from "./entity";
import type { EventSink, GameEventMap, SimEvent } from "./events";
import type { ReadonlyVec3 } from "./math/vec3";
import { FlatMovement, createMovementIntent, type MovementPort } from "./movement";
import { PlayerSystem, type PlayerTimelineOverrides } from "./player/system";
import type { PlayerState } from "./player/types";
import { Rng } from "./rng";
import { tickStats } from "./stats";
import { SIM_DT } from "./time";

export interface SimWorldOptions {
  /** 난수 시드 (u32). 기본 1 */
  seed?: number;
  /** 무기 판정 셰이프캐스트 구현 (physics/가 주입). 기본: 아무것도 맞지 않음 */
  hitQuery?: HitQuery;
  /** 애니메이션 이벤트에서 읽은 플레이어 타임라인 (TimelineLoader 결과). 없는 행동은 기본값 */
  playerTimelines?: PlayerTimelineOverrides;
  /** 이동 구현 (physics/가 캐릭터 컨트롤러를 주입). 기본: FlatMovement */
  movement?: MovementPort;
}

/** 월드의 전체 상태 (직렬화 대상). 대기 중 이벤트는 일시적인 출력이므로 포함하지 않는다. */
export interface WorldState {
  tick: number;
  nextId: EntityId;
  rngState: number;
  /** id 오름차순 */
  entities: Entity[];
  /** 진행 중인 공격 */
  combat: CombatState;
  /** 플레이어 행동 상태 머신 */
  players: PlayerState[];
}

export class SimWorld implements EventSink {
  private tickCount = 0;
  private nextId: EntityId = 1;
  private readonly list: Entity[] = [];
  private readonly byId = new Map<EntityId, Entity>();
  private readonly pending: SimEvent[] = [];
  readonly rng: Rng;
  readonly combat: CombatSystem;
  readonly players: PlayerSystem;
  readonly movement: MovementPort;
  private readonly intent = createMovementIntent();

  constructor(options: SimWorldOptions = {}) {
    this.rng = new Rng(options.seed ?? 1);
    this.combat = new CombatSystem(options.hitQuery);
    this.players = new PlayerSystem(options.playerTimelines);
    this.movement = options.movement ?? new FlatMovement();
  }

  get tick(): number {
    return this.tickCount;
  }

  /** id 오름차순 엔티티 목록 (읽기 전용 — 추가/제거는 spawn/remove로) */
  get entities(): readonly Entity[] {
    return this.list;
  }

  get(id: EntityId): Entity | undefined {
    return this.byId.get(id);
  }

  spawn(archetype: ArchetypeId, team: Team, position: ReadonlyVec3, yaw = 0): Entity {
    const e = createEntity(this.nextId++, archetype, team, position, yaw);
    this.list.push(e); // nextId가 단조 증가하므로 정렬이 유지된다
    this.byId.set(e.id, e);
    this.movement.add(e);
    return e;
  }

  /** 플레이어 엔티티를 만들고 행동 상태 머신을 붙인다 */
  spawnPlayer(position: ReadonlyVec3, yaw = 0): Entity {
    const e = this.spawn("player", "player", position, yaw);
    this.players.add(e.id);
    return e;
  }

  remove(id: EntityId): boolean {
    const e = this.byId.get(id);
    if (!e) return false;
    this.byId.delete(id);
    this.list.splice(this.list.indexOf(e), 1);
    this.combat.endAllOf(id);
    this.players.remove(id);
    this.movement.remove(id);
    return true;
  }

  /**
   * 한 틱 진행 (60Hz 고정 스텝에서 호출): 스탯 → 플레이어 상태 머신(의도) → 이동 → 전투 판정.
   * - 상태 머신이 켠 i-frame/판정 구간이 같은 틱의 전투 판정에 반영된다.
   * - 전투 판정은 이번 틱 이동이 끝난 위치로 한다.
   */
  step(): void {
    this.tickCount++;
    for (const e of this.list) tickStats(e);
    this.players.step(this);
    for (const e of this.list) {
      this.players.intentOf(e.id, this.intent); // 플레이어가 아니면 정지 의도 (중력은 이동 구현이 처리)
      this.movement.move(e, this.intent, SIM_DT);
    }
    this.combat.step(this);
  }

  emit<K extends keyof GameEventMap>(type: K, payload: GameEventMap[K]): void {
    this.pending.push({ tick: this.tickCount, type, payload } as SimEvent);
  }

  /** 쌓인 이벤트를 out 배열 뒤에 붙이고 비운다 (out을 재사용하면 할당 없음) */
  drainEvents(out: SimEvent[] = []): SimEvent[] {
    for (const ev of this.pending) out.push(ev);
    this.pending.length = 0;
    return out;
  }

  get pendingEventCount(): number {
    return this.pending.length;
  }

  /** 전체 상태의 깊은 복사본 */
  toState(): WorldState {
    return {
      tick: this.tickCount,
      nextId: this.nextId,
      rngState: this.rng.getState(),
      entities: this.list.map(cloneEntity),
      combat: this.combat.toState(),
      players: this.players.toState(),
    };
  }

  /**
   * 상태에서 월드를 복원한다. 입력 검증은 serialize.ts의 deserializeWorld가 담당한다.
   * hitQuery 같은 외부 구현은 상태가 아니므로 options로 다시 주입한다.
   */
  static fromState(state: Readonly<WorldState>, options: Omit<SimWorldOptions, "seed"> = {}): SimWorld {
    const w = new SimWorld(options);
    w.tickCount = state.tick;
    w.nextId = state.nextId;
    w.rng.setState(state.rngState);
    const sorted = state.entities.map(cloneEntity).sort((a, b) => a.id - b.id);
    for (const e of sorted) {
      w.list.push(e);
      w.byId.set(e.id, e);
      w.movement.add(e);
    }
    w.combat.loadState(state.combat);
    w.players.loadState(state.players);
    return w;
  }
}

export function cloneEntity(e: Readonly<Entity>): Entity {
  return { ...e, position: { x: e.position.x, y: e.position.y, z: e.position.z } };
}
