/**
 * 캐릭터 GLB 모델 표시: 캡슐 대신 스킨 메시 + 애니메이터.
 * 보간/히트스톱/밀림/플래시는 CharacterView 그대로 쓰고, 메시 반영(apply)과 효과(applyEffects)만 바꾼다.
 */
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { CharacterAnimator } from "../../anim/animator";
import type { ReactionId } from "../../anim/stateMap";
import type { CharacterModel } from "../../assets/characterAsset";
import type { AttackInstance } from "../../sim/combat/types";
import type { PlayerActionId } from "../../sim/data/playerTimelines";
import type { Entity } from "../../sim/entity";
import type { PlayerState } from "../../sim/player/types";
import { CharacterView, type ViewMaterials } from "./characterView";
import type { ViewColorKey } from "./stateColors";

export interface ModelViewContext {
  /** 이 엔티티의 플레이어 상태 (없으면 idle로 취급) */
  player(): Readonly<PlayerState> | undefined;
  /** 행동 타임라인 길이 (틱) */
  actionLength(action: PlayerActionId): number;
  /** 지금 sim 틱 */
  simTick(): number;
  lockedOn(): boolean;
}

export class ModelCharacterView extends CharacterView {
  constructor(
    scene: Scene,
    materials: ViewMaterials,
    entity: Readonly<Entity>,
    readonly model: CharacterModel,
    readonly animator: CharacterAnimator,
    private readonly ctx: ModelViewContext,
    readonly weaponMesh: Mesh | null,
  ) {
    super(scene, materials, entity);
    this.body.isVisible = false;
    this.nose.isVisible = false;
    this.weapon.setEnabled(false);
    for (const m of model.meshes) m.overlayColor = new Color3(1, 1, 1);
  }

  react(id: ReactionId): void {
    this.animator.react(id, this.ctx.player()?.state ?? "idle");
  }

  /** @param weaponTick 표시 중인 sim 틱 (히트스톱이면 멈춘 값) — 행동 진행도를 이 틱으로 계산한다 */
  protected override apply(e: Readonly<Entity>, _color: ViewColorKey, _attack: Readonly<AttackInstance> | null, weaponTick: number): void {
    const d = this.display;
    // 캡슐(body)은 숨긴 채로 위치만 맞춘다 (등불 등 기존 부착물/디버그 기준점)
    this.body.position.set(d.position.x, d.position.y, d.position.z);
    this.body.rotation.y = d.yaw;
    this.model.root.position.set(d.position.x, d.position.y, d.position.z);
    this.model.root.rotation.y = d.yaw;

    const p = this.ctx.player();
    let progress = 0;
    if (p?.action) {
      const enter = this.ctx.simTick() - p.stateTick;
      progress = (weaponTick - enter) / Math.max(1, this.ctx.actionLength(p.action));
    }
    this.animator.update(this.frameDt, {
      state: p?.state ?? (e.health <= 0 ? "death" : "idle"),
      action: p?.action ?? null,
      actionProgress: progress,
      lockedOn: this.ctx.lockedOn(),
      moveX: p?.moveX ?? 0,
      moveZ: p?.moveZ ?? 0,
      yaw: d.yaw,
      timeScale: this.hitstopWeight > 0 ? 1 : 0,
    });
  }

  protected override applyEffects(offsetX: number, offsetZ: number, flashing: boolean, alpha: number): void {
    this.model.root.position.x += offsetX;
    this.model.root.position.z += offsetZ;
    for (const m of this.model.meshes) {
      m.renderOverlay = flashing;
      if (flashing) m.overlayAlpha = alpha;
    }
  }

  override dispose(): void {
    this.animator.dispose();
    this.weaponMesh?.dispose();
    this.model.dispose();
    super.dispose();
  }
}
