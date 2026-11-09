/**
 * 렌더 엔진 생성: WebGPU 우선, 미지원/초기화 실패 시 WebGL2로 폴백한다.
 * 디버깅용으로 URL에 `?engine=webgl2`를 붙이면 WebGPU를 건너뛴다.
 * WebGPU를 쓰지 못한 이유(fallbackReason)와 GPU 이름(gpuName)을 돌려줘 디버그 패널에 표시한다.
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";

export type RenderBackend = "WebGPU" | "WebGL2";

export interface EngineResult {
  engine: AbstractEngine;
  backend: RenderBackend;
  /** WebGL2로 실행할 때 WebGPU를 쓰지 못한 이유 (WebGPU면 null) */
  fallbackReason: string | null;
  /** GPU 이름 (드라이버가 알려 주는 렌더러 문자열) */
  gpuName: string;
  /** 소프트웨어 렌더링 (브라우저 GPU 가속 꺼짐 등) */
  software: boolean;
}

export interface CreateEngineOptions {
  /** true면 WebGPU를 시도하지 않는다 */
  forceWebGL2?: boolean;
}

/** 장치 손실 후 한 번만 WebGL2로 다시 시작하라는 표시 (그 탭에서만 — 주소에 남기지 않는다) */
const FALLBACK_ONCE_KEY = "ashen-lantern.webgl2-once";

async function tryCreateWebGPU(canvas: HTMLCanvasElement): Promise<{ engine: WebGPUEngine | null; reason: string }> {
  if (!("gpu" in navigator) || !navigator.gpu) return { engine: null, reason: "WebGPU 미지원 브라우저" };
  try {
    if (!(await WebGPUEngine.IsSupportedAsync)) return { engine: null, reason: "WebGPU 어댑터 없음 (GPU/드라이버가 막힘)" };
    const engine = new WebGPUEngine(canvas, {
      antialias: true,
      adaptToDeviceRatio: true,
      powerPreference: "high-performance",
      // 어댑터가 지원하는 선택 기능을 모두 켠다 — 압축 텍스처(BC/ASTC: KTX2를 압축 상태로 올림), GPU 시간 측정(timestamp-query).
      // (기본값은 아무 기능도 요청하지 않아 KTX2가 비압축 RGBA로 풀리고 GPU 시간도 잴 수 없다)
      enableAllFeatures: true,
    });
    await engine.initAsync();
    // GPU 시간 측정(타임스탬프)을 처음부터 켠다 — 렌더 타깃은 만들어질 때 측정 카운터를 얻으므로,
    // 나중에 켜면 그 전에 만든 그림자 맵 등은 패스별 시간(F5)에 잡히지 않는다. 기능이 없으면 Babylon이 무시한다
    engine.enableGPUTimingMeasurements = true;
    return { engine, reason: "" };
  } catch (err) {
    console.warn("[engine] WebGPU 초기화 실패, WebGL2로 폴백합니다.", err);
    return { engine: null, reason: `WebGPU 초기화 실패: ${err instanceof Error ? err.message : String(err)}`.slice(0, 120) };
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

/** 소프트웨어 렌더러 이름 (GPU 가속이 꺼졌을 때) */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
/** WebGPU 디바이스 손실 후 이 시간 안에 복구되지 않으면 WebGL2로 다시 시작한다 */
const DEVICE_RESTORE_TIMEOUT_MS = 3000;

/**
 * WebGPU 디바이스가 손실되고 복구에 실패하면 이 탭에서 한 번만 WebGL2로 다시 불러온다 (sessionStorage 표시).
 * (초기화 직후 디바이스가 사라지는 환경에서 검은 화면으로 멈추는 것을 막는다.)
 * 주소는 바꾸지 않으므로 다음에 새로고침하면 WebGPU를 다시 시도한다.
 */
function installWebGPUDeviceLossFallback(engine: AbstractEngine): void {
  let timer: number | undefined;
  engine.onContextLostObservable.add(() => {
    console.warn("[engine] WebGPU 디바이스 손실 — 복구를 기다립니다.");
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      console.warn("[engine] WebGPU 복구 실패, 이번 한 번만 WebGL2로 다시 시작합니다.");
      try {
        window.sessionStorage.setItem(FALLBACK_ONCE_KEY, "WebGPU 장치 손실 후 복구 실패 (새로고침하면 WebGPU 재시도)");
      } catch {
        // 저장소를 못 쓰면 주소로 (예전 방식)
        const url = new URL(window.location.href);
        url.searchParams.set(ENGINE_PARAM, "webgl2");
        window.location.replace(url);
        return;
      }
      window.location.reload();
    }, DEVICE_RESTORE_TIMEOUT_MS);
  });
  engine.onContextRestoredObservable.add(() => {
    window.clearTimeout(timer);
    console.info("[engine] WebGPU 디바이스 복구됨.");
  });
}

function takeFallbackOnce(): string | null {
  try {
    const v = window.sessionStorage.getItem(FALLBACK_ONCE_KEY);
    if (v) window.sessionStorage.removeItem(FALLBACK_ONCE_KEY); // 한 번만
    return v;
  } catch {
    return null;
  }
}

function gpuNameOf(engine: AbstractEngine): string {
  try {
    // WebGL(ThinEngine)은 getGlInfo, WebGPU 엔진은 getInfo — 공통 타입(AbstractEngine)에는 없다
    type InfoFn = () => { vendor: string; renderer: string };
    const e = engine as unknown as { getGlInfo?: InfoFn; getInfo?: InfoFn };
    const info = (e.getGlInfo ?? e.getInfo)?.call(engine);
    const name = [info?.vendor, info?.renderer].filter((v) => v && !/^unknown/i.test(v)).join(" ");
    return (name || "알 수 없음").slice(0, 80);
  } catch {
    return "알 수 없음";
  }
}

export async function createEngine(canvas: HTMLCanvasElement, options: CreateEngineOptions = {}): Promise<EngineResult> {
  const once = takeFallbackOnce();
  const forcedByUrl = new URLSearchParams(window.location.search).get(ENGINE_PARAM) === "webgl2";
  const forceWebGL2 = options.forceWebGL2 ?? (forcedByUrl || once !== null);

  let engine: AbstractEngine | null = null;
  let backend: RenderBackend = "WebGL2";
  let fallbackReason: string | null = forcedByUrl ? "주소에 ?engine=webgl2 (강제)" : once;
  if (!forceWebGL2) {
    const gpu = await tryCreateWebGPU(canvas);
    if (gpu.engine) {
      installWebGPUDeviceLossFallback(gpu.engine);
      engine = gpu.engine;
      backend = "WebGPU";
      fallbackReason = null;
    } else fallbackReason = gpu.reason;
  }
  if (!engine) engine = createWebGL2(canvas);
  const gpuName = gpuNameOf(engine);
  const software = SOFTWARE_RENDERER.test(gpuName);

  console.info(`[engine] 렌더 백엔드: ${backend} (${engine.description}) GPU: ${gpuName}${fallbackReason ? ` — WebGPU 안 씀: ${fallbackReason}` : ""}`);
  if (software) console.warn("[engine] 소프트웨어 렌더링입니다 — 브라우저 GPU 가속이 꺼져 있을 수 있습니다 (브라우저 재시작, 하드웨어 가속 설정 확인)");
  return { engine, backend, fallbackReason, gpuName, software };
}
