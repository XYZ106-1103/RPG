/**
 * 숄더 뷰 3인칭 오비트 카메라.
 *
 *  - 마우스/오른쪽 스틱으로 yaw/pitch 회전, pitch는 [pitchMin, pitchMax]로 제한
 *  - 기준점: 캐릭터 발 + pivotHeight, 오른쪽 어깨로 shoulderOffset만큼 비킨 지점에서 뒤로 distance
 *  - 스프링 암: 기준점 → 카메라 사이를 구 셰이프캐스트, 벽에 막히면 즉시 당기고 풀리면 천천히 복귀
 *  - 위치/회전 스무딩은 프레임 독립 지수 감쇠 (damping.ts)
 *  - 락온: 대상 쪽으로 yaw/pitch를 부드럽게 돌리고, 직접 회전 입력은 무시 (대상 전환은 lockOn.ts)
 *  - 셰이크: shake.ts 오프셋을 마지막에 더한다
 *
 * yaw 규약: Babylon과 같이 +Z가 0, +X 쪽으로 증가. pitch > 0이면 내려다본다.
 */
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { damp, dampAngle, type Vec3Like } from "./damping";
import { CameraShake, type ShakeOffset } from "./shake";
import { SpringArmLength } from "./springArm";
import type { SpringArmProbe } from "./springArmProbe";

const DEG = Math.PI / 180;

export interface CameraSettings {
  /** 캐릭터 기준 카메라 거리 (m) */
  distance: number;
  /** 오른쪽 어깨 비킴 (m) */
  shoulderOffset: number;
  /** 발에서 기준점까지 높이 (m) */
  pivotHeight: number;
  pitchMinDeg: number;
  pitchMaxDeg: number;
  /** 기준점 따라가기 λ — 계단/턱의 수직 튐을 부드럽게 */
  followLambda: number;
  /** 회전 스무딩 λ — 클수록 입력에 바로 붙는다 */
  rotationLambda: number;
  /** 스프링 암 복귀 λ */
  armReturnLambda: number;
  /** 락온 시 대상 쪽으로 도는 λ */
  lockOnLambda: number;
  /** 락온 시 대상보다 이만큼 더 내려다본다 (도) */
  lockOnPitchBiasDeg: number;
  /** 시야각 (도) */
  fovDeg: number;
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  distance: 3.6,
  shoulderOffset: 0.45,
  pivotHeight: 1.55,
  pitchMinDeg: -35,
  pitchMaxDeg: 60,
  followLambda: 16,
  rotationLambda: 30,
  armReturnLambda: 2.5,
  lockOnLambda: 7,
  lockOnPitchBiasDeg: 10,
  fovDeg: 60,
};

export interface CameraFrameInput {
  /** 이번 프레임 회전 입력 (라디안): x=yaw(+오른쪽), y=pitch(+위를 봄) */
  look: Readonly<{ x: number; y: number }>;
  /** 따라갈 캐릭터 발 위치 (보간된 렌더 위치) */
  follow: Readonly<Vec3Like>;
  /** 락온 대상의 조준점 (가슴). 없으면 null */
  lockTarget: Readonly<Vec3Like> | null;
}

export class ThirdPersonCamera {
  readonly camera: TargetCamera;
  readonly shake = new CameraShake();
  settings: CameraSettings;

  /** 입력이 정한 목표 회전 */
  private yaw = 0;
  private pitch = 15 * DEG;
  /** 스무딩된 실제 회전 */
  private smoothYaw = 0;
  private smoothPitch = 15 * DEG;
  private readonly pivot: Vec3Like = { x: 0, y: 0, z: 0 };
  private pivotInitialized = false;
  private readonly arm: SpringArmLength;
  private readonly shakeOffset: ShakeOffset = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
  private readonly armOrigin: Vec3Like = { x: 0, y: 0, z: 0 };
  private readonly desired: Vec3Like = { x: 0, y: 0, z: 0 };
  private readonly followTarget: Vec3Like = { x: 0, y: 0, z: 0 };
  private readonly rotation = new Quaternion();

  constructor(
    scene: Scene,
    private readonly probe: SpringArmProbe | null,
    settings: Partial<CameraSettings> = {},
  ) {
    this.settings = { ...DEFAULT_CAMERA_SETTINGS, ...settings };
    this.camera = new TargetCamera("thirdPersonCamera", new Vector3(0, 2, -4), scene);
    this.camera.minZ = 0.05;
    this.camera.rotationQuaternion = this.rotation;
    this.arm = new SpringArmLength(this.settings.distance, this.settings.armReturnLambda);
    scene.activeCamera = this.camera;
  }

  /** 화면에 보이는 카메라의 yaw — 이동 입력을 월드로 바꿀 때 쓴다 (InputFrame.viewYaw) */
  get viewYaw(): number {
    return this.smoothYaw;
  }

  get viewPitch(): number {
    return this.smoothPitch;
  }

  /** 현재 스프링 암 길이 (디버그) */
  get armLength(): number {
    return this.arm.length;
  }

