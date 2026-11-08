/**
 * 무기 소켓: 무기(칼날 메시)를 오른손 소켓 본에 붙이고, 공격 애니메이션의 소켓 궤적을 미리 굽는다.
 * TODO(에셋): 칼 모델 GLB로 교체 (지금은 기본 도형 칼날)
 */
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import type { CharacterModel } from "../assets/characterAsset";
import type { SocketTrack } from "../physics/combat/bakedSockets";
import type { PlayerActionId, PlayerTimelineTable } from "../sim/data/playerTimelines";
import type { CharacterProfile } from "./characters/hero";
import type { ClipLibrary } from "./clipLibrary";
import { isAnimName } from "./clips";

/** 칼날 메시를 소켓 본에 붙인다 (손잡이 → 칼끝 방향으로 늘인 얇은 상자) */
export function attachWeapon(scene: Scene, model: CharacterModel, profile: CharacterProfile): Mesh | null {
  const socket = model.node(profile.weaponBone);
  if (!socket) {
    console.warn(`[anim] 무기 소켓 본 '${profile.weaponBone}'이 없습니다 — 무기를 붙이지 않음`);
    return null;
  }
  const hilt = Vector3.FromArray(profile.weapon.hilt);
  const tip = Vector3.FromArray(profile.weapon.tip);
  const dir = tip.subtract(hilt);
  const len = dir.length();
  const blade = CreateBox(`${model.root.name}_weapon`, { width: profile.weapon.width, height: len, depth: profile.weapon.width * 0.4 }, scene);
  const mat = new PBRMaterial(`${model.root.name}_weaponMat`, scene);
  mat.albedoColor = new Color3(0.7, 0.7, 0.74);
  mat.metallic = 0.9;
  mat.roughness = 0.35;
  mat.freeze();
  blade.material = mat;
  blade.parent = socket;
  blade.position = hilt.add(tip).scale(0.5);
  blade.rotationQuaternion = new Quaternion();
  Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir.normalize(), blade.rotationQuaternion);
  return blade;
}

/** 노드와 조상 월드 행렬을 위에서부터 다시 계산 (렌더 없이 포즈를 읽을 때) */
function computeChain(node: Node): void {
  const chain: Node[] = [];
  for (let n: Node | null = node; n; n = n.parent) chain.push(n);
  for (let i = chain.length - 1; i >= 0; i--) (chain[i] as TransformNode).computeWorldMatrix?.(true);
}

/**
 * 공격 애니메이션마다 소켓 손잡이/칼끝 위치를 sim 틱(60Hz)마다 샘플링한다 (캐릭터 기준 좌표).
 * 런타임의 행동 클립 시간과 같은 식(진행도 = 틱 ÷ 타임라인 길이)을 써서 화면과 판정이 맞는다.
 * 모델 root가 원점/정면(+Z)에 있을 때(배치 전) 호출한다.
 */
export function bakeSocketTracks(model: CharacterModel, lib: ClipLibrary, profile: CharacterProfile, timelines: PlayerTimelineTable): Map<string, SocketTrack> {
  const out = new Map<string, SocketTrack>();
  const socket = model.node(profile.weaponBone);
  if (!socket) return out;
  const hiltL = Vector3.FromArray(profile.weapon.hilt);
  const tipL = Vector3.FromArray(profile.weapon.tip);
  const hw = new Vector3();
  const tw = new Vector3();
  const rootInv = model.root.computeWorldMatrix(true).clone().invert();
  for (const action of Object.keys(timelines) as PlayerActionId[]) {
    if (!action.startsWith("attack_") || !isAnimName(action)) continue;
    const clip = lib.get(action);
    if (clip.fallback) continue; // 애니메이션이 없으면 임시 궤적
    const ticks = timelines[action].length;
    const data = new Float32Array((ticks + 1) * 6);
    clip.group.start(false, 0, clip.from, clip.to);
    for (let t = 0; t <= ticks; t++) {
      clip.group.goToFrame(clip.from + (t / ticks) * clip.duration * clip.fps);
      computeChain(socket);
      const m = socket.getWorldMatrix().multiply(rootInv);
      Vector3.TransformCoordinatesToRef(hiltL, m, hw);
      Vector3.TransformCoordinatesToRef(tipL, m, tw);
      data.set([hw.x, hw.y, hw.z, tw.x, tw.y, tw.z], t * 6);
    }
    clip.group.stop();
    out.set(action, { ticks, data });
  }
  return out;
}
