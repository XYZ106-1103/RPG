/**
 * 타격감: sim 이벤트(hit, guard, weapon_bounce, parry)를 받아 로컬 연출을 낸다.
 *  - 히트스톱: 공격자/피격자 표시만 N프레임 정지 (sim 틱은 그대로)
 *  - 카메라 셰이크: 약공 약하게 / 강공(4프레임 히트스톱 공격)·백어택·경직 유발 강하게
 *  - 피격 리액션: 맞은 방향으로 살짝 밀림 + 흰색 플래시
 *  - 스파크: 타격 지점에서 thin instance 파티클
 * 모든 수치는 FeelSettings (?tune GUI로 실시간 조정).
 */
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { EventBus, Unsubscribe } from "../../core/eventBus";
import type { EntityId } from "../../sim/entity";
import type { GameEventMap } from "../../sim/events";
import type { CameraShake } from "../camera/shake";
import type { CharacterView } from "../player/characterView";
import { HITSTOP_FRAME_SECONDS, type FeelSettings, type ShakePreset } from "./feelSettings";
import { SparkRenderer } from "./sparks";

export interface HitFeedbackDeps {
  scene: Scene;
  events: EventBus<GameEventMap>;
  /** 엔티티 id → 표시 */
  viewOf: (id: EntityId) => CharacterView | undefined;
  shake: CameraShake;
  /** 카메라 주인 (이 엔티티가 관련된 타격만 흔든다 — shakeOnOthers가 꺼져 있으면) */
  heroId: EntityId;
}

export class HitFeedback {
  readonly hitSparks: SparkRenderer;
  readonly guardSparks: SparkRenderer;
  private readonly unsubs: Unsubscribe[] = [];

  constructor(
    private readonly deps: HitFeedbackDeps,
    readonly settings: FeelSettings,
  ) {
    this.hitSparks = new SparkRenderer(deps.scene, "hitSparks", new Color3(1.0, 0.62, 0.18));
    this.guardSparks = new SparkRenderer(deps.scene, "guardSparks", new Color3(0.75, 0.85, 1.0));
    const ev = deps.events;
    this.unsubs.push(
      ev.on("hit", (e) => {
        const heavy = e.hitstopFrames >= 4 || e.backAttack || e.staggered;
        this.hitstop([e.attacker, e.target], e.hitstopFrames * this.settings.hitstop.scale);
        this.shake(heavy ? this.settings.shake.heavy : this.settings.shake.light, e.attacker, e.target);
        this.react(e.target, e.knockback.x, e.knockback.z, 1);
        this.sparks(this.hitSparks, e.point, e.knockback, this.settings.sparks.hitCount);
      }),
      ev.on("guard", (e) => {
        this.hitstop([e.attacker, e.target], this.settings.hitstop.guardFrames);
        this.shake(e.broken ? this.settings.shake.heavy : this.settings.shake.guard, e.attacker, e.target);
        this.react(e.target, e.knockback.x, e.knockback.z, 0.5);
        // 막은 쪽에서 공격자 쪽으로 튄다
        this.sparks(this.guardSparks, e.point, { x: -e.knockback.x, y: 0.5, z: -e.knockback.z }, this.settings.sparks.guardCount);
      }),
      ev.on("weapon_bounce", (e) => {
        this.hitstop([e.attacker], this.settings.hitstop.bounceFrames);
        this.shake(this.settings.shake.bounce, e.attacker, e.attacker);
        this.sparks(this.guardSparks, e.point, e.normal, this.settings.sparks.bounceCount);
      }),
      ev.on("parry", (e) => {
        this.hitstop([e.attacker, e.parrier], this.settings.hitstop.parryFrames);
        this.shake(this.settings.shake.parry, e.attacker, e.parrier);
        this.sparks(this.guardSparks, e.point, { x: 0, y: 1, z: 0 }, this.settings.sparks.guardCount * 2);
      }),
    );
  }

  /** 렌더 프레임마다 (스파크 갱신) */
  update(dt: number): void {
    const s = this.settings.sparks;
    this.hitSparks.update(dt, s.gravity, s.size);
    this.guardSparks.update(dt, s.gravity, s.size);
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.hitSparks.dispose();
    this.guardSparks.dispose();
  }

  private hitstop(ids: readonly EntityId[], frames: number): void {
    const h = this.settings.hitstop;
    if (!h.enabled || !(frames > 0)) return;
    for (const id of ids) this.deps.viewOf(id)?.freeze(frames * HITSTOP_FRAME_SECONDS, h.catchUpSeconds);
  }

  private shake(preset: ShakePreset, a: EntityId, b: EntityId): void {
    const s = this.settings.shake;
    if (!s.enabled) return;
    if (!s.shakeOnOthers && a !== this.deps.heroId && b !== this.deps.heroId) return;
    this.deps.shake.add({ amplitude: preset.amplitude, duration: preset.duration, frequency: s.frequency });
  }

  private react(target: EntityId, kx: number, kz: number, scale: number): void {
    const v = this.deps.viewOf(target);
    if (!v) return;
    const r = this.settings.reaction;
    v.pushFrom(kx, kz, r.pushDistance * scale, r.pushSeconds);
    v.flash(r.flashSeconds, r.flashAlpha);
  }

  private sparks(r: SparkRenderer, p: Readonly<{ x: number; y: number; z: number }>, dir: Readonly<{ x: number; y: number; z: number }>, count: number): void {
    const s = this.settings.sparks;
    if (!s.enabled) return;
    r.burst(p.x, p.y, p.z, dir.x, dir.y, dir.z, { count: Math.round(count), speed: s.speed, spread: s.spread, life: s.life });
  }
}
