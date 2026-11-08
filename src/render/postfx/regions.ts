/**
 * 지역 볼륨과 지역별 화면 톤 보간 (Babylon 비의존).
 *
 * 카메라가 박스 볼륨 안에 들어가면 그 지역 프로필(LUT, 안개 색/밀도, 노출, 블룸)로 몇 초에 걸쳐 전환한다.
 * 언리얼의 Post Process Volume처럼 카메라 위치 기준이다. 볼륨이 겹치면 priority가 높은 쪽, 어디에도 없으면 기본 지역.
 * 전환 중에 다른 지역으로 바뀌면 "지금 보이는 값"에서 새 목표로 다시 전환한다 (튀지 않게).
 */
import { DEFAULT_LUT_SIZE, generateLut, lerpLut, resampleLut, type Lut, type LutParams, type Rgb } from "./lut";

export interface RegionLook {
  /** 안개 색 (선형, 톤매핑 전) */
  fogColor: Rgb;
  /** exp2 안개 밀도 (1/m) */
  fogDensity: number;
  /** 노출 보정 (EV, 0 = 조정 GUI의 노출 그대로) */
  exposureEV: number;
  /** 블룸 임계값 (선형 HDR 밝기) — 높을수록 등불처럼 아주 밝은 것만 번진다 */
  bloomThreshold: number;
  bloomWeight: number;
}

export interface RegionProfile extends RegionLook {
  id: string;
  /** 표시 이름 */
  name: string;
  /** LUT 파일 (public/ 기준 경로, .cube). 없거나 못 읽으면 lutParams로 생성 */
  lutFile?: string;
  lutParams: LutParams;
}

export interface RegionVolume {
  id: string;
  profileId: string;
  min: Rgb;
  max: Rgb;
  priority: number;
  /** 이 지역으로 들어갈 때 전환 시간 (초) */
  blendSeconds: number;
}

export const DEFAULT_BLEND_SECONDS = 3;

/** 기본 지역 "재의 평원": 채도 낮은 회갈색, 짙은 회색 안개, 등불만 번지는 높은 블룸 임계값 */
export const ASHEN_PLAINS: RegionProfile = {
  id: "ashen_plains",
  name: "재의 평원",
  lutFile: "assets/luts/ashen_plains.cube",
  lutParams: {
    saturation: 0.55,
    contrast: 1.06,
    brightness: -0.01,
    shadowTint: [1.04, 0.97, 0.88],
    highlightTint: [0.97, 0.96, 0.95],
  },
  fogColor: [0.05, 0.05, 0.055],
  fogDensity: 0.035,
  exposureEV: 0,
  bloomThreshold: 1.6,
  bloomWeight: 0.55,
};

export function containsPoint(v: RegionVolume, x: number, y: number, z: number): boolean {
  return x >= v.min[0] && x <= v.max[0] && y >= v.min[1] && y <= v.max[1] && z >= v.min[2] && z <= v.max[2];
}

/** 위치를 담는 볼륨 중 priority가 가장 높은 것 (같으면 먼저 등록된 것), 없으면 null */
export function pickVolume(volumes: readonly RegionVolume[], x: number, y: number, z: number): RegionVolume | null {
  let best: RegionVolume | null = null;
  for (const v of volumes) if (containsPoint(v, x, y, z) && (!best || v.priority > best.priority)) best = v;
  return best;
}

/** 0~1 → 부드러운 시작/끝 */
export const smoothstep01 = (t: number): number => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

function lerpLook(a: RegionLook, b: RegionLook, t: number, out: { -readonly [K in keyof RegionLook]: RegionLook[K] }): void {
  const fc: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) fc[i] = (a.fogColor[i] as number) + ((b.fogColor[i] as number) - (a.fogColor[i] as number)) * t;
  out.fogColor = fc;
  out.fogDensity = a.fogDensity + (b.fogDensity - a.fogDensity) * t;
  out.exposureEV = a.exposureEV + (b.exposureEV - a.exposureEV) * t;
  out.bloomThreshold = a.bloomThreshold + (b.bloomThreshold - a.bloomThreshold) * t;
  out.bloomWeight = a.bloomWeight + (b.bloomWeight - a.bloomWeight) * t;
}

const copyLook = (l: RegionLook): RegionLook => ({ ...l, fogColor: [...l.fogColor] as unknown as Rgb });

