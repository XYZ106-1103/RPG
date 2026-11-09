/**
 * 후처리 파이프라인 (CLAUDE.md "후처리 순서"). 순서·지원 판정은 chain.ts(순수), 여기는 Babylon 객체를 만들고 붙인다.
 *
 *  - 효과마다 "유닛"(만들기/붙이기/떼기/버리기). 패스는 카메라를 주고 만들어야 씬을 안다(모션 블러 등) —
 *    만들 때 카메라 끝에 붙지만 바로 아래 재정렬에서 떼었다 다시 붙인다.
 *  - 프리셋이 바뀌면 필요 없어진 유닛은 버리고(프리패스 등 자원 해제)
 *    새로 필요한 유닛을 만든 뒤, 전부 떼었다가 정해진 순서로 다시 붙인다 — Babylon은 붙인 순서대로 실행하므로
 *    켜고 끄기를 반복해도 순서가 흐트러지지 않는다.
 *  - 미지원 효과(백엔드 기능 / Babylon 자체 검사 / 생성 실패)는 프리셋과 상관없이 끄고 콘솔 경고 + 패널 표시.
 *  - HDR: 이미지 처리(ACES)까지는 반정밀 부동소수 텍스처, 그 뒤(FXAA, 비네팅/그레인)는 8비트.
 *  - Babylon 이미지 처리의 비네팅은 ACES 앞에서 적용되므로 끄고, 비네팅은 마지막 패스(ashenFinish)에서 한다.
 */
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { RenderTargetWrapper } from "@babylonjs/core/Engines/renderTargetWrapper";
import type { PointLight } from "@babylonjs/core/Lights/pointLight";
import type { PrePassEffectConfiguration } from "@babylonjs/core/Rendering/prePassEffectConfiguration";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { RawTexture3D } from "@babylonjs/core/Materials/Textures/rawTexture3D";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BloomEffect } from "@babylonjs/core/PostProcesses/bloomEffect";
import { DepthOfFieldEffect, DepthOfFieldEffectBlurLevel } from "@babylonjs/core/PostProcesses/depthOfFieldEffect";
import { FxaaPostProcess } from "@babylonjs/core/PostProcesses/fxaaPostProcess";
import { ImageProcessingPostProcess } from "@babylonjs/core/PostProcesses/imageProcessingPostProcess";
import { MotionBlurPostProcess } from "@babylonjs/core/PostProcesses/motionBlurPostProcess";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { PostProcessRenderPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipeline";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { SSRRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline";
import { TAARenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/taaRenderingPipeline";
import { ThinFSR1SharpenPostProcess } from "@babylonjs/core/PostProcesses/thinFSR1SharpenPostProcess";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";
// 엔진 확장 (트리 셰이킹으로 기본 포함되지 않는다): 다중 렌더 타깃(프리패스), 원시 3D 텍스처(LUT) — WebGL2/WebGPU 양쪽
import "@babylonjs/core/Engines/Extensions/engine.multiRender";
import "@babylonjs/core/Engines/Extensions/engine.rawTexture";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.rawTexture";
import type { QualityManager, QualityPreset } from "../quality";
import { POSTFX_LABELS, planChain, resolveSupport, type ChainPlan, type GpuCaps, type PostFxId, type Support } from "./chain";
import { lutToRgba8, type Lut } from "./lut";
import type { RegionLook } from "./regions";
import { FINISH_SHADER, FINISH_UNIFORMS, VOLUMETRIC_SAMPLERS, VOLUMETRIC_SHADER, VOLUMETRIC_UNIFORMS, registerPostFxShaders } from "./shaders";

export interface PostFxSettings {
  /** 등불 안개 산란 세기 배율 */
  volumetricStrength: number;
  /** 산란 방향성 (Henyey-Greenstein g: 0 고르게 ~ 0.9 등불을 바라볼 때만) */
  volumetricAnisotropy: number;
  /** 산란 계산 최대 거리 (m) */
  volumetricMaxDistance: number;
  vignetteStrength: number;
  /** 비네팅 시작 반경 (화면 중심 기준, 세로 0.5 = 가장자리) */
  vignetteRadius: number;
  vignetteSoftness: number;
  grainIntensity: number;
  ssaoStrength: number;
  ssaoRadius: number;
  /** DOF 조리개 (작을수록 흐림이 강하다) */
  dofFStop: number;
  /** 선명화 세기 (0 끔 ~ 1) — 렌더 해상도가 100% 미만일 때만, 해상도가 낮을수록 더 세게 */
  sharpen: number;
}

export const DEFAULT_POSTFX: PostFxSettings = {
  volumetricStrength: 1,
  volumetricAnisotropy: 0.35,
  volumetricMaxDistance: 60,
  vignetteStrength: 0.45,
  vignetteRadius: 0.45,
  vignetteSoftness: 0.5,
  grainIntensity: 0.035,
  ssaoStrength: 1,
  ssaoRadius: 1.2,
  dofFStop: 4,
  sharpen: 0.8,
};

/** 효과 하나 */
interface FxUnit {
  attach(camera: Camera): void;
  detach(camera: Camera): void;
  dispose(): void;
  /** 생성 후 Babylon이 미지원이라고 하면 이유 */
  unsupported?: string;
}

/** 패스별 측정용 정보 */
export interface FxPassGroup {
  id: PostFxId;
  label: string;
  passes: PostProcess[];
}

const HALF = Constants.TEXTURETYPE_HALF_FLOAT;
const BYTE = Constants.TEXTURETYPE_UNSIGNED_BYTE;
const PREPASS_USERS: readonly PostFxId[] = ["ssao", "ssr", "volumetric", "taa", "motionBlur"];

function pipelineUnit(scene: Scene, pipeline: PostProcessRenderPipeline, extra?: () => void): FxUnit {
  const mgr = scene.postProcessRenderPipelineManager;
  return {
    attach: (c) => mgr.attachCamerasToRenderPipeline(pipeline.name, c),
    detach: (c) => mgr.detachCamerasFromRenderPipeline(pipeline.name, c),
    dispose: () => {
      pipeline.dispose();
      extra?.();
    },
  };
}

function singleUnit(pp: PostProcess, extra?: () => void): FxUnit {
  return {
    attach: (c) => c.attachPostProcess(pp),
    detach: (c) => c.detachPostProcess(pp),
    dispose: () => {
      pp.dispose();
      extra?.();
    },
  };
}

export class PostFxSystem {
  readonly settings: PostFxSettings;
  readonly caps: GpuCaps;
  readonly support: Record<PostFxId, Support>;
  plan: ChainPlan = { active: [], disabled: [] };
  private readonly units = new Map<PostFxId, FxUnit>();
  /** 효과별로 카메라에 실제로 붙은 패스 (붙일 때 카메라 목록이 늘어난 만큼 — GPU 시간 측정용) */
  private readonly passMap = new Map<PostFxId, PostProcess[]>();
  /** 생성 중/생성 후 실패해 이번 세션에서 끈 효과 */
  private readonly runtimeFailed = new Map<PostFxId, string>();
  private readonly warned = new Set<string>();
  private preset: Readonly<QualityPreset>;
  private readonly unsubscribe: () => void;
  private readonly engine: AbstractEngine;
  private readonly lutTexture: RawTexture3D;
  private lutBytes: Uint8Array;
  private bloom: BloomEffect | null = null;
  private ssao: SSAO2RenderingPipeline | null = null;
  private dof: DepthOfFieldEffect | null = null;
  private look: RegionLook | null = null;
  private time = 0;
  private focusDistance = 4;
  private readonly lanternView = new Vector3();
  /** 지금 렌더 해상도 배율 (동적 해상도) — 선명화 여부와 세기 */
  private renderScale = 1;
  private sharpenWanted = false;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly lantern: PointLight,
    quality: QualityManager,
    initialLut: Lut,
    settings: Partial<PostFxSettings> = {},
  ) {
    registerPostFxShaders();
    this.settings = { ...DEFAULT_POSTFX, ...settings };
    this.engine = scene.getEngine();
    const caps = this.engine.getCaps();
    const webgpu = this.engine.isWebGPU;
    this.caps = {
      backend: webgpu ? "WebGPU" : "WebGL2",
      halfFloatRender: caps.textureHalfFloatRender,
      multiRenderTargets: caps.drawBuffersExtension,
      // WebGL2와 WebGPU는 3D 텍스처를 항상 지원 (이 게임은 WebGL1을 쓰지 않는다)
      texture3D: webgpu || ((this.engine as unknown as { webGLVersion?: number }).webGLVersion ?? 0) >= 2,
      // Babylon 9.33 WebGPU: 속도(velocity) 프리패스 파이프라인이 "Vertex attribute slot 8 … not present in the VertexState"
      // 검증 오류를 내고 이후 화면 전체가 검게 나온다 (헤드리스 WebGPU에서 재현). 속도 버퍼가 필요한 효과(TAA 재투영)는 끈다
      velocityPrePass: !webgpu,
    };
    this.support = resolveSupport(this.caps, {
      ssao2: SSAO2RenderingPipeline.IsSupported,
      ssr: caps.drawBuffersExtension && caps.texelFetch,
      taa: caps.texelFetch,
      motionBlur: caps.drawBuffersExtension,
    });

    // 이미지 처리는 후처리 패스에서 (재질 셰이더에서 하지 않게 — 씬 생성 시에도 켜 두지만 다시 확인)
    const ip = scene.imageProcessingConfiguration;
    ip.applyByPostProcess = true;
    ip.vignetteEnabled = false;
    // LUT (3D 텍스처, 지역 전환 중에만 다시 올린다)
    this.lutBytes = lutToRgba8(initialLut);
    const n = initialLut.size;
    this.lutTexture = new RawTexture3D(this.lutBytes, n, n, n, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, BYTE);
    this.lutTexture.wrapU = this.lutTexture.wrapV = this.lutTexture.wrapR = Texture.CLAMP_ADDRESSMODE;
    if (this.caps.texture3D) {
      ip.colorGradingTexture = this.lutTexture;
      ip.colorGradingEnabled = true;
    } else this.warnOnce("lut", "[postfx] 3D 텍스처 미지원 — LUT 그레이딩 없이 진행합니다");

    this.preset = quality.current;
    this.unsubscribe = quality.subscribe(["ssao", "ssaoRatio", "ssr", "volumetric", "antiAliasing", "motionBlur", "bloom", "dof"], (p, prev) => {
      this.preset = p;
      this.rebuild(prev);
    });
  }

  // ---------------------------------------------------------------------------

  /** 렌더 직전 (매 프레임): 지역 톤(블룸), 볼류메트릭 등불, DOF 초점, 그레인 시간 */
  update(dt: number, look: RegionLook, focusDistance: number): void {
    this.time += dt;
    this.look = look;
    this.focusDistance = focusDistance;
    if (this.bloom) {
      this.bloom.threshold = look.bloomThreshold;
      this.bloom.weight = look.bloomWeight;
    }
    if (this.ssao) {
      this.ssao.totalStrength = this.settings.ssaoStrength;
      this.ssao.radius = this.settings.ssaoRadius;
    }
    if (this.dof) {
      this.dof.focusDistance = Math.max(0.5, focusDistance) * 1000;
      this.dof.fStop = this.settings.dofFStop;
    }
  }

  /** 동적 해상도가 바뀔 때 — 100% 미만이면 선명화 패스를 켠다 (켜고 끌 때만 체인을 다시 짠다) */
  setRenderScale(scale: number): void {
    this.renderScale = scale;
    const want = scale < 0.999 && this.settings.sharpen > 0;
    if (want === this.sharpenWanted) return;
    this.sharpenWanted = want;
    this.rebuild(null);
  }

  /** RCAS 세기 (stops: 0 가장 선명 ~ 2 약함) — 해상도가 낮을수록 세게 */
  private sharpenStops(): number {
    const deficit = Math.min(1, Math.max(0, (1 - this.renderScale) / 0.4));
    const amount = Math.min(1, Math.max(0, this.settings.sharpen)) * (0.5 + 0.5 * deficit);
    return 2 * (1 - amount);
  }

  /** 지역 전환으로 LUT가 바뀌었을 때 */
  updateLut(lut: Lut): void {
    this.lutBytes = lutToRgba8(lut, this.lutBytes);
    this.lutTexture.update(this.lutBytes);
  }

  /** 디버그 패널 한 줄 */
  describe(): string {
    const chain = this.plan.active.map((id) => POSTFX_LABELS[id]).join(" › ");
    const off = this.plan.disabled.map((d) => `${POSTFX_LABELS[d.id]}(${d.reason})`);
    return `${this.caps.backend} ${chain}${off.length ? `  미지원: ${off.join(", ")}` : ""}`;
  }

  /** 프리패스 MRT (패스별 GPU 시간 — 씬이 여기에 그려진다) */
  prePassTarget(): RenderTargetWrapper | null {
    return this.scene.prePassRenderer?.getRenderTarget()?.renderTarget ?? null;
  }

  /** 지금 붙어 있는 효과별 패스 (정해진 순서) */
  passGroups(): FxPassGroup[] {
    return this.plan.active.flatMap((id) => {
      const passes = this.passMap.get(id);
      return passes ? [{ id, label: POSTFX_LABELS[id], passes }] : [];
    });
  }

  dispose(): void {
    this.unsubscribe();
    for (const u of this.units.values()) {
      u.detach(this.camera);
      u.dispose();
    }
    this.units.clear();
    this.lutTexture.dispose();
  }

  // ---------------------------------------------------------------------------

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(msg);
  }

  private effectiveSupport(): Record<PostFxId, Support> {
    const s = { ...this.support };
    for (const [id, reason] of this.runtimeFailed) s[id] = { ok: false, reason };
    return s;
  }

  /** 프리셋/지원 여부로 체인을 다시 짠다 */
  private rebuild(prev: Readonly<QualityPreset> | null): void {
    for (;;) {
      this.plan = planChain(this.preset, this.effectiveSupport(), { sharpen: this.sharpenWanted });
      for (const d of this.plan.disabled) this.warnOnce(`off:${d.id}`, `[postfx] ${POSTFX_LABELS[d.id]} 비활성화 — ${d.reason}`);
      // 필요 없어진 것 버리기, 설정이 바뀐 것은 다시 만들기
      for (const [id, u] of this.units) {
        if (!this.plan.active.includes(id) || (prev && this.paramsChanged(id, prev))) {
          u.detach(this.camera);
          u.dispose();
          this.units.delete(id);
          if (id === "bloom") this.bloom = null;
          if (id === "ssao") this.ssao = null;
          if (id === "dof") this.dof = null;
        }
      }
      let failed = false;
      for (const id of this.plan.active) {
        if (this.units.has(id)) continue;
        try {
          const u = this.create(id);
          if (u.unsupported) {
            u.dispose();
            this.runtimeFailed.set(id, u.unsupported);
            failed = true;
            break;
          }
          this.units.set(id, u);
        } catch (err) {
          console.warn(`[postfx] ${POSTFX_LABELS[id]} 생성 실패 — 끕니다`, err);
          this.runtimeFailed.set(id, `${this.caps.backend}: 생성 실패`);
          failed = true;
          break;
        }
      }
      if (!failed) break; // 실패가 있으면 그 효과를 뺀 계획으로 다시
    }
    // 정해진 순서로 다시 붙이기
    for (const u of this.units.values()) u.detach(this.camera);
    this.passMap.clear();
    const list = this.camera._postProcesses;
    for (const id of this.plan.active) {
      const u = this.units.get(id);
      if (!u) continue;
      const before = new Set(list);
      u.attach(this.camera);
      this.passMap.set(
        id,
        list.filter((pp): pp is PostProcess => pp !== null && !before.has(pp)),
      );
    }
    // 프리패스(깊이/노멀/속도)를 쓰는 효과가 하나도 없으면 끈다 (MRT 비용 절약)
    if (!this.plan.active.some((id) => PREPASS_USERS.includes(id)) && this.scene.prePassRenderer) this.scene.disablePrePassRenderer();
  }

  private paramsChanged(id: PostFxId, prev: Readonly<QualityPreset>): boolean {
    const p = this.preset;
    const j = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);
    switch (id) {
      case "ssao":
        return j(p.ssao, prev.ssao) || p.ssaoRatio !== prev.ssaoRatio;
      case "ssr":
        return j(p.ssr, prev.ssr);
      case "volumetric":
        return j(p.volumetric, prev.volumetric);
      case "motionBlur":
        return j(p.motionBlur, prev.motionBlur);
      case "bloom":
        return j(p.bloom, prev.bloom);
      case "dof":
        return j(p.dof, prev.dof);
      default:
        return false;
    }
  }

  private create(id: PostFxId): FxUnit {
    const scene = this.scene;
    const engine = this.engine;
    const p = this.preset;
    switch (id) {
      case "ssao": {
        const ssao = new SSAO2RenderingPipeline("ashen_ssao", scene, { ssaoRatio: p.ssaoRatio, blurRatio: p.ssaoRatio }, [], false, HALF);
        ssao.samples = p.ssao.samples;
        ssao.totalStrength = this.settings.ssaoStrength;
        ssao.radius = this.settings.ssaoRadius;
        ssao.maxZ = 80;
        ssao.expensiveBlur = p.ssao.samples >= 32;
        this.ssao = ssao;
        return pipelineUnit(scene, ssao);
      }
      case "ssr": {
        const ssr = new SSRRenderingPipeline("ashen_ssr", scene, [], false, HALF);
        const u = pipelineUnit(scene, ssr);
        if (!ssr.isSupported) return { ...u, unsupported: `${this.caps.backend}: SSR 미지원` };
        ssr.samples = 1;
        ssr.maxSteps = p.ssr.samples * 32;
        ssr.strength = 0.6;
        ssr.roughnessFactor = 0.2;
        ssr.ssrDownsample = 1;
        ssr.blurDownsample = 1;
        // 입력은 선형 HDR (톤매핑 전). 기본값(감마 입력/출력)이면 감마가 두 번 걸려 화면 전체가 뿌옇게 밝아진다
        ssr.inputTextureColorIsInGammaSpace = false;
        ssr.generateOutputInGammaSpace = false;
        // 반사율이 낮은 면(거친 흙·재)은 건너뛰고, 정면으로 보는 면의 반사는 약하게 (뿌연 막 방지)
        ssr.reflectivityThreshold = 0.2;
        ssr.useFresnel = true;
        ssr.attenuateFacingCamera = true;
        return u;
      }
      case "taa": {
        const taa = new TAARenderingPipeline("ashen_taa", scene, [], HALF);
        const u = pipelineUnit(scene, taa);
        if (!taa.isSupported) return { ...u, unsupported: `${this.caps.backend}: TAA 미지원` };
        taa.samples = 8;
        // 이력 재투영(속도 버퍼): 카메라/물체가 움직여도 잔상이 적다 (WebGPU는 chain.ts에서 FXAA로 대체 — velocityPrePass 참고)
        taa.reprojectHistory = true;
        taa.clampHistory = true;
        return u;
      }
      case "volumetric":
        return this.createVolumetric();
      case "motionBlur": {
        const mb = new MotionBlurPostProcess("ashen_motionBlur", scene, 1.0, this.camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, HALF, false, false);
        mb.isObjectBased = false; // 카메라 움직임 기준 (스키닝 캐릭터 속도 버퍼 비용 없이)
        mb.motionStrength = p.motionBlur.strength;
        mb.motionBlurSamples = p.motionBlur.samples;
        return singleUnit(mb);
      }
      case "bloom": {
        const look = this.look;
        const bloom = new BloomEffect(scene, p.bloom.scale, look?.bloomWeight ?? 0.5, p.bloom.kernel, HALF);
        bloom.threshold = look?.bloomThreshold ?? 1.5;
        const pipe = new PostProcessRenderPipeline(engine, "ashen_bloom");
        pipe.addEffect(bloom);
        scene.postProcessRenderPipelineManager.addPipeline(pipe);
        this.bloom = bloom;
        return pipelineUnit(scene, pipe);
      }
      case "dof": {
        const depth = scene.enableDepthRenderer(this.camera, false);
        const levels = [DepthOfFieldEffectBlurLevel.Low, DepthOfFieldEffectBlurLevel.Medium, DepthOfFieldEffectBlurLevel.High] as const;
        const dof = new DepthOfFieldEffect(scene, depth.getDepthMap(), levels[p.dof.blurLevel], HALF);
        dof.focalLength = 50;
        dof.fStop = this.settings.dofFStop;
        dof.focusDistance = this.focusDistance * 1000;
        const pipe = new PostProcessRenderPipeline(engine, "ashen_dof");
        pipe.addEffect(dof);
        scene.postProcessRenderPipelineManager.addPipeline(pipe);
        this.dof = dof;
        return pipelineUnit(scene, pipe, () => scene.disableDepthRenderer(this.camera));
      }
      case "imageProcessing": {
        const ipp = new ImageProcessingPostProcess("ashen_imageProcessing", 1.0, this.camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, HALF, scene.imageProcessingConfiguration);
        scene.imageProcessingConfiguration.applyByPostProcess = true;
        return singleUnit(ipp);
      }
      case "fxaa":
        return singleUnit(new FxaaPostProcess("ashen_fxaa", 1.0, this.camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, BYTE));
      case "sharpen": {
        // AMD FSR1 RCAS (대비 적응 선명화) — Babylon 셰이더(GLSL/WGSL)를 그대로 쓴다
        const thin = new ThinFSR1SharpenPostProcess("ashen_sharpen", engine);
        const pp = new PostProcess("ashen_sharpen", ThinFSR1SharpenPostProcess.FragmentUrl, {
          uniforms: ThinFSR1SharpenPostProcess.Uniforms,
          engine,
          camera: this.camera,
          textureType: BYTE,
          effectWrapper: thin,
        });
        pp.onApplyObservable.add((effect) => thin.updateConstants(effect, this.sharpenStops()));
        return singleUnit(pp, () => thin.dispose());
      }
      case "finish":
        return this.createFinish();
    }
  }

  private shaderLanguage(): ShaderLanguage {
    return this.engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL;
  }

  private createVolumetric(): FxUnit {
    const scene = this.scene;
    const pre = scene.enablePrePassRenderer();
    if (!pre) throw new Error("프리패스 렌더러를 켤 수 없습니다");
    const cfg: PrePassEffectConfiguration = { name: "ashenVolumetric", texturesRequired: [Constants.PREPASS_DEPTH_TEXTURE_TYPE], enabled: true };
    const pp = new PostProcess(
      "ashen_volumetric",
      VOLUMETRIC_SHADER,
      VOLUMETRIC_UNIFORMS,
      VOLUMETRIC_SAMPLERS,
      1.0,
      this.camera,
      Texture.BILINEAR_SAMPLINGMODE,
      this.engine,
      false,
      null,
      HALF,
      "postprocess",
      undefined,
      false,
      Constants.TEXTUREFORMAT_RGBA,
      this.shaderLanguage(),
    );
    pp._prePassEffectConfiguration = pre.addEffectConfiguration(cfg);
    pp.onApplyObservable.add((effect) => {
      const s = this.settings;
      const look = this.look;
      const cam = this.camera;
      const target = pre.getRenderTarget();
      const idx = pre.getIndex(Constants.PREPASS_DEPTH_TEXTURE_TYPE);
      const depthTex = idx >= 0 ? target.textures[idx] : undefined;
      if (depthTex) effect.setTexture("depthSampler", depthTex);
      Vector3.TransformCoordinatesToRef(this.lantern.getAbsolutePosition(), cam.getViewMatrix(), this.lanternView);
      effect.setVector3("lanternPosView", this.lanternView);
      const li = this.lantern.intensity;
      const d = this.lantern.diffuse;
      effect.setFloat3("lanternColor", d.r * li, d.g * li, d.b * li);
      effect.setFloat("lanternRange", this.lantern.range);
      effect.setFloat("scatter", (look?.fogDensity ?? 0.03) * s.volumetricStrength);
      effect.setFloat("anisotropy", s.volumetricAnisotropy);
      const tanY = Math.tan(cam.fov / 2);
      effect.setFloat2("tanHalfFov", tanY * this.engine.getAspectRatio(cam), tanY);
      effect.setFloat("maxDistance", s.volumetricMaxDistance);
    });
    return singleUnit(pp, () => {
      cfg.enabled = false;
    });
  }

  private createFinish(): FxUnit {
    const pp = new PostProcess(
      "ashen_finish",
      FINISH_SHADER,
      FINISH_UNIFORMS,
      null,
      1.0,
      this.camera,
      Texture.BILINEAR_SAMPLINGMODE,
      this.engine,
      false,
      null,
      BYTE,
      "postprocess",
      undefined,
      false,
      Constants.TEXTUREFORMAT_RGBA,
      this.shaderLanguage(),
    );
    pp.onApplyObservable.add((effect) => {
      const s = this.settings;
      effect.setFloat("vignetteStrength", s.vignetteStrength);
      effect.setFloat("vignetteRadius", s.vignetteRadius);
      effect.setFloat("vignetteSoftness", s.vignetteSoftness);
      effect.setFloat("aspectRatio", this.engine.getAspectRatio(this.camera));
      effect.setFloat("grainIntensity", s.grainIntensity);
      effect.setFloat("grainSeed", (this.time * 60) % 1000);
    });
    return singleUnit(pp);
  }
}

/** 씬 생성 직후 (재질이 만들어지기 전에) — 이미지 처리를 후처리에서 하도록. freeze()된 재질이 톤매핑을 두 번 하지 않게 */
export function prepareSceneForPostFx(scene: Scene): void {
  scene.imageProcessingConfiguration.applyByPostProcess = true;
}
