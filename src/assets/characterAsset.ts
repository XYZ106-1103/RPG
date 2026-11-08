/**
 * 캐릭터 GLB 로드 (한 번) → 인스턴스 생성 (엔티티마다, 스켈레톤/애니메이션 복제).
 * LOD: <이름>_LOD0/1/2 메시를 거리별 LOD로 연결한다 (cleanup_model.py 규칙).
 */
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import type { CharacterProfile } from "../anim/characters/hero";
import { configureDecoders } from "./decoders";

let loadersRegistered = false;

export interface CharacterModel {
  /** 발밑 중앙 원점, +Z 정면 (sim 엔티티 위치/방향을 그대로 넣는다) */
  root: TransformNode;
  /** 렌더 메시 (모든 LOD) */
  meshes: AbstractMesh[];
  groups: AnimationGroup[];
  /** 리그 노드 (본에 연결된 TransformNode) 이름으로 찾기 */
  node(name: string): TransformNode | null;
  dispose(): void;
}

export class CharacterAsset {
  private constructor(
    private readonly container: AssetContainer,
    readonly profile: CharacterProfile,
  ) {}

  static async load(scene: Scene, profile: CharacterProfile): Promise<CharacterAsset> {
    configureDecoders();
    if (!loadersRegistered) {
      registerBuiltInLoaders();
      loadersRegistered = true;
    }
    const url = `${import.meta.env.BASE_URL}${profile.glb}`;
    const container = await LoadAssetContainerAsync(url, scene);
    return new CharacterAsset(container, profile);
  }

  /** 엔티티용 인스턴스 (스켈레톤과 애니메이션 그룹을 복제해 따로 움직인다) */
  instantiate(name: string): CharacterModel {
    const inst = this.container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    const root = new TransformNode(`${name}_root`, this.container.scene);
    root.rotationQuaternion = null;
    for (const r of inst.rootNodes) r.parent = root;
    for (const g of inst.animationGroups) g.stop();
    const meshes = root.getChildMeshes(false);
    const lod = (i: number): Mesh | undefined => meshes.find((m): m is Mesh => m instanceof Mesh && m.name.endsWith(`_LOD${i}`));
    const lod0 = lod(0);
    const [d1, d2] = this.profile.lodDistances;
    const lod1 = lod(1);
    const lod2 = lod(2);
    if (lod0 && lod1) lod0.addLODLevel(d1, lod1);
    if (lod0 && lod2) lod0.addLODLevel(d2, lod2);
    const nodes = new Map<string, TransformNode>();
    for (const n of root.getDescendants(false)) if (n instanceof TransformNode && !nodes.has(n.name)) nodes.set(n.name, n);
    return {
      root,
      meshes,
      groups: inst.animationGroups,
      node: (n) => nodes.get(n) ?? null,
      dispose: () => {
        for (const g of inst.animationGroups) g.dispose();
        for (const s of inst.skeletons) s.dispose();
        root.dispose(false, false);
      },
    };
  }
}
