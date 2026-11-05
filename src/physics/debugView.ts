/**
 * 충돌 셰이프 시각화 (디버그). Babylon PhysicsViewer가 Havok에 실제로 들어 있는 셰이프를 그린다.
 *
 * PhysicsViewer는 같은 종류의 셰이프를 한 머티리얼을 공유하는 인스턴스로 그려서 바디별 색을 줄 수 없다.
 * 그래서 레이어마다 뷰어를 하나씩 두고 각 뷰어의 머티리얼 색을 바꾼다.
 * 래퍼 밖에서 만들어진 바디(예: 캐릭터 컨트롤러 내부 바디)도 셰이프 마스크로 레이어를 판별해 함께 보여 준다.
 */
import { PhysicsViewer } from "@babylonjs/core/Debug/physicsViewer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import type { Scene } from "@babylonjs/core/scene";
import type { LayerName } from "./layers";
import type { PhysicsWorld } from "./physicsWorld";

type ViewKey = LayerName | "OTHER";

/** 레이어별 표시 색 */
export const LAYER_DEBUG_COLORS: Readonly<Record<ViewKey, Color3>> = {
  PLAYER: new Color3(0.2, 0.9, 1.0),
  ENEMY: new Color3(1.0, 0.25, 0.2),
  ENVIRONMENT: new Color3(0.55, 0.85, 0.35),
  TRIGGER: new Color3(1.0, 0.85, 0.1),
  PROJECTILE: new Color3(1.0, 0.3, 0.9),
  OTHER: new Color3(1, 1, 1),
};

export class PhysicsDebugView {
  private readonly viewers = new Map<ViewKey, PhysicsViewer>();
  private readonly shown = new Map<PhysicsBody, ViewKey>();
  private enabledFlag = false;
  private lastBodyCount = -1;
  private readonly bodiesObserver: Observer<void>;
  private readonly physicsObserver: Observer<Scene>;

  constructor(private readonly world: PhysicsWorld) {
    this.bodiesObserver = world.onBodiesChanged.add(() => this.refresh());
    // 래퍼 밖에서 추가된 바디를 잡기 위해 물리 스텝마다 바디 수 변화를 확인한다 (켜져 있을 때만)
    this.physicsObserver = world.scene.onAfterPhysicsObservable.add(() => {
      if (this.enabledFlag && world.getBodies().length !== this.lastBodyCount) this.refresh();
    });
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  toggle(): boolean {
    this.setEnabled(!this.enabledFlag);
    return this.enabledFlag;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabledFlag) return;
    this.enabledFlag = on;
    if (on) this.refresh();
    else this.clear();
  }

  /** 현재 엔진의 바디 목록과 표시 상태를 맞춘다 */
  refresh(): void {
    if (!this.enabledFlag) return;
    const bodies = this.world.getBodies();
    this.lastBodyCount = bodies.length;
    const alive = new Set(bodies);
    for (const [body, key] of this.shown) {
      if (!alive.has(body)) {
        this.viewers.get(key)?.hideBody(body);
        this.shown.delete(body);
      }
    }
    for (const body of bodies) {
      if (this.shown.has(body)) continue;
      const key: ViewKey = this.world.layerOf(body) ?? "OTHER";
      const mesh = this.viewerFor(key).showBody(body);
      if (mesh) this.tint(mesh, key);
      this.shown.set(body, key);
    }
  }

  dispose(): void {
    this.clear();
    this.world.onBodiesChanged.remove(this.bodiesObserver);
    this.world.scene.onAfterPhysicsObservable.remove(this.physicsObserver);
  }

  private clear(): void {
    for (const v of this.viewers.values()) v.dispose();
    this.viewers.clear();
    this.shown.clear();
    this.lastBodyCount = -1;
  }

  private viewerFor(key: ViewKey): PhysicsViewer {
    let v = this.viewers.get(key);
    if (!v) {
      v = new PhysicsViewer(this.world.scene);
      this.viewers.set(key, v);
    }
    return v;
  }

  /** 뷰어의 공유 디버그 머티리얼에 레이어 색을 입힌다 (뷰어가 레이어별로 따로라 다른 레이어에 영향 없음) */
  private tint(mesh: AbstractMesh, key: ViewKey): void {
    const mat = mesh.material ?? (mesh instanceof InstancedMesh ? mesh.sourceMesh.material : null);
    if (mat instanceof StandardMaterial) {
      mat.emissiveColor = LAYER_DEBUG_COLORS[key];
      if (key === "TRIGGER") mat.alpha = 0.6;
    }
  }
}
