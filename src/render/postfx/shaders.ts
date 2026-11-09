/**
 * 직접 작성한 후처리 셰이더 (WebGL2용 GLSL + WebGPU용 WGSL — 같은 계산을 두 언어로).
 *
 * ashenVolumetric: 등불(포인트 라이트)의 안개 산란 — 시선 광선 위 산란을 해석적으로 적분한다.
 *   단일 산란, 균질 매질, 역제곱 감쇠: ∫ 1/(h² + (t - t0)²) dt = (atan((b - t0)/h) - atan((a - t0)/h)) / h
 *   (h = 광원과 광선 사이 최단 거리, t0 = 최단점, [a, b] = 등불 범위 안의 광선 구간). 샘플링이 없어 노이즈가 없다.
 *   위상 함수는 Henyey-Greenstein을 최단점 각도로 근사, 카메라까지 투과율은 exp(-밀도·거리).
 *   TODO(렌더): 물체가 빛을 가리는 그림자(등불 큐브 그림자 표본 레이마칭) — 프리셋 volumetric.samples 사용 예정
 * ashenFinish: 비네팅 + 필름 그레인 (톤매핑·LUT 뒤, 화면 공간)
 */
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
// 후처리 기본 정점 셰이더 (두 언어 모두 — WebGPU에서는 WGSL 판이 필요하다)
import "@babylonjs/core/Shaders/postprocess.vertex";
import "@babylonjs/core/ShadersWGSL/postprocess.vertex";

export const VOLUMETRIC_SHADER = "ashenVolumetric";
export const FINISH_SHADER = "ashenFinish";

export const VOLUMETRIC_UNIFORMS = ["lanternPosView", "lanternColor", "lanternRange", "scatter", "anisotropy", "tanHalfFov", "maxDistance"];
export const VOLUMETRIC_SAMPLERS = ["depthSampler"];
export const FINISH_UNIFORMS = ["vignetteStrength", "vignetteRadius", "vignetteSoftness", "aspectRatio", "grainIntensity", "grainSeed"];

const VOLUMETRIC_GLSL = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;
uniform vec3 lanternPosView;
uniform vec3 lanternColor;
uniform float lanternRange;
uniform float scatter;
uniform float anisotropy;
uniform vec2 tanHalfFov;
uniform float maxDistance;

const float PI = 3.14159265;

void main(void) {
  vec4 color = texture2D(textureSampler, vUV);
  float viewZ = texture2D(depthSampler, vUV).r;
  if (viewZ <= 0.0) viewZ = maxDistance;
  vec2 ndc = vUV * 2.0 - 1.0;
  vec3 ray = vec3(ndc.x * tanHalfFov.x, ndc.y * tanHalfFov.y, 1.0);
  float rayScale = length(ray);
  vec3 dir = ray / rayScale;
  float dist = min(viewZ * rayScale, maxDistance);

  float t0 = dot(lanternPosView, dir);
  vec3 toRay = dir * t0 - lanternPosView;
  float h2 = max(dot(toRay, toRay), 1e-4);
  float h = sqrt(h2);
  float halfChord = sqrt(max(lanternRange * lanternRange - h2, 0.0));
  float a = max(0.0, t0 - halfChord);
  float b = min(dist, t0 + halfChord);
  vec3 inscatter = vec3(0.0);
  if (b > a) {
    float integral = (atan((b - t0) / h) - atan((a - t0) / h)) / h;
    float tc = clamp(t0, a, b);
    vec3 wi = normalize(dir * tc - lanternPosView + vec3(1e-5));
    float cosTheta = dot(wi, -dir);
    float g = anisotropy;
    float phase = (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * cosTheta, 1e-4), 1.5));
    float transmittance = exp(-scatter * tc);
    inscatter = lanternColor * (scatter * integral * phase * transmittance);
  }
  gl_FragColor = vec4(color.rgb + inscatter, color.a);
}
`;

const VOLUMETRIC_WGSL = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
var depthSamplerSampler: sampler;
var depthSampler: texture_2d<f32>;
uniform lanternPosView: vec3f;
uniform lanternColor: vec3f;
uniform lanternRange: f32;
uniform scatter: f32;
uniform anisotropy: f32;
uniform tanHalfFov: vec2f;
uniform maxDistance: f32;

const PI: f32 = 3.14159265;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let color = textureSample(textureSampler, textureSamplerSampler, input.vUV);
  var viewZ = textureSample(depthSampler, depthSamplerSampler, input.vUV).r;
  if (viewZ <= 0.0) { viewZ = uniforms.maxDistance; }
  let ndc = input.vUV * 2.0 - 1.0;
  let ray = vec3f(ndc.x * uniforms.tanHalfFov.x, ndc.y * uniforms.tanHalfFov.y, 1.0);
  let rayScale = length(ray);
  let dir = ray / rayScale;
  let dist = min(viewZ * rayScale, uniforms.maxDistance);

  let L = uniforms.lanternPosView;
  let t0 = dot(L, dir);
  let toRay = dir * t0 - L;
  let h2 = max(dot(toRay, toRay), 1e-4);
  let h = sqrt(h2);
  let halfChord = sqrt(max(uniforms.lanternRange * uniforms.lanternRange - h2, 0.0));
  let a = max(0.0, t0 - halfChord);
  let b = min(dist, t0 + halfChord);
  var inscatter = vec3f(0.0);
  if (b > a) {
    let integral = (atan((b - t0) / h) - atan((a - t0) / h)) / h;
    let tc = clamp(t0, a, b);
    let wi = normalize(dir * tc - L + vec3f(1e-5));
    let cosTheta = dot(wi, -dir);
    let g = uniforms.anisotropy;
    let phase = (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * cosTheta, 1e-4), 1.5));
    let transmittance = exp(-uniforms.scatter * tc);
    inscatter = uniforms.lanternColor * (uniforms.scatter * integral * phase * transmittance);
  }
  fragmentOutputs.color = vec4f(color.rgb + inscatter, color.a);
}
`;

