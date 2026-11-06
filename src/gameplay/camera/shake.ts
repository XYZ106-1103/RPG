/**
 * 카메라 셰이크 (Babylon 비의존): 강도, 지속 시간, 주파수, 감쇠 방식으로 흔들림을 추가하고,
 * 펄린 노이즈로 부드럽게 떨리는 회전/위치 오프셋을 만든다. 여러 셰이크는 더해진다.
 *
 *   shake.add({ amplitude: 0.6, duration: 0.25 });
 *   // 렌더 프레임마다
 *   shake.update(dt); shake.sample(offset);
 */
import { Perlin1D } from "./noise";

export type ShakeDecay = "linear" | "exponential" | "none";

export interface ShakeParams {
  /** 강도 (0~1 권장). 1일 때 회전 ±maxAngle, 위치 ±maxOffset */
  amplitude: number;
  /** 지속 시간 (초) */
  duration: number;
  /** 흔들림 빠르기 (Hz 근사, 기본 22) */
  frequency?: number;
  /** 시간에 따른 감쇠 (기본 exponential) */
  decay?: ShakeDecay;
}

export interface ShakeOffset {
  yaw: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
  z: number;
}

export interface ShakeSettings {
  /** amplitude 1일 때 최대 회전 (라디안) */
  maxAngle: number;
  /** amplitude 1일 때 최대 위치 오프셋 (m) */
  maxOffset: number;
  /** 동시에 유지하는 최대 셰이크 수 (넘으면 가장 오래된 것부터 버림) */
  maxActive: number;
}

export const DEFAULT_SHAKE_SETTINGS: ShakeSettings = { maxAngle: 0.05, maxOffset: 0.06, maxActive: 8 };

interface ActiveShake {
  amplitude: number;
  duration: number;
  frequency: number;
  decay: ShakeDecay;
  age: number;
  /** 채널별 노이즈 위상 (셰이크마다 달라 같은 모양이 반복되지 않게) */
  phase: number;
}

const CHANNELS = 6;

export class CameraShake {
  settings: ShakeSettings;
  private readonly active: ActiveShake[] = [];
  private readonly noise: Perlin1D[] = [];
  private phaseCounter = 0;

  constructor(settings: Partial<ShakeSettings> = {}, seed = 7) {
    this.settings = { ...DEFAULT_SHAKE_SETTINGS, ...settings };
    for (let c = 0; c < CHANNELS; c++) this.noise.push(new Perlin1D(seed * 31 + c * 977));
  }

  get activeCount(): number {
    return this.active.length;
  }

  add(p: ShakeParams): void {
    if (!(p.amplitude > 0) || !(p.duration > 0)) return;
    if (this.active.length >= this.settings.maxActive) this.active.shift();
    this.active.push({
      amplitude: p.amplitude,
      duration: p.duration,
      frequency: p.frequency ?? 22,
      decay: p.decay ?? "exponential",
      age: 0,
      phase: (this.phaseCounter++ * 37.17) % 256,
    });
  }

  clear(): void {
    this.active.length = 0;
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      if (!s) continue;
      s.age += dt;
      if (s.age >= s.duration) this.active.splice(i, 1);
    }
  }

  /** 현재 강도 (0~) — 감쇠 반영. 디버그/테스트용 */
  intensity(): number {
    let sum = 0;
    for (const s of this.active) sum += s.amplitude * envelope(s);
    return sum;
  }

  sample(out: ShakeOffset): ShakeOffset {
    out.yaw = out.pitch = out.roll = out.x = out.y = out.z = 0;
    const { maxAngle, maxOffset } = this.settings;
    for (const s of this.active) {
      const k = s.amplitude * envelope(s);
      if (k <= 0) continue;
      const t = s.age * s.frequency + s.phase;
      out.yaw += this.ch(0, t) * k * maxAngle;
      out.pitch += this.ch(1, t) * k * maxAngle;
      out.roll += this.ch(2, t) * k * maxAngle * 0.6;
      out.x += this.ch(3, t) * k * maxOffset;
      out.y += this.ch(4, t) * k * maxOffset;
      out.z += this.ch(5, t) * k * maxOffset * 0.5;
    }
    return out;
  }

  private ch(c: number, t: number): number {
    return this.noise[c]?.sample(t + c * 13.37) ?? 0;
  }
}

function envelope(s: ActiveShake): number {
  const u = Math.min(1, s.age / s.duration);
  switch (s.decay) {
    case "none":
      return 1;
    case "linear":
      return 1 - u;
    case "exponential":
      // 끝에서 0이 되도록 보정한 지수 감쇠
      return (Math.exp(-4 * u) - Math.exp(-4)) / (1 - Math.exp(-4));
  }
}
