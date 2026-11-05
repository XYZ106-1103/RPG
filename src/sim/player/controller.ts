/**
 * 플레이어 행동 상태 머신 (한 틱 진행).
 *
 * InputFrame 하나와 현재 상태만으로 다음 상태가 결정된다 (결정론적 — 같은 입력열이면 같은 결과).
 *
 *   강제 전이: 사망(DEAD) → death, 경직(STAGGERED) → stagger  (어떤 상태에서든)
 *   자유 상태: idle / move / sprint / guard — 행동 입력을 즉시 실행
 *   행동 상태: attack / roll / backstep / drink — 타임라인을 따라 진행
 *     - 버퍼 구간에 누른 행동은 예약 (마지막 입력이 우선)
 *     - 캔슬 틱부터 예약/새 입력을 실행, 이동·가드 입력으로 후딜을 끊을 수 있음
 *     - 길이가 끝나면 자유 상태로
 *   버퍼 구간 밖(캔슬 전)에 누른 입력은 버린다.
 *
 * 매 틱 world.step()에서 스탯 갱신 뒤, 전투 판정 전에 호출된다.
 * 그래서 여기서 켠 i-frame/판정 구간이 같은 틱의 전투 판정에 바로 반영된다.
 */
import type { CombatSystem, CombatWorld } from "../combat/system";
import type { AttackId } from "../data/attacks";
import { PLAYER_ITEMS, PLAYER_MOVEMENT } from "../data/player";
import type { PlayerActionId, PlayerTimelineTable } from "../data/playerTimelines";
import { FLAG, isDead, isStaggered, setFlag, type Entity } from "../entity";
import { BUTTON, type InputFrame } from "../inputFrame";
import { approachAngle, wrapAngle } from "../math/scalar";
import { hasStaminaToAct, heal, setSprinting, tryPerform } from "../stats";
import { SIM_DT } from "../time";
import { inWindow, rootMotionDelta } from "./timeline";
import { isActionState, type PlayerState, type PlayerStateId, type PlayerVerb } from "./types";

export interface PlayerWorld extends CombatWorld {
  readonly combat: CombatSystem;
}

/** 같은 틱에 여러 버튼이 눌렸을 때의 우선순위 */
const VERB_PRIORITY: readonly [PlayerVerb, number][] = [
  ["roll", BUTTON.roll],
  ["light", BUTTON.attack_light],
  ["heavy", BUTTON.attack_heavy],
  ["drink", BUTTON.use_item],
];

/** 플레이어 행동 중 공격인 것 */
type PlayerAttackId = Extract<PlayerActionId, AttackId>;

const LIGHT_COMBO: Partial<Record<PlayerActionId, PlayerAttackId>> = {
  attack_light_1: "attack_light_2",
  attack_light_2: "attack_light_3",
  attack_light_3: "attack_light_1",
};

export function pickVerb(frame: Readonly<InputFrame>): PlayerVerb | null {
  if (frame.pressed === 0) return null;
  for (const [verb, bit] of VERB_PRIORITY) if (frame.pressed & bit) return verb;
  return null;
}

/** 이동 입력을 월드 방향으로: 스틱 공간(x=오른쪽, y=앞)을 카메라 yaw만큼 회전 */
interface WorldMove {
  x: number;
  z: number;
  magnitude: number;
  yaw: number;
}

const move: WorldMove = { x: 0, z: 0, magnitude: 0, yaw: 0 };

function readMove(frame: Readonly<InputFrame>): WorldMove {
  const s = Math.sin(frame.viewYaw);
  const c = Math.cos(frame.viewYaw);
  move.x = s * frame.moveY + c * frame.moveX;
  move.z = c * frame.moveY - s * frame.moveX;
  move.magnitude = Math.min(1, Math.hypot(frame.moveX, frame.moveY));
  move.yaw = move.magnitude > 0 ? Math.atan2(move.x, move.z) : 0;
  return move;
}

/** 한 틱 처리기. 틱마다 객체를 만들지 않도록 하나를 재사용한다 (CLAUDE.md: 매 프레임 할당 최소화). */
class PlayerStep {
  private world!: PlayerWorld;
  private timelines!: PlayerTimelineTable;
  private p!: PlayerState;
  private e!: Entity;
  private frame!: Readonly<InputFrame>;

