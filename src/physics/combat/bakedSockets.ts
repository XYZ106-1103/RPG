/**
 * 미리 구운 무기 소켓 궤적으로 스윕 판정 두 점(손잡이/칼끝)을 내는 공급원 (Babylon 비의존).
 *
 * 궤적은 로드할 때 공격 애니메이션마다 무기 소켓 본(Socket.R)의 위치를 sim 틱(60Hz)마다 샘플링해 만든다 (anim/socketBake.ts).
 * 판정은 화면의 현재 포즈가 아니라 이 데이터로 하므로 결정적이고, 같은 데이터를 서버(Node)에서도 쓸 수 있다.
 * 궤적이 없는 엔티티/공격(허수아비, 적)은 fallback(임시 궤적)을 쓴다.
 */
import type { AttackInstance } from "../../sim/combat/types";
import type { Entity } from "../../sim/entity";
import type { WeaponSocketProvider, WeaponSockets } from "./havokHitQuery";

/** 공격 하나의 소켓 궤적: 틱 0..ticks, 틱마다 [손잡이 x,y,z, 칼끝 x,y,z] (캐릭터 기준 — 발밑 원점, +Z 정면, +X 오른쪽) */
export interface SocketTrack {
  ticks: number;
  data: Float32Array;
}

export type SocketTrackTable = ReadonlyMap<string, SocketTrack>;

/** 캐릭터 기준 → 월드 (sim yaw 규약: 앞 = (sin yaw, cos yaw), 오른쪽 = (cos yaw, -sin yaw)) */
function toWorld(e: Readonly<Entity>, lx: number, ly: number, lz: number, out: { x: number; y: number; z: number }): void {
  const s = Math.sin(e.yaw);
  const c = Math.cos(e.yaw);
  out.x = e.position.x + lx * c + lz * s;
  out.y = e.position.y + ly;
  out.z = e.position.z - lx * s + lz * c;
}

/** 궤적의 소수 틱 t(공격 시작 기준) 값 — 선형 보간, 범위 밖은 끝값 */
export function sampleTrack(track: Readonly<SocketTrack>, t: number, out: Float32Array | number[]): void {
  const tc = Math.min(track.ticks, Math.max(0, t));
  const i0 = Math.min(track.ticks, Math.floor(tc));
  const i1 = Math.min(track.ticks, i0 + 1);
  const u = tc - i0;
  for (let k = 0; k < 6; k++) {
    const a = track.data[i0 * 6 + k] ?? 0;
    const b = track.data[i1 * 6 + k] ?? 0;
    out[k] = a + (b - a) * u;
  }
}

export class BakedSocketProvider implements WeaponSocketProvider {
  private readonly tmp = new Float32Array(6);

  /** @param tracks 아키타입 → (공격 id → 궤적) */
  constructor(
    private readonly tracks: ReadonlyMap<string, SocketTrackTable>,
    private readonly fallback: WeaponSocketProvider,
  ) {}

  has(archetype: string, attack: string): boolean {
    return this.tracks.get(archetype)?.has(attack) ?? false;
  }

  sample(attacker: Readonly<Entity>, instance: Readonly<AttackInstance>, tick: number, out: WeaponSockets): boolean {
    const track = this.tracks.get(attacker.archetype)?.get(instance.attack);
    if (!track) return this.fallback.sample(attacker, instance, tick, out);
    const v = this.tmp;
    sampleTrack(track, tick - instance.startTick, v);
    toWorld(attacker, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, out.hilt);
    toWorld(attacker, v[3] ?? 0, v[4] ?? 0, v[5] ?? 0, out.tip);
    return true;
  }
}