/**
 * 지역 상태 + 보간. 렌더 쪽은 매 프레임 update(카메라 위치, dt) 후 look/lut을 읽고,
 * lutDirty가 true일 때만 LUT 텍스처를 다시 올린다.
 */
export class RegionGrading {
  private readonly profiles = new Map<string, RegionProfile>();
  private readonly luts = new Map<string, Lut>();
  private readonly volumes: RegionVolume[] = [];
  private targetId: string;
  private from: RegionLook;
  private readonly fromLut: Lut;
  private elapsed = 0;
  private duration = 0;
  /** 지금 들어가 있는 볼륨 (나갈 때 그 볼륨의 전환 시간으로 돌아온다) */
  private activeVolume: RegionVolume | null = null;
  /** 지금 보이는 값 */
  readonly look: RegionLook;
  readonly lut: Lut;
  /** 이번 update에서 lut이 바뀌었나 */
  lutDirty = true;

  constructor(
    readonly defaultProfile: RegionProfile,
    readonly lutSize = DEFAULT_LUT_SIZE,
  ) {
    this.addProfile(defaultProfile);
    this.targetId = defaultProfile.id;
    this.from = copyLook(defaultProfile);
    this.look = copyLook(defaultProfile);
    const l = this.lutOf(defaultProfile.id);
    this.fromLut = { size: lutSize, data: l.data.slice() };
    this.lut = { size: lutSize, data: l.data.slice() };
  }

  addProfile(p: RegionProfile): void {
    this.profiles.set(p.id, p);
    this.luts.set(p.id, generateLut(p.lutParams, this.lutSize));
  }

  /** LUT 파일을 읽었으면 생성값 대신 쓴다 (크기가 다르면 리샘플) */
  setProfileLut(profileId: string, lut: Lut): void {
    if (!this.profiles.has(profileId)) throw new Error(`알 수 없는 지역 프로필: ${profileId}`);
    this.luts.set(profileId, resampleLut(lut, this.lutSize));
    if (profileId === this.targetId && this.duration === 0) {
      this.lut.data.set((this.luts.get(profileId) as Lut).data);
      this.lutDirty = true;
    }
  }

  addVolume(v: RegionVolume): void {
    if (!this.profiles.has(v.profileId)) throw new Error(`볼륨 ${v.id}: 알 수 없는 프로필 ${v.profileId}`);
    this.volumes.push(v);
  }

  get volumeList(): readonly RegionVolume[] {
    return this.volumes;
  }

  get current(): RegionProfile {
    return this.profiles.get(this.targetId) as RegionProfile;
  }

  /** 전환 진행도 (0~1, 전환 중이 아니면 1) */
  get progress(): number {
    return this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 1;
  }

  private lutOf(id: string): Lut {
    return this.luts.get(id) as Lut;
  }

  update(x: number, y: number, z: number, dt: number): void {
    this.lutDirty = false;
    const vol = pickVolume(this.volumes, x, y, z);
    const nextId = vol ? vol.profileId : this.defaultProfile.id;
    if (vol) this.activeVolume = vol;
    if (nextId !== this.targetId) {
      // 지금 보이는 값에서 새 목표로
      this.from = copyLook(this.look);
      this.fromLut.data.set(this.lut.data);
      this.targetId = nextId;
      this.elapsed = 0;
      this.duration = Math.max(0, (vol ?? this.activeVolume)?.blendSeconds ?? DEFAULT_BLEND_SECONDS);
      this.activeVolume = vol;
      if (this.duration === 0) this.finish();
      return;
    }
    if (this.duration === 0) return;
    this.elapsed += dt;
    const target = this.current;
    if (this.elapsed >= this.duration) {
      this.finish();
      return;
    }
    const t = smoothstep01(this.elapsed / this.duration);
    lerpLook(this.from, target, t, this.look as { -readonly [K in keyof RegionLook]: RegionLook[K] });
    lerpLut(this.fromLut, this.lutOf(target.id), t, this.lut);
    this.lutDirty = true;
  }

  private finish(): void {
    const target = this.current;
    lerpLook(target, target, 1, this.look as { -readonly [K in keyof RegionLook]: RegionLook[K] });
    this.lut.data.set(this.lutOf(target.id).data);
    this.duration = 0;
    this.elapsed = 0;
    this.lutDirty = true;
  }
}
