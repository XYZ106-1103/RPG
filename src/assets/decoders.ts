/**
 * KTX2 / meshopt 디코더를 우리 사이트에서 내려받도록 설정한다 (Babylon 기본값은 cdn.babylonjs.com).
 * 에셋(GLB, KTX2)을 로드하기 전에 한 번 호출한다.
 *
 *  - meshopt: meshoptimizer의 ESM 디코더를 번들에 넣어 전역 MeshoptDecoder로 둔다.
 *    Babylon은 decoder.url 스크립트를 불러온 뒤 전역 MeshoptDecoder를 쓰므로, 빈 스크립트(blob)를 가리키게 한다.
 *  - KTX2: @babylonjs/ktx2decoder(ES 모듈)를 전역 KTX2DECODER로 두고 메인 스레드에서 트랜스코딩한다.
 *    (패키지에 워커용 UMD 번들이 없다 — TODO(성능): 워커 번들을 만들어 로딩 중 끊김 줄이기)
 *    트랜스코더 WASM은 Vite가 자산으로 복사한 우리 사이트의 파일을 쓴다.
 */
import * as KTX2DECODER from "@babylonjs/ktx2decoder";
import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import mscJs from "@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.js?url";
import mscWasm from "@babylonjs/ktx2decoder/wasm/msc_basis_transcoder.wasm?url";
import uastcAstc from "@babylonjs/ktx2decoder/wasm/uastc_astc.wasm?url";
import uastcBc7 from "@babylonjs/ktx2decoder/wasm/uastc_bc7.wasm?url";
import uastcR8 from "@babylonjs/ktx2decoder/wasm/uastc_r8_unorm.wasm?url";
import uastcRg8 from "@babylonjs/ktx2decoder/wasm/uastc_rg8_unorm.wasm?url";
import uastcRgbaSrgb from "@babylonjs/ktx2decoder/wasm/uastc_rgba8_srgb_v2.wasm?url";
import uastcRgbaUnorm from "@babylonjs/ktx2decoder/wasm/uastc_rgba8_unorm_v2.wasm?url";
import zstdWasm from "@babylonjs/ktx2decoder/wasm/zstddec.wasm?url";

let configured = false;

/** 상대 경로(./assets/...)를 절대 URL로 — 트랜스코더는 워커/스크립트 기준이 아니라 페이지 기준으로 읽게 */
const abs = (u: string): string => new URL(u, document.baseURI).href;

export function configureDecoders(): void {
  if (configured) return;
  configured = true;

  // meshopt
  (globalThis as { MeshoptDecoder?: unknown }).MeshoptDecoder = MeshoptDecoder;
  const empty = URL.createObjectURL(new Blob(["/* MeshoptDecoder는 번들에서 미리 로드됨 */"], { type: "text/javascript" }));
  MeshoptCompression.Configuration = { decoder: { url: empty } };

  // KTX2 (메인 스레드)
  const m = KTX2DECODER;
  m.LiteTranscoder_UASTC_ASTC.WasmModuleURL = abs(uastcAstc);
  m.LiteTranscoder_UASTC_BC7.WasmModuleURL = abs(uastcBc7);
  m.LiteTranscoder_UASTC_RGBA_UNORM.WasmModuleURL = abs(uastcRgbaUnorm);
  m.LiteTranscoder_UASTC_RGBA_SRGB.WasmModuleURL = abs(uastcRgbaSrgb);
  m.LiteTranscoder_UASTC_R8_UNORM.WasmModuleURL = abs(uastcR8);
  m.LiteTranscoder_UASTC_RG8_UNORM.WasmModuleURL = abs(uastcRg8);
  m.MSCTranscoder.JSModuleURL = abs(mscJs);
  m.MSCTranscoder.WasmModuleURL = abs(mscWasm);
  m.MSCTranscoder.UseFromWorkerThread = false;
  m.WASMMemoryManager.LoadBinariesFromCurrentThread = true;
  m.ZSTDDecoder.WasmModuleURL = abs(zstdWasm);
  (globalThis as { KTX2DECODER?: unknown }).KTX2DECODER = m;
  KhronosTextureContainer2.DefaultNumWorkers = 0;
}
