/**
 * 수치 실시간 조정 GUI (개발용, ?tune 일 때만 동적 임포트 — 기본 번들에 들어가지 않는다).
 * lil-gui (MIT). 품질 프리셋, 조명, 그림자 바이어스, 타격감/카메라/락온/입력 감도 값을 슬라이더로 바꾸면 바로 반영된다.
 *
 * - 바꾼 값은 이 브라우저의 localStorage에 저장되어 새로고침해도 유지된다 (다른 사람/기기와는 공유되지 않음).
 * - "JSON 복사"로 현재 값을 복사해 코드의 기본값(feelSettings.ts 등)에 옮겨 적는다.
 */
import GUI from "lil-gui";
import type { CameraSettings } from "../gameplay/camera/thirdPersonCamera";
import type { LockOnSettings } from "../gameplay/camera/lockOn";
import type { ShakeSettings } from "../gameplay/camera/shake";
import type { FeelSettings, ShakePreset } from "../gameplay/feel/feelSettings";
import { LIGHTING_REVISION, type LightingSettings } from "../render/lighting";
import { QUALITY_LEVELS, SHADOW_FILTER_OVERRIDES, type QualityManager, type ShadowFilterOverride } from "../render/quality";
import type { ShadowSettings } from "../render/shadows";
import type { PostFxSettings } from "../render/postfx/postFx";
import type { DynamicResolutionSettings } from "../render/dynamicResolution";

const STORAGE_KEY = "ashen-lantern.tuning.v1";

export interface TuningTargets {
  feel: FeelSettings;
  camera: CameraSettings;
  shake: ShakeSettings;
  lockOn: LockOnSettings;
  /** 입력 설정 (InputManager.updateSettings로 반영) */
  input: { mouseSensitivity: number; gamepadLookSpeed: number; invertY: boolean };
  applyInput: (patch: TuningTargets["input"]) => void;
  quality: QualityManager;
  lighting: LightingSettings;
  shadows: ShadowSettings;
  postFx: PostFxSettings;
  dynamicResolution: DynamicResolutionSettings;
  /** 태양 그림자 필터 강제 (비교용, 저장하지 않음 — 디버그 F4와 같은 값) */
  shadowFilter: { get(): ShadowFilterOverride; set(v: ShadowFilterOverride): void };
}

interface Snapshot {
  /** 조명 기본값 개정 번호 — 다르면 저장된 조명값은 버린다 */
  lightingRev: number;
  lighting: LightingSettings;
  shadows: ShadowSettings;
  postFx: PostFxSettings;
  dynamicResolution: DynamicResolutionSettings;
  feel: FeelSettings;
  camera: CameraSettings;
  shake: ShakeSettings;
  lockOn: LockOnSettings;
  input: TuningTargets["input"];
}

function snapshot(t: TuningTargets): Snapshot {
  return structuredClone({ lightingRev: LIGHTING_REVISION, lighting: t.lighting, shadows: t.shadows, postFx: t.postFx, dynamicResolution: t.dynamicResolution, feel: t.feel, camera: t.camera, shake: t.shake, lockOn: t.lockOn, input: t.input });
}

/** 저장된 값을 대상 객체에 덮어쓴다 (키가 같은 숫자/불리언만 — 구조가 바뀌어도 안전하게) */
export function assignKnown(target: object, source: unknown): void {
  if (typeof source !== "object" || source === null) return;
  const t = target as Record<string, unknown>;
  for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
    if (!(k in t)) continue;
    const cur = t[k];
    if (typeof cur === "number" && typeof v === "number" && Number.isFinite(v)) t[k] = v;
    else if (typeof cur === "boolean" && typeof v === "boolean") t[k] = v;
    else if (typeof cur === "object" && cur !== null) assignKnown(cur, v);
  }
}

