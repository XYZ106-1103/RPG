// @ts-check
/**
 * 브라우저(헤드리스 Chromium)에서 실행: HDR 파노라마 → 프리필터된 큐브 → .env (Babylon 공식 변환).
 * tools/hdr_to_env.mjs가 Vite로 이 페이지를 띄우고 window.convertHdrToEnv를 호출한다.
 */
import { Engine } from "@babylonjs/core/Engines/engine";
import { HDRCubeTexture } from "@babylonjs/core/Materials/Textures/hdrCubeTexture";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { CreateEnvTextureAsync, GetEnvInfo } from "@babylonjs/core/Misc/environmentTextureTools";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SphericalHarmonics } from "@babylonjs/core/Maths/sphericalPolynomial";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Helpers/sceneHelpers";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("c"));
const engine = new Engine(canvas, false, { preserveDrawingBuffer: true });
const scene = new Scene(engine);
const camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 2 - 0.05, 1, Vector3.Zero(), scene);
camera.fov = 1.4;
engine.runRenderLoop(() => scene.render());

/** @param {ArrayBuffer} buf */
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * @param {string} url HDR 파일 URL
 * @param {number} size 반사용 큐브 한 면 크기
 * @param {string} imageType "image/png" | "image/webp"
 */
async function convertHdrToEnv(url, size, imageType) {
  const hdr = await new Promise((resolve, reject) => {
    const t = new HDRCubeTexture(url, scene, size, false, true, false, true, () => resolve(t), (msg) => reject(new Error(`HDR 로드 실패: ${msg ?? ""}`)));
  });
  const env = await CreateEnvTextureAsync(hdr, { imageType });
  hdr.dispose();

  // 검증: 만든 .env를 다시 불러와 정보와 조명(구면 조화) 데이터를 확인한다
  const info = GetEnvInfo(new Uint8Array(env));
  if (!info) throw new Error(".env 헤더를 읽을 수 없습니다.");
  const blobUrl = URL.createObjectURL(new Blob([env]));
  const tex = await new Promise((resolve, reject) => {
    const t = new CubeTexture(blobUrl, scene, null, false, null, () => resolve(t), (msg) => reject(new Error(`.env 다시 불러오기 실패: ${msg ?? ""}`)), undefined, true, ".env");
  });
  const sp = tex.sphericalPolynomial;
  if (!sp) throw new Error(".env에 조명(구면 조화) 데이터가 없습니다.");
  scene.createDefaultSkybox(tex, true, 100, 0);
  await scene.whenReadyAsync();
  // 평균 조명 밝기 근사 (구면 조화 l00 계수 = 전 방향 평균 복사휘도에 비례)
  const l00 = SphericalHarmonics.FromPolynomial(sp).l00;
  const avg = [l00.x, l00.y, l00.z];
  return { base64: toBase64(env), width: info.width, mipmaps: info.specular.mipmaps.length / 6 /* 면 6개 × 단계 */, imageType: info.imageType, irradiance: !!info.irradiance, avgRadiance: avg };
}

Object.assign(window, { convertHdrToEnv, envReady: true });
