/**
 * 렌더 엔진 생성: WebGPU 우선, 미지원/초기화 실패 시 WebGL2로 폴백한다.
 * 디버깅용으로 URL에 `?engine=webgl2`를 붙이면 WebGPU를 건너뛴다.
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";

export type RenderBackend = "WebGPU" | "WebGL2";

export interface EngineResult {
  engine: AbstractEngine;
  backend: RenderBackend;
}

export interface CreateEngineOptions {
  /** true면 WebGPU를 시도하지 않는다 */
  forceWebGL2?: boolean;
}

async function tryCreateWebGPU(canvas: HTMLCanvasElement): Promise<WebGPUEngine | null> {
  try {
    if (!(await WebGPUEngine.IsSupportedAsync)) return null;
    const engine = new WebGPUEngine(canvas, {
      antialias: true,
      adaptToDeviceRatio: true,
      powerPreference: "high-performance",
      // 어댑터가 지원하는 선택 기능을 모두 켠다 — 압축 텍스처(BC/ASTC: KTX2를 압축 상태로 올림), GPU 시간 측정(timestamp-query).
      // (기본값은 아무 기능도 요청하지 않아 KTX2가 비압축 RGBA로 풀리고 GPU 시간도 잴 수 없다)
      enableAllFeatures: true,
    });
    await engine.initAsync();
    return engine;
  } catch (err) {
    console.warn("[engine] WebGPU 초기화 실패, WebGL2로 폴백합니다.", err);
    return null;
  }
}

function createWebGL2(canvas: HTMLCanvasElement): Engine {
  const engine = new Engine(
    canvas,
    true,
    {
      powerPreference: "high-performance",
      stencil: true,
      // WebGL1로 내려가지 않도록 한다
      disableWebGL2Support: false,
    },
    true,
  );
  if (engine.webGLVersion < 2) {
    engine.dispose();
    throw new Error("WebGL2를 지원하지 않는 브라우저입니다. 최신 Chrome/Edge/Firefox/Safari를 사용해 주세요.");
  }
  return engine;
}

const ENGINE_PARAM = "engine";
/** WebGPU 디바이스 손실 후 이 시간 안에 복구되지 않으면 WebGL2로 다시 시작한다 */
const DEVICE_RESTORE_TIMEOUT_MS = 3000;

/**
 * WebGPU 디바이스가 손실되고 복구에 실패하면 페이지를 `?engine=webgl2`로 다시 불러온다.
 * (초기화 직후 디바이스가 사라지는 환경에서 검은 화면으로 멈추는 것을 막는다.)
 * WebGL2 강제 모드에서는 WebGPU를 시도하지 않으므로 재시작이 반복되지 않는다.
 */
function installWebGPUDeviceLossFallback(engine: AbstractEngine): void {
  let timer: number | undefined;
  engine.onContextLostObservable.add(() => {
    console.warn("[engine] WebGPU 디바이스 손실 — 복구를 기다립니다.");
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      console.warn("[engine] WebGPU 복구 실패, WebGL2로 다시 시작합니다.");
      const url = new URL(window.location.href);
      url.searchParams.set(ENGINE_PARAM, "webgl2");
      window.location.replace(url);
    }, DEVICE_RESTORE_TIMEOUT_MS);
  });
  engine.onContextRestoredObservable.add(() => {
    window.clearTimeout(timer);
    console.info("[engine] WebGPU 디바이스 복구됨.");
  });
}

export async function createEngine(canvas: HTMLCanvasElement, options: CreateEngineOptions = {}): Promise<EngineResult> {
  const forceWebGL2 = options.forceWebGL2 ?? new URLSearchParams(window.location.search).get(ENGINE_PARAM) === "webgl2";

  let result: EngineResult | null = null;
  if (!forceWebGL2) {
    const gpu = await tryCreateWebGPU(canvas);
    if (gpu) {
      installWebGPUDeviceLossFallback(gpu);
      result = { engine: gpu, backend: "WebGPU" };
    }
  }
  if (!result) result = { engine: createWebGL2(canvas), backend: "WebGL2" };

  console.info(`[engine] 렌더 백엔드: ${result.backend} (${result.engine.description})`);
  return result;
}