const FINISH_GLSL = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float vignetteStrength;
uniform float vignetteRadius;
uniform float vignetteSoftness;
uniform float aspectRatio;
uniform float grainIntensity;
uniform float grainSeed;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main(void) {
  vec4 color = texture2D(textureSampler, vUV);
  vec2 p = vUV - 0.5;
  p.x *= aspectRatio;
  float vig = 1.0 - vignetteStrength * smoothstep(vignetteRadius, vignetteRadius + vignetteSoftness, length(p));
  vec3 c = color.rgb * vig;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float n = hash12(gl_FragCoord.xy + vec2(grainSeed * 113.0, grainSeed * 71.0)) - 0.5;
  c += n * grainIntensity * (1.0 - abs(lum * 2.0 - 1.0) * 0.6);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), color.a);
}
`;

const FINISH_WGSL = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
uniform vignetteStrength: f32;
uniform vignetteRadius: f32;
uniform vignetteSoftness: f32;
uniform aspectRatio: f32;
uniform grainIntensity: f32;
uniform grainSeed: f32;

fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let color = textureSample(textureSampler, textureSamplerSampler, input.vUV);
  var p = input.vUV - 0.5;
  p.x = p.x * uniforms.aspectRatio;
  let vig = 1.0 - uniforms.vignetteStrength * smoothstep(uniforms.vignetteRadius, uniforms.vignetteRadius + uniforms.vignetteSoftness, length(p));
  var c = color.rgb * vig;
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let n = hash12(fragmentInputs.position.xy + vec2f(uniforms.grainSeed * 113.0, uniforms.grainSeed * 71.0)) - 0.5;
  c = c + n * uniforms.grainIntensity * (1.0 - abs(lum * 2.0 - 1.0) * 0.6);
  fragmentOutputs.color = vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), color.a);
}
`;

let registered = false;

/** 셰이더 저장소에 등록 (두 언어 모두, 한 번만) */
export function registerPostFxShaders(): void {
  if (registered) return;
  registered = true;
  ShaderStore.ShadersStore[`${VOLUMETRIC_SHADER}PixelShader`] = VOLUMETRIC_GLSL;
  ShaderStore.ShadersStoreWGSL[`${VOLUMETRIC_SHADER}PixelShader`] = VOLUMETRIC_WGSL;
  ShaderStore.ShadersStore[`${FINISH_SHADER}PixelShader`] = FINISH_GLSL;
  ShaderStore.ShadersStoreWGSL[`${FINISH_SHADER}PixelShader`] = FINISH_WGSL;
}
