/**
 * 렌더 백엔드 선택 (DOM/Babylon 비의존 순수 판단).
 *
 * 우선순위: 주소 ?engine= > 저장된 선택 > 자동.
 * 자동: WebGPU를 우선하되, Intel 내장 그래픽이면 WebGL2 — Intel Mac(UHD 630)에서 Chrome WebGPU가 WebGL2보다
 * 느리고, 렌더 패스 바깥의 GPU 시간(F5 "기타")이 20ms를 넘게 나오는 것을 실측했다. Intel Arc(외장)는 WebGPU 그대로.
 */

export type BackendPref = "auto" | "webgpu" | "webgl2";
export const BACKEND_PREFS: readonly BackendPref[] = ["auto", "webgpu", "webgl2"];
export const BACKEND_STORAGE_KEY = "ashen-lantern.engine.v1";

export function parseBackendPref(v: unknown): BackendPref | null {
  return typeof v === "string" && (BACKEND_PREFS as readonly string[]).includes(v.toLowerCase()) ? (v.toLowerCase() as BackendPref) : null;
}

/** Intel 내장 그래픽인가 (어댑터 정보 기준). Arc 같은 외장은 제외 */
export function isIntelIntegrated(vendor: string | null, architecture = "", description = ""): boolean {
  const v = (vendor ?? "").toLowerCase();
  if (!v.includes("intel")) return false;
  const a = `${architecture} ${description}`.toLowerCase();
  return !/arc|alchemist|battlemage|xe-hpg|dg2/.test(a);
}

export interface BackendInputs {
  /** 주소 ?engine= 값 */
  urlPref: BackendPref | null;
  /** 저장된 선택 */
  storedPref: BackendPref | null;
  /** 브라우저에 WebGPU가 있나 (navigator.gpu) */
  hasWebGPU: boolean;
  /** WebGPU 어댑터 정보 (자동 판단용, 모르면 null) */
  adapterVendor: string | null;
  adapterArchitecture?: string;
  adapterDescription?: string;
}

export interface BackendDecision {
  /** 먼저 시도할 백엔드 (WebGPU 초기화에 실패하면 엔진 쪽에서 WebGL2로 내려간다) */
  want: "webgpu" | "webgl2";
  /** WebGL2를 고른 이유 (패널 표시, WebGPU면 null) */
  reason: string | null;
  pref: BackendPref;
}

export function chooseBackend(i: BackendInputs): BackendDecision {
  const pref = i.urlPref ?? i.storedPref ?? "auto";
  if (pref === "webgl2") return { want: "webgl2", reason: i.urlPref ? "주소 ?engine=webgl2" : "직접 선택 (WebGL2)", pref };
  if (!i.hasWebGPU) return { want: "webgl2", reason: "WebGPU 미지원 브라우저", pref };
  if (pref === "webgpu") return { want: "webgpu", reason: null, pref };
  if (isIntelIntegrated(i.adapterVendor, i.adapterArchitecture, i.adapterDescription))
    return { want: "webgl2", reason: "Intel 내장 그래픽 — WebGL2가 더 빠름 (자동, ?tune에서 변경)", pref };
  return { want: "webgpu", reason: null, pref };
}
