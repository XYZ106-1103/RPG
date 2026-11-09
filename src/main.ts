import { createEngine } from "./core/engine";
import { GameLoop } from "./core/gameLoop";
import { InputManager } from "./core/input";
import { GameSession } from "./gameplay/session";
import { SIM_HZ as SIM_DEFAULT_HZ } from "./sim/time";
import { InputDebugOverlay } from "./ui/inputDebug";

/**
 * 디버그용 URL 파라미터
 *  - ?simhz=10         렌더 보간 확인용으로 고정 스텝 주기를 바꾼다 (기본 60). sim 수치는 60Hz 기준이라 게임 속도도 바뀐다
 *  - ?nointerp         보간을 끄고 현재 스텝 상태만 그린다 (비교용)
 *  - ?inputdebug       입력 디버그 오버레이 표시
 *  - ?physicsdebug     물리 디버그 뷰(충돌 셰이프 + 무기 궤적)를 켠 상태로 시작 (F3으로 토글)
 *  - ?tune             타격감/카메라/락온/입력 수치 조정 GUI (lil-gui, 이때만 불러온다)
 *  - ?quality=low|medium|high|ultra  품질 프리셋 (F4: 태양 그림자 필터 PCF/PCSS 비교 전환)
 */
const params = new URLSearchParams(window.location.search);
const SIM_HZ = Math.min(240, Math.max(1, Number(params.get("simhz")) || SIM_DEFAULT_HZ));

async function main(): Promise<void> {
  const canvas = document.getElementById("renderCanvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#renderCanvas 캔버스를 찾을 수 없습니다.");

  const { engine } = await createEngine(canvas);
  const input = new InputManager(canvas);
  const session = await GameSession.create(engine, canvas, input, {
    interpolate: !params.has("nointerp"),
    physicsDebugOnStart: params.has("physicsdebug"),
    inputDebug: params.has("inputdebug") ? new InputDebugOverlay() : null,
  });

  const loop = new GameLoop(
    {
      fixedUpdate: (dt) => session.fixedUpdate(dt),
      render: (alpha, frameSeconds) => session.render(alpha, frameSeconds),
    },
    { stepSeconds: 1 / SIM_HZ },
  );
  loop.bindVisibility(document);

  if (params.has("tune")) {
    // 개발용 GUI는 별도 청크로 분리되어 ?tune일 때만 내려받는다
    const { createTuningGui } = await import("./ui/tuningGui");
    const inputSettings = input.getSettings();
    createTuningGui({
      feel: session.feel,
      camera: session.camera.settings,
      shake: session.camera.shake.settings,
      lockOn: session.lockOn.controller.settings,
      input: { mouseSensitivity: inputSettings.mouseSensitivity, gamepadLookSpeed: inputSettings.gamepadLookSpeed, invertY: inputSettings.invertY },
      applyInput: (patch) => input.updateSettings(patch),
      quality: session.gfx.quality,
      lighting: session.gfx.lighting.settings,
      shadows: session.gfx.shadows.settings,
      postFx: session.gfx.postFx.settings,
      shadowFilter: {
        get: () => session.gfx.shadows.filterOverride,
        set: (v) => {
          session.gfx.shadows.filterOverride = v;
        },
      },
    });
  }

  // 개발 서버에서만: 헤드리스 검사 스크립트가 씬 상태(후처리 순서 등)를 읽을 수 있게
  if (import.meta.env.DEV) (window as unknown as { __ashenSession?: GameSession }).__ashenSession = session;
  console.info(`[loop] 시뮬레이션 ${SIM_HZ}Hz 고정 스텝`);
  // 입력 폴링(게임패드, 탭/홀드 타이머)은 고정 스텝보다 먼저 해야 같은 프레임의 sim 틱에 반영된다
  let lastFrameMs = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    input.update(now, Math.min(0.25, (now - lastFrameMs) / 1000));
    lastFrameMs = now;
    loop.frame(now);
  });
  window.addEventListener("resize", () => engine.resize());
}

main().catch((err: unknown) => {
  console.error(err);
  const el = document.getElementById("fatal");
  if (el) {
    el.textContent = err instanceof Error ? err.message : String(err);
    el.hidden = false;
  }
});
