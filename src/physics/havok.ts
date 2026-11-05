/**
 * Havok WASM 비동기 로드. 한 번만 로드하고 같은 인스턴스를 재사용한다.
 *
 * - 브라우저: Vite가 wasm 파일을 에셋으로 내보내고(`?url`), locateFile로 그 경로를 알려 준다.
 * - Node(테스트/서버): fetch로 파일 경로를 읽을 수 없으므로 wasmBinary를 직접 넘긴다.
 */
import HavokPhysics, { type HavokPhysicsWithBindings } from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";

export type HavokInstance = HavokPhysicsWithBindings;

export interface LoadHavokOptions {
  /** wasm 바이너리를 직접 넘긴다 (Node). 주면 URL 로드를 하지 않는다 */
  wasmBinary?: ArrayBuffer;
  /** wasm URL (기본: Vite가 번들한 경로) */
  wasmUrl?: string;
}

let cached: Promise<HavokInstance> | null = null;

export function loadHavok(options: LoadHavokOptions = {}): Promise<HavokInstance> {
  if (cached) return cached;
  const url = options.wasmUrl ?? havokWasmUrl;
  const moduleOptions: Partial<HavokInstance> = options.wasmBinary
    ? { wasmBinary: options.wasmBinary }
    : { locateFile: (file: string) => (file.endsWith(".wasm") ? url : file) };
  cached = HavokPhysics(moduleOptions).catch((err: unknown) => {
    cached = null; // 실패하면 다음 호출에서 다시 시도할 수 있게
    throw new Error(`Havok 물리 엔진(WASM)을 불러오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
  });
  return cached;
}

/** 테스트용: 캐시 초기화 */
export function resetHavokCacheForTests(): void {
  cached = null;
}