function load(t: TuningTargets): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved: unknown = JSON.parse(raw);
    if (typeof saved !== "object" || saved === null) return;
    const s = saved as Partial<Record<keyof Snapshot, unknown>>;
    if (s.lightingRev === LIGHTING_REVISION) assignKnown(t.lighting, s.lighting);
    assignKnown(t.shadows, s.shadows);
    assignKnown(t.postFx, s.postFx);
    assignKnown(t.dynamicResolution, s.dynamicResolution);
    assignKnown(t.feel, s.feel);
    assignKnown(t.camera, s.camera);
    assignKnown(t.shake, s.shake);
    assignKnown(t.lockOn, s.lockOn);
    assignKnown(t.input, s.input);
    t.applyInput(t.input);
  } catch {
    // 저장소를 쓸 수 없거나 값이 깨졌으면 기본값으로 진행
  }
}

function save(t: TuningTargets): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot(t)));
  } catch {
    // 시크릿 모드 등 — 저장 없이 계속
  }
}

export function createTuningGui(t: TuningTargets): { dispose(): void } {
  const defaults = snapshot(t);
  load(t);

  const gui = new GUI({ title: "수치 조정 (?tune)", width: 300 });
  gui.domElement.style.zIndex = "20";
  const onChange = (): void => save(t);
  gui.onChange(onChange);

  // 품질 프리셋 (바꾸면 그림자/렌더 스케일 등이 즉시 반영, 선택은 브라우저에 저장)
  const q = { level: t.quality.level };
  gui
    .add(q, "level", [...QUALITY_LEVELS])
    .name("품질 프리셋")
    .onChange((v: string) => {
      const lv = QUALITY_LEVELS.find((l) => l === v);
      if (lv) t.quality.setLevel(lv);
    });

  const D = t.dynamicResolution;
  const df = gui.addFolder("동적 해상도");
  df.add(D, "enabled").name("켜기 (끄면 프리셋 해상도)");
  df.add(D, "targetFps", 30, 144, 1).name("목표 fps");
  df.add(D, "minScale", 0.5, 1, 0.05).name("해상도 하한");
  df.close();

  const L = t.lighting;
  const lf = gui.addFolder("조명");
  lf.add(L, "exposure", 0.2, 4, 0.01).name("노출");
  lf.add(L, "contrast", 0.5, 2, 0.01).name("대비");
  lf.add(L, "lanternIntensity", 0, 20, 0.1).name("등불 강도");
  lf.add(L, "lanternRange", 2, 40, 0.5).name("등불 범위 (m)");
  lf.add(L, "lanternFlicker", 0, 0.2, 0.005).name("등불 깜빡임");
  lf.add(L, "lanternGlow", 0, 30, 0.5).name("등불 불꽃 발광 (블룸)");
  lf.addColor(L, "lanternColor").name("등불 색");
  lf.add(L, "iblIntensity", 0, 0.5, 0.005).name("환경광(IBL)");
  lf.add(L, "skyLevel", 0, 0.5, 0.005).name("하늘 밝기");
  lf.add(L, "sunIntensity", 0, 2, 0.01).name("태양 강도");
  lf.addColor(L, "sunColor").name("태양 색");
  lf.add(L, "sunElevationDeg", 2, 89, 1).name("태양 고도 (도)");
  lf.add(L, "sunAzimuthDeg", 0, 360, 1).name("태양 방위 (도)");
  lf.close();

  const S = t.shadows;
  const sf = gui.addFolder("그림자 (바이어스)");
  // 필터 비교: F4로 바꿔도 여기 표시가 따라간다 (listen). 저장하지 않는다
  const filterProxy = {
    get filter(): ShadowFilterOverride {
      return t.shadowFilter.get();
    },
    set filter(v: ShadowFilterOverride) {
      t.shadowFilter.set(v);
    },
  };
  sf.add(filterProxy, "filter", [...SHADOW_FILTER_OVERRIDES]).name("태양 필터 (F4, 비교용)").listen();
  sf.add(S, "sunBias", 0, 0.02, 0.0001).name("태양 bias (아크네↓)");
  sf.add(S, "sunNormalBias", 0, 0.2, 0.001).name("태양 normalBias");
  sf.add(S, "pcssLightSize", 0.001, 0.1, 0.001).name("PCSS 광원 크기");
  sf.add(S, "cascadeBlend", 0, 0.5, 0.01).name("캐스케이드 블렌딩");
  sf.add(S, "lambda", 0, 1, 0.01).name("캐스케이드 분할 λ");
  sf.add(S, "shadowMaxZ", 10, 300, 1).name("그림자 거리 (m)");
  sf.add(S, "darkness", 0, 1, 0.01).name("그림자 밝기");
  sf.add(S, "farIntervalOverride", 0, 8, 1).name("원거리 갱신 N (0=프리셋)");
  sf.add(S, "lanternBias", 0, 0.05, 0.0005).name("등불 bias");
  sf.add(S, "lanternNormalBias", 0, 0.2, 0.001).name("등불 normalBias");
  sf.add(S, "lanternDarkness", 0, 1, 0.01).name("등불 그림자 밝기");
  sf.close();

  const P = t.postFx;
  const pf = gui.addFolder("후처리");
  pf.add(P, "volumetricStrength", 0, 5, 0.05).name("등불 안개 산란");
  pf.add(P, "volumetricAnisotropy", 0, 0.9, 0.01).name("산란 방향성 (g)");
  pf.add(P, "vignetteStrength", 0, 1, 0.01).name("비네팅 세기");
  pf.add(P, "vignetteRadius", 0.1, 1, 0.01).name("비네팅 반경");
  pf.add(P, "vignetteSoftness", 0.05, 1, 0.01).name("비네팅 부드러움");
  pf.add(P, "grainIntensity", 0, 0.2, 0.005).name("그레인");
  pf.add(P, "ssaoStrength", 0, 3, 0.05).name("SSAO 세기");
  pf.add(P, "ssaoRadius", 0.1, 5, 0.05).name("SSAO 반경");
  pf.add(P, "dofFStop", 0.5, 16, 0.1).name("DOF 조리개 (Ultra)");
  pf.close();

  const f = t.feel;
  const hs = gui.addFolder("히트스톱");
  hs.add(f.hitstop, "enabled").name("켜기");
  hs.add(f.hitstop, "scale", 0, 3, 0.05).name("공격 프레임 배율");
  hs.add(f.hitstop, "guardFrames", 0, 10, 1).name("가드 (프레임)");
  hs.add(f.hitstop, "bounceFrames", 0, 10, 1).name("튕김 (프레임)");
  hs.add(f.hitstop, "parryFrames", 0, 15, 1).name("패리 (프레임)");
  hs.add(f.hitstop, "catchUpSeconds", 0, 0.3, 0.005).name("따라잡기 (초)");

  const sh = gui.addFolder("카메라 셰이크");
  sh.add(f.shake, "enabled").name("켜기");
  sh.add(f.shake, "frequency", 4, 60, 1).name("주파수");
  sh.add(f.shake, "shakeOnOthers").name("남의 타격도 흔들기");
  sh.add(t.shake, "maxAngle", 0, 0.2, 0.002).name("최대 회전 (rad)");
  sh.add(t.shake, "maxOffset", 0, 0.3, 0.005).name("최대 위치 (m)");
  const preset = (name: string, p: ShakePreset): void => {
    const g = sh.addFolder(name);
    g.add(p, "amplitude", 0, 1.5, 0.01).name("강도");
    g.add(p, "duration", 0, 1, 0.01).name("지속 (초)");
    g.close();
  };
  preset("약공", f.shake.light);
  preset("강공·백어택·경직", f.shake.heavy);
  preset("가드", f.shake.guard);
  preset("튕김", f.shake.bounce);
  preset("패리", f.shake.parry);

  const re = gui.addFolder("피격 리액션");
  re.add(f.reaction, "pushDistance", 0, 0.5, 0.005).name("밀림 (m)");
  re.add(f.reaction, "pushSeconds", 0.02, 0.5, 0.01).name("밀림 시간 (초)");
  re.add(f.reaction, "flashSeconds", 0, 0.3, 0.005).name("플래시 (초)");
  re.add(f.reaction, "flashAlpha", 0, 1, 0.01).name("플래시 강도");

  const sp = gui.addFolder("스파크");
  sp.add(f.sparks, "enabled").name("켜기");
  sp.add(f.sparks, "hitCount", 0, 60, 1).name("타격 개수");
  sp.add(f.sparks, "guardCount", 0, 60, 1).name("가드 개수");
  sp.add(f.sparks, "bounceCount", 0, 60, 1).name("튕김 개수");
  sp.add(f.sparks, "speed", 0, 20, 0.1).name("속도");
  sp.add(f.sparks, "spread", 0, 1.5, 0.01).name("퍼짐");
  sp.add(f.sparks, "life", 0.05, 1, 0.01).name("수명 (초)");
  sp.add(f.sparks, "gravity", 0, 40, 0.5).name("중력");
  sp.add(f.sparks, "size", 0.01, 0.2, 0.005).name("크기");
  sp.close();

  const cam = gui.addFolder("카메라");
  cam.add(t.camera, "distance", 1.5, 8, 0.05).name("거리");
  cam.add(t.camera, "shoulderOffset", -1, 1, 0.01).name("어깨 비킴");
  cam.add(t.camera, "pivotHeight", 0.8, 2.5, 0.01).name("기준점 높이");
  cam.add(t.camera, "pitchMinDeg", -80, 0, 1).name("위 제한 (도)");
  cam.add(t.camera, "pitchMaxDeg", 0, 85, 1).name("아래 제한 (도)");
  cam.add(t.camera, "followLambda", 1, 40, 0.5).name("따라가기 λ");
  cam.add(t.camera, "rotationLambda", 1, 60, 0.5).name("회전 스무딩 λ");
  cam.add(t.camera, "armReturnLambda", 0.2, 15, 0.1).name("암 복귀 λ");
  cam.add(t.camera, "lockOnLambda", 1, 20, 0.5).name("락온 회전 λ");
  cam.add(t.camera, "lockOnPitchBiasDeg", -20, 30, 0.5).name("락온 내려보기 (도)");
  cam.add(t.camera, "fovDeg", 40, 100, 1).name("시야각 (도)");
  cam.close();

  const lock = gui.addFolder("락온");
  lock.add(t.lockOn, "maxSelectDistance", 5, 40, 0.5).name("선택 거리 (m)");
  lock.add(t.lockOn, "maxKeepDistance", 5, 50, 0.5).name("유지 거리 (m)");
  lock.add(t.lockOn, "distanceWeight", 0, 3, 0.05).name("거리 가중치");
  lock.add(t.lockOn, "occlusionGrace", 0, 3, 0.05).name("가림 허용 (초)");
  lock.add(t.lockOn, "flickThreshold", 0.02, 0.6, 0.01).name("휙 임계값 (rad)");
  lock.add(t.lockOn, "flickWindow", 0.05, 0.5, 0.01).name("휙 시간창 (초)");
  lock.add(t.lockOn, "flickCooldown", 0, 1, 0.01).name("전환 쿨다운 (초)");
  lock.close();

  const inp = gui.addFolder("입력");
  const applyInput = (): void => t.applyInput(t.input);
  inp.add(t.input, "mouseSensitivity", 0.0005, 0.01, 0.0001).name("마우스 감도").onChange(applyInput);
  inp.add(t.input, "gamepadLookSpeed", 0.5, 8, 0.1).name("스틱 회전 속도").onChange(applyInput);
  inp.add(t.input, "invertY").name("상하 반전").onChange(applyInput);
  inp.close();

  gui.add(
    {
      copy: () => {
        const json = JSON.stringify(snapshot(t), null, 2);
        void navigator.clipboard?.writeText(json).catch(() => console.info(json));
        console.info("[tune] 현재 값\n" + json);
      },
    },
    "copy",
  ).name("JSON 복사 (콘솔에도 출력)");
  gui.add(
    {
      reset: () => {
        assignKnown(t.lighting, defaults.lighting);
        assignKnown(t.shadows, defaults.shadows);
        assignKnown(t.postFx, defaults.postFx);
        assignKnown(t.dynamicResolution, defaults.dynamicResolution);
        assignKnown(t.feel, defaults.feel);
        assignKnown(t.camera, defaults.camera);
        assignKnown(t.shake, defaults.shake);
        assignKnown(t.lockOn, defaults.lockOn);
        assignKnown(t.input, defaults.input);
        t.applyInput(t.input);
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
        save(t);
      },
    },
    "reset",
  ).name("기본값으로");

  return { dispose: () => gui.destroy() };
}