  /** 카메라를 즉시 이 방향으로 (리스폰 등) */
  snapTo(yaw: number, pitch = this.pitch): void {
    this.yaw = this.smoothYaw = yaw;
    this.pitch = this.smoothPitch = this.clampPitch(pitch);
    this.pivotInitialized = false;
  }

  update(dt: number, input: CameraFrameInput): void {
    const s = this.settings;
    this.arm.returnLambda = s.armReturnLambda;
    this.camera.fov = s.fovDeg * DEG;

    // 기준점 (계단의 수직 튐을 부드럽게)
    const target = this.followTarget;
    target.x = input.follow.x;
    target.y = input.follow.y + s.pivotHeight;
    target.z = input.follow.z;
    const firstFrame = !this.pivotInitialized;
    if (firstFrame) {
      this.pivot.x = target.x;
      this.pivot.y = target.y;
      this.pivot.z = target.z;
      this.pivotInitialized = true;
    } else {
      // 수평은 바짝, 수직은 조금 느리게 따라간다
      this.pivot.x = damp(this.pivot.x, target.x, s.followLambda * 2, dt);
      this.pivot.z = damp(this.pivot.z, target.z, s.followLambda * 2, dt);
      this.pivot.y = damp(this.pivot.y, target.y, s.followLambda, dt);
    }

    // 회전
    if (input.lockTarget) {
      const lt = input.lockTarget;
      const dx = lt.x - this.pivot.x;
      const dy = lt.y - this.pivot.y;
      const dz = lt.z - this.pivot.z;
      const horiz = Math.hypot(dx, dz);
      this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), s.lockOnLambda, dt);
      const lookPitch = Math.atan2(-dy, Math.max(0.01, horiz)) + s.lockOnPitchBiasDeg * DEG;
      this.pitch = this.clampPitch(damp(this.pitch, lookPitch, s.lockOnLambda, dt));
      this.smoothYaw = this.yaw;
      this.smoothPitch = this.pitch;
    } else {
      this.yaw += input.look.x;
      this.pitch = this.clampPitch(this.pitch - input.look.y);
      this.smoothYaw = dampAngle(this.smoothYaw, this.yaw, s.rotationLambda, dt);
      this.smoothPitch = damp(this.smoothPitch, this.pitch, s.rotationLambda, dt);
    }

    // 원하는 카메라 위치: 어깨 → 뒤로 distance
    const sy = Math.sin(this.smoothYaw);
    const cy = Math.cos(this.smoothYaw);
    const sp = Math.sin(this.smoothPitch);
    const cp = Math.cos(this.smoothPitch);
    const fx = sy * cp;
    const fy = -sp;
    const fz = cy * cp;
    this.armOrigin.x = this.pivot.x + cy * s.shoulderOffset;
    this.armOrigin.y = this.pivot.y;
    this.armOrigin.z = this.pivot.z - sy * s.shoulderOffset;
    this.desired.x = this.armOrigin.x - fx * s.distance;
    this.desired.y = this.armOrigin.y - fy * s.distance;
    this.desired.z = this.armOrigin.z - fz * s.distance;

    // 스프링 암: 캐릭터 중심(기준점)에서 어깨 위치를 거쳐 카메라까지 — 한 번의 구 캐스트로 근사 (기준점 → 원하는 위치)
    const full = Math.hypot(this.desired.x - this.pivot.x, this.desired.y - this.pivot.y, this.desired.z - this.pivot.z);
    const blocked = this.probe ? this.probe.cast(this.pivot, this.desired) : null;
    // 시작/순간이동 직후에는 실제 길이로 바로 맞춘다 (안 그러면 어깨 비킴만큼 천천히 늘어나며 카메라가 기어감)
    if (firstFrame) this.arm.reset(blocked === null ? full : Math.min(full, blocked));
    const len = this.arm.update(full, blocked, dt);
    const k = full > 1e-6 ? len / full : 0;

    // 셰이크
    this.shake.update(dt);
    const o = this.shake.sample(this.shakeOffset);

    const cam = this.camera;
    cam.position.set(
      this.pivot.x + (this.desired.x - this.pivot.x) * k + o.x,
      this.pivot.y + (this.desired.y - this.pivot.y) * k + o.y,
      this.pivot.z + (this.desired.z - this.pivot.z) * k + o.z,
    );
    // TargetCamera는 rotationQuaternion이 있으면 그것을 쓴다 (yaw, pitch, roll)
    Quaternion.RotationYawPitchRollToRef(this.smoothYaw + o.yaw, this.smoothPitch + o.pitch, o.roll, this.rotation);
    cam.rotationQuaternion = this.rotation;
  }

  /** 테스트/디버그: 스무딩 전 목표 회전 */
  getTargetRotation(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  dispose(): void {
    this.camera.dispose();
  }

  private clampPitch(p: number): number {
    return Math.min(this.settings.pitchMaxDeg * DEG, Math.max(this.settings.pitchMinDeg * DEG, p));
  }
}
