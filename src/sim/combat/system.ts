/**
 * 공격 인스턴스의 생명주기와 매 틱 판정.
 *
 *   const inst = combat.start(world, attacker, "attack_light_1"); // 스태미나 소모, attack_start
 *   combat.setActive(inst.id, true);   // 애니메이션 hit_start
 *   ... 매 틱 world.step()이 combat.step()을 호출 → HitQuery로 겹친 대상 판정
 *   combat.setActive(inst.id, false);  // hit_end
 *   combat.end(inst.id);               // 애니메이션 종료
 *
 * TODO(액션 시스템): 히트스톱(hitstopFrames) 동안 공격자/피격자의 액션 타이머 정지,
 *   넉백 벡터를 이동 시스템에 전달 — 지금은 이벤트에 값만 실어 보낸다.
 */
import { ATTACKS, type AttackId } from "../data/attacks";
import { isActionable, isDead, isStaggered, type Entity, type EntityId } from "../entity";
import type { EventSink } from "../events";
import { trySpend } from "../stats";
import { resolveHit, type ResolveContext } from "./resolve";
import { NO_HITS, type AttackInstance, type HitCandidate, type HitQuery } from "./types";

/** 직렬화용 공격 인스턴스 (Set → 정렬된 배열) */
export interface AttackInstanceState {
  id: number;
  attackerId: EntityId;
  attack: AttackId;
  startTick: number;
  active: boolean;
  hitList: EntityId[];
}

export interface CombatState {
  nextInstanceId: number;
  /** id 오름차순 */
  attacks: AttackInstanceState[];
}

/** 전투 시스템이 월드에 요구하는 것 (순환 의존을 피하기 위한 최소 인터페이스) */
export interface CombatWorld extends EventSink {
  readonly tick: number;
  get(id: EntityId): Entity | undefined;
}

export class CombatSystem {
  hitQuery: HitQuery;
  private nextInstanceId = 1;
  private readonly attacks: AttackInstance[] = [];
  private readonly candidates: HitCandidate[] = [];
  /** step 도중 종료된 인스턴스 (순회가 끝난 뒤 제거) */
  private readonly ended = new Set<number>();
  private stepping = false;

  constructor(hitQuery: HitQuery = NO_HITS) {
    this.hitQuery = hitQuery;
  }

  /** 진행 중인 공격 (id 오름차순) */
  get active(): readonly AttackInstance[] {
    return this.attacks;
  }

  get(instanceId: number): AttackInstance | undefined {
    return this.attacks.find((a) => a.id === instanceId && !this.ended.has(a.id));
  }

  /**
   * 공격 시작: 행동 가능 상태와 스태미나를 확인하고 소모한다. 불가능하면 null(상태 변화 없음).
   * 한 엔티티는 동시에 하나의 공격만 가진다 — 진행 중이던 공격은 종료된다 (콤보 다음 타로 넘어갈 때).
   */
  start(world: CombatWorld, attacker: Entity, attack: AttackId): AttackInstance | null {
    if (!isActionable(attacker)) return null;
    const def = ATTACKS[attack];
    if (!trySpend(attacker, def.staminaCost, def.staminaRegenDelaySeconds)) return null;
    this.endAllOf(attacker.id);
    const inst: AttackInstance = {
      id: this.nextInstanceId++,
      attackerId: attacker.id,
      attack,
      startTick: world.tick,
      active: false,
      hitList: new Set(),
    };
    this.attacks.push(inst);
    world.emit("attack_start", { attacker: attacker.id, attack, instance: inst.id });
    return inst;
  }

  /** 판정 구간 열기/닫기 (애니메이션 hit_start / hit_end) */
  setActive(instanceId: number, active: boolean): void {
    const inst = this.get(instanceId);
    if (inst) inst.active = active;
  }

  end(instanceId: number): void {
    if (this.stepping) {
      this.ended.add(instanceId);
      const inst = this.attacks.find((a) => a.id === instanceId);
      if (inst) inst.active = false;
      return;
    }
    const i = this.attacks.findIndex((a) => a.id === instanceId);
    if (i >= 0) this.attacks.splice(i, 1);
  }

  /** 엔티티의 모든 공격 종료 (사망/제거/새 공격 시작) */
  endAllOf(entityId: EntityId): void {
    for (const a of this.attacks) if (a.attackerId === entityId) this.end(a.id);
  }

  /** 매 틱: 활성 공격마다 HitQuery로 스윕하고 판정한다 */
  step(world: CombatWorld): void {
    this.stepping = true;
    const ctx: ResolveContext = {
      emit: (type, payload) => world.emit(type, payload),
      endAttack: (id) => this.end(id),
    };
    try {
      for (const inst of this.attacks) {
        if (this.ended.has(inst.id)) continue;
        const attacker = world.get(inst.attackerId);
        // 공격자가 사라졌거나 죽었거나 경직되면 공격은 끊긴다
        if (!attacker || isDead(attacker) || isStaggered(attacker)) {
          this.end(inst.id);
          continue;
        }
        if (!inst.active) continue;

        const out = this.candidates;
        out.length = 0;
        const block = this.hitQuery.sweep({ attacker, instance: inst, def: ATTACKS[inst.attack], tick: world.tick }, out);
        if (out.length > 1) out.sort((a, b) => a.target - b.target); // 결정성: 물리 결과 순서에 의존하지 않는다
        for (const c of out) {
          if (this.ended.has(inst.id)) break; // 패리당하면 남은 대상은 판정하지 않는다
          const target = world.get(c.target);
          if (target) resolveHit(ctx, inst, attacker, target, c.point);
        }
        // 벽에 막힘: 막히기 전 대상까지 판정한 뒤 튕김 이벤트를 내고 공격을 끝낸다
        // TODO(애니메이션): 튕김 리액션 애니메이션/경직
        if (block && !this.ended.has(inst.id)) {
          world.emit("weapon_bounce", {
            attacker: attacker.id,
            attack: inst.attack,
            instance: inst.id,
            point: { x: block.point.x, y: block.point.y, z: block.point.z },
            normal: { x: block.normal.x, y: block.normal.y, z: block.normal.z },
          });
          this.end(inst.id);
        }
      }
    } finally {
      this.stepping = false;
      if (this.ended.size > 0) {
        for (let i = this.attacks.length - 1; i >= 0; i--) {
          const a = this.attacks[i];
          if (a && this.ended.has(a.id)) this.attacks.splice(i, 1);
        }
        this.ended.clear();
      }
    }
  }

  toState(): CombatState {
    return {
      nextInstanceId: this.nextInstanceId,
      attacks: this.attacks.map((a) => ({
        id: a.id,
        attackerId: a.attackerId,
        attack: a.attack,
        startTick: a.startTick,
        active: a.active,
        hitList: [...a.hitList].sort((x, y) => x - y),
      })),
    };
  }

  loadState(state: Readonly<CombatState>): void {
    this.nextInstanceId = state.nextInstanceId;
    this.attacks.length = 0;
    this.ended.clear();
    const sorted = [...state.attacks].sort((a, b) => a.id - b.id);
    for (const a of sorted) {
      this.attacks.push({ id: a.id, attackerId: a.attackerId, attack: a.attack, startTick: a.startTick, active: a.active, hitList: new Set(a.hitList) });
    }
  }
}