  run(world: PlayerWorld, timelines: PlayerTimelineTable, p: PlayerState, e: Entity, frame: Readonly<InputFrame>): void {
    this.world = world;
    this.timelines = timelines;
    this.p = p;
    this.e = e;
    this.frame = frame;
    readMove(frame);
    // 이번 틱 이동 의도 초기화 — 루트 모션 행동이면 applyWindows가 다시 채운다
    p.moveMode = "velocity";
    p.rootDeltaX = 0;
    p.rootDeltaZ = 0;

    // --- 강제 전이 ---
    if (isDead(e)) {
      if (p.state !== "death") this.enterForced("death");
      return;
    }
    if (isStaggered(e)) {
      if (p.state !== "stagger") this.enterForced("stagger");
      return;
    }

    if (isActionState(p.state) && this.stepAction()) return;
    // 사망에서 부활했거나, 경직이 풀렸거나, 행동이 끝났거나, 자유 상태
    this.stepFree();
  }

  /** @returns 이번 틱을 행동 상태에서 마쳤는가 (false면 자유 상태로 이어서 처리) */
  private stepAction(): boolean {
    const { p } = this;
    const action = p.action;
    if (!action) return false;
    const tl = this.timelines[action];
    p.stateTick++;

    if (p.stateTick >= tl.length) {
      this.leaveAction();
      return false;
    }

    // 입력 버퍼: 버퍼 구간이나 캔슬 이후에 누른 행동만 예약 (마지막 입력 우선). 그 밖은 버린다.
    const verb = pickVerb(this.frame);
    if (verb && (inWindow(tl.buffer, p.stateTick) || p.stateTick >= tl.cancel)) p.reserved = verb;

    if (p.stateTick >= tl.cancel) {
      const reserved = p.reserved;
      if (reserved) {
        p.reserved = null;
        if (this.tryVerb(reserved)) return true;
      }
      // 후딜 캔슬: 이동/가드 입력이 있으면 자유 상태로
      if (move.magnitude >= PLAYER_MOVEMENT.moveDeadzone || this.frame.held & BUTTON.guard) {
        this.leaveAction();
        return false;
      }
    }

    this.applyWindows();
    return true;
  }

  private stepFree(): void {
    const { p, e, frame } = this;
    const verb = pickVerb(frame);
    if (verb && this.tryVerb(verb)) return;

    const moving = move.magnitude >= PLAYER_MOVEMENT.moveDeadzone;
    const guard = (frame.held & BUTTON.guard) !== 0;
    let next: PlayerStateId;
    if (guard) next = "guard";
    else if (moving && frame.held & BUTTON.sprint && hasStaminaToAct(e)) next = "sprint";
    else next = moving ? "move" : "idle";

    setFlag(e, FLAG.GUARDING, next === "guard");
    if (!setSprinting(e, next === "sprint") && next === "sprint") next = "move";

    let speed = 0;
    if (moving) {
      if (next === "guard") speed = PLAYER_MOVEMENT.guardSpeed;
      else if (next === "sprint") speed = PLAYER_MOVEMENT.sprintSpeed;
      else speed = move.magnitude < PLAYER_MOVEMENT.walkThreshold ? PLAYER_MOVEMENT.walkSpeed : PLAYER_MOVEMENT.runSpeed;
      e.yaw = approachAngle(e.yaw, move.yaw, PLAYER_MOVEMENT.turnRate * SIM_DT);
    }
    const len = Math.hypot(move.x, move.z);
    p.moveX = moving && len > 0 ? (move.x / len) * speed : 0;
    p.moveZ = moving && len > 0 ? (move.z / len) * speed : 0;

    this.changeState(next, null);
  }

  /** 행동 실행 시도. 스태미나/회복약이 없으면 상태를 바꾸지 않고 false */
  private tryVerb(verb: PlayerVerb): boolean {
    const { p, e } = this;
    const moving = move.magnitude >= PLAYER_MOVEMENT.moveDeadzone;
    switch (verb) {
      case "light": {
        const combo = p.state === "attack" && p.action ? LIGHT_COMBO[p.action] : undefined;
        const id: PlayerAttackId = combo ?? (p.state === "sprint" ? "attack_run" : "attack_light_1");
        return this.startAttack(id, moving);
      }
      case "heavy":
        return this.startAttack("attack_heavy", moving);
      case "roll": {
        // 이동 입력 방향으로 구르기, 입력이 없으면 백스텝
        const action = moving ? "roll" : "backstep";
        if (!tryPerform(e, action)) return this.reject(action, "stamina");
        this.enterAction(action, null);
        if (moving) e.yaw = move.yaw;
        p.actionYaw = moving ? move.yaw : wrapAngle(e.yaw + Math.PI);
        return true;
      }
      case "drink": {
        if (p.flasks <= 0) return this.reject("drink", "no_flask");
        if (!tryPerform(e, "drink")) return this.reject("drink", "stamina");
        p.flasks--;
        this.enterAction("drink", null);
        return true;
      }
    }
  }

  private startAttack(id: PlayerAttackId, moving: boolean): boolean {
    // 진행 중인 공격(콤보 이전 타)은 combat.start가 끝낸다
    const inst = this.world.combat.start(this.world, this.e, id);
    if (!inst) return this.reject(id, "stamina");
    if (moving) this.e.yaw = move.yaw; // 공격 방향은 입력 방향으로 즉시 전환
    this.enterAction(id, inst.id);
    return true;
  }

  private reject(action: string, reason: "stamina" | "no_flask"): false {
    this.world.emit("action_rejected", { entity: this.e.id, action, reason });
    return false;
  }

  private enterAction(action: PlayerActionId, attackInstance: number | null): void {
    const { p, e } = this;
    const prevInstance = p.attackInstance;
    if (prevInstance !== null && prevInstance !== attackInstance) this.world.combat.end(prevInstance);
    setFlag(e, FLAG.GUARDING, false);
    setSprinting(e, false);
    p.moveX = 0;
    p.moveZ = 0;
    p.reserved = null;
    p.attackInstance = attackInstance;
    p.actionYaw = e.yaw;
    const state: PlayerStateId = action === "roll" || action === "backstep" || action === "drink" ? action : "attack";
    this.changeState(state, action, true);
    this.applyWindows();
  }

  /** 현재 틱에 맞춰 타임라인 구간을 적용한다 (무적, 슈퍼아머, 판정, 효과) */
  private applyWindows(): void {
    const { p, e } = this;
    if (!p.action) return;
    const tl = this.timelines[p.action];
    const t = p.stateTick;
    setFlag(e, FLAG.INVULNERABLE, inWindow(tl.iframes, t));
    setFlag(e, FLAG.SUPER_ARMOR, inWindow(tl.superArmor, t));
    if (p.attackInstance !== null) this.world.combat.setActive(p.attackInstance, inWindow(tl.hit, t));
    if (tl.rootMotion) {
      const d = rootMotionDelta(tl.rootMotion, t);
      p.moveMode = "rootMotion";
      p.rootDeltaX = Math.sin(p.actionYaw) * d;
      p.rootDeltaZ = Math.cos(p.actionYaw) * d;
    }
    if (tl.effect === t && p.action === "drink") {
      const amount = heal(e, e.maxHealth * PLAYER_ITEMS.flaskHealFraction);
      this.world.emit("heal", { entity: e.id, amount });
    }
  }

  private leaveAction(): void {
    const { p, e } = this;
    setFlag(e, FLAG.INVULNERABLE, false);
    setFlag(e, FLAG.SUPER_ARMOR, false);
    if (p.attackInstance !== null) this.world.combat.end(p.attackInstance);
    p.attackInstance = null;
    p.reserved = null;
  }

  private enterForced(state: "death" | "stagger"): void {
    const { p, e } = this;
    this.leaveAction();
    if (state === "stagger") {
      setSprinting(e, false);
      setFlag(e, FLAG.GUARDING, false);
    }
    p.moveX = 0;
    p.moveZ = 0;
    this.changeState(state, null, true);
  }

  private changeState(state: PlayerStateId, action: PlayerActionId | null, restart = false): void {
    const { p } = this;
    if (p.state === state && p.action === action && !restart) return;
    const from = p.state;
    const changed = from !== state || p.action !== action;
    p.state = state;
    p.action = action;
    p.stateTick = 0;
    if (changed || restart) this.world.emit("state_change", { entity: p.entityId, from, to: state, action });
  }
}

/** 플레이어 하나를 한 틱 진행한다 */
const stepper = new PlayerStep();

export function stepPlayer(world: PlayerWorld, timelines: PlayerTimelineTable, p: PlayerState, e: Entity, frame: Readonly<InputFrame>): void {
  stepper.run(world, timelines, p, e, frame);
}

export function createPlayerState(entityId: number): PlayerState {
  return {
    entityId,
    state: "idle",
    action: null,
    stateTick: 0,
    reserved: null,
    attackInstance: null,
    flasks: PLAYER_ITEMS.maxFlasks,
    actionYaw: 0,
    moveX: 0,
    moveZ: 0,
    moveMode: "velocity",
    rootDeltaX: 0,
    rootDeltaZ: 0,
  };
}
