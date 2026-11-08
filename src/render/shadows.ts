/**
 * 그림자: 태양 CascadedShadowGenerator + 등불(포인트 라이트) 큐브맵 그림자, 품질 프리셋 구독.
 *
 * 태양 (CSM)
 *  - 캐스케이드 수/해상도/필터(PCSS·PCF)는 프리셋, 경계 블렌딩·안정화(카메라가 움직여도 그림자가 떨리지 않게)
 *  - 원거리 캐스케이드(3, 4번)는 N프레임마다, 근거리는 매 프레임 갱신 (cascadeSchedule.ts)
 *    Babylon에 없는 기능이라 내부를 감싼다: 갱신하지 않는 캐스케이드는 (1) 투영 행렬을 직전 값으로 되돌리고
 *    (2) 그 층을 지우지도 그리지도 않아 직전 깊이를 그대로 쓴다. 내부 구조가 예상과 다르면(버전 변경)
 *    자동으로 매 프레임 전체 갱신으로 되돌아가고 경고를 띄운다.
 * 등불: High 이상 프리셋에서만 큐브맵 그림자 (Poisson 샘플링으로 가장자리를 부드럽게)
 *
 * 캐스터/리시버 등록은 addCaster/addReceiver가 돌려주는 해제 함수로 — 청크 로드/해제와 묶어 쓴다.
 * 메시가 dispose되면 자동으로 빠진다.
 */
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { PointLight } from "@babylonjs/core/Lights/pointLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import type { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Matrix, type Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { cascadeUpdates } from "./cascadeSchedule";
import type { QualityManager, QualityPreset } from "./quality";

export interface ShadowSettings {
  /** 태양 그림자 바이어스 — 키우면 그림자 여드름(아크네)이 줄고, 너무 크면 그림자가 떠 보인다(피터패닝) */
  sunBias: number;
  /** 법선 방향 바이어스 — 비스듬한 면의 아크네 */
  sunNormalBias: number;
  /** PCSS 광원 크기 (UV 비율) — 클수록 멀리서 그림자가 더 퍼진다 */
  pcssLightSize: number;
  /** 캐스케이드 경계 블렌딩 (0~1) */
  cascadeBlend: number;
  /** 캐스케이드 분할 (0 균등 ~ 1 로그 — 근거리에 해상도 집중) */
  lambda: number;
  /** 태양 그림자 최대 거리 (m) */
  shadowMaxZ: number;
  /** 그림자 진하기 (0 = 완전히 어둡게, 1 = 그림자 없음) */
  darkness: number;
  /** 원거리 캐스케이드 갱신 간격 강제 (0 = 프리셋 값) */
  farIntervalOverride: number;
  lanternBias: number;
  lanternNormalBias: number;
  lanternDarkness: number;
}

export const DEFAULT_SHADOWS: ShadowSettings = {
  sunBias: 0.0015,
  sunNormalBias: 0.02,
  pcssLightSize: 0.02,
  cascadeBlend: 0.12,
  lambda: 0.85,
  shadowMaxZ: 80,
  darkness: 0,
  farIntervalOverride: 0,
  lanternBias: 0.004,
  lanternNormalBias: 0.02,
  lanternDarkness: 0.15,
};

export interface CasterOptions {
  /** 태양 그림자를 드리운다 (기본 true) */
  sun?: boolean;
  /** 등불 그림자를 드리운다 (기본 true — 등불 그림자가 켜진 프리셋에서만 효과) */
  lantern?: boolean;
}

/** CSM 내부 (캐스케이드별 갱신을 위해 감싸는 부분 — Babylon 9.33 기준) */
interface CsmInternals {
  _numCascades: number;
  _computeMatrices: () => void;
  _viewMatrices: Matrix[];
  _projectionMatrices: Matrix[];
  _transformMatrices: Matrix[];
  _transformMatricesAsArray: Float32Array;
  _lightSizeUVCorrection: number[];
  _depthCorrection: number[];
  _cascadeMinExtents: Vector3[];
  _cascadeMaxExtents: Vector3[];
}

interface CascadeSnapshot {
  view: Float32Array;
  proj: Float32Array;
  transform: Float32Array;
  uvCorr: [number, number];
  depthCorr: number;
  min: [number, number, number];
  max: [number, number, number];
}

export interface ShadowStats {
  /** 지금까지 캐스케이드별로 실제로 다시 그린 횟수 */
  cascadeRenders: number[];
  /** 갱신을 건너뛴 횟수 */
  cascadeSkips: number[];
  frames: number;
  /** 캐스케이드별 갱신이 동작 중인가 (내부 구조가 달라 꺼졌으면 false) */
  perCascadeUpdate: boolean;
}

const EMPTY: AbstractMesh[] = [];

export class ShadowSystem {
  readonly settings: ShadowSettings;
  readonly sun: CascadedShadowGenerator;
  lanternGen: ShadowGenerator | null = null;
  readonly stats: ShadowStats = { cascadeRenders: [], cascadeSkips: [], frames: 0, perCascadeUpdate: true };

  private readonly casters = new Map<AbstractMesh, { sun: boolean; lantern: boolean; obs: Observer<Node> | null }>();
  private readonly receivers = new Set<AbstractMesh>();
  private preset: Readonly<QualityPreset>;
  private readonly updateMask: boolean[] = [];
  private readonly snaps: (CascadeSnapshot | null)[] = [];
  private hookedMap: RenderTargetTexture | null = null;
  private layerObserver: Observer<number> | null = null;
  private currentLayer = 0;
  private frame = 0;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly scene: Scene,
    sunLight: DirectionalLight,
    private readonly lanternLight: PointLight,
    quality: QualityManager,
    camera: Camera,
    settings: Partial<ShadowSettings> = {},
  ) {
    this.settings = { ...DEFAULT_SHADOWS, ...settings };
    this.preset = quality.current;
    this.sun = new CascadedShadowGenerator(this.preset.shadowMapSize, sunLight, undefined, camera);
    this.sun.stabilizeCascades = true;
    this.sun.depthClamp = false;
    this.sun.autoCalcDepthBounds = false;
    this.wrapComputeMatrices();
    this.unsubscribe = quality.subscribe(["shadowMapSize", "shadowCascades", "shadowFilter", "shadowFilterQuality", "farCascadeInterval", "lanternShadow", "lanternShadowMapSize"], (p) =>
      this.applyPreset(p),
    );
  }

  // ---------------------------------------------------------------------------
  // 캐스터 / 리시버 (청크 로드/해제와 연동)

  /** @returns 해제 함수 (청크 언로드 시 호출). 메시가 dispose되면 자동 해제 */
  addCaster(meshes: AbstractMesh | readonly AbstractMesh[], opts: CasterOptions = {}): () => void {
    const list = Array.isArray(meshes) ? meshes : [meshes as AbstractMesh];
    const sun = opts.sun ?? true;
    const lantern = opts.lantern ?? true;
    for (const m of list) {
      if (this.casters.has(m)) this.removeCaster(m);
      const obs = m.onDisposeObservable.addOnce(() => this.removeCaster(m));
      this.casters.set(m, { sun, lantern, obs });
      if (sun) this.sun.addShadowCaster(m, false);
      if (lantern) this.lanternGen?.addShadowCaster(m, false);
    }
    return () => {
      for (const m of list) this.removeCaster(m);
    };
  }

  removeCaster(m: AbstractMesh): void {
    const c = this.casters.get(m);
    if (!c) return;
    this.casters.delete(m);
    if (c.obs) m.onDisposeObservable.remove(c.obs);
    if (c.sun) this.sun.removeShadowCaster(m, false);
    if (c.lantern) this.lanternGen?.removeShadowCaster(m, false);
  }

  /** @returns 해제 함수 */
  addReceiver(meshes: AbstractMesh | readonly AbstractMesh[]): () => void {
    const list = Array.isArray(meshes) ? meshes : [meshes as AbstractMesh];
    for (const m of list) {
      m.receiveShadows = true;
      this.receivers.add(m);
      m.onDisposeObservable.addOnce(() => this.receivers.delete(m));
    }
    return () => {
      for (const m of list) {
        m.receiveShadows = false;
        this.receivers.delete(m);
      }
    };
  }

  get casterCount(): number {
    return this.casters.size;
  }

  // ---------------------------------------------------------------------------

  /** 렌더 직전 (매 프레임): 조정값 반영, 이번 프레임에 갱신할 캐스케이드 결정 */
  update(): void {
    const s = this.settings;
    const g = this.sun;
    g.bias = s.sunBias;
    g.normalBias = s.sunNormalBias;
    g.contactHardeningLightSizeUVRatio = s.pcssLightSize;
    g.cascadeBlendPercentage = s.cascadeBlend;
    g.lambda = s.lambda;
    g.shadowMaxZ = s.shadowMaxZ;
    g.darkness = s.darkness;
    if (this.lanternGen) {
      this.lanternGen.bias = s.lanternBias;
      this.lanternGen.normalBias = s.lanternNormalBias;
      this.lanternGen.darkness = s.lanternDarkness;
    }
    const interval = s.farIntervalOverride > 0 ? s.farIntervalOverride : this.preset.farCascadeInterval;
    cascadeUpdates(this.frame, g.numCascades, interval, 2, this.updateMask);
    this.frame++;
    this.stats.frames++;
    this.hookShadowMap();
  }

  /** 디버그 패널 한 줄 */
  describe(): string {
    const s = this.settings;
    const interval = s.farIntervalOverride > 0 ? s.farIntervalOverride : this.preset.farCascadeInterval;
    const lantern = this.lanternGen ? `등불 ${this.preset.lanternShadowMapSize}` : "등불 끔";
    const per = this.stats.perCascadeUpdate ? `원거리 1/${interval}` : "원거리 매프레임(대체)";
    return `${this.preset.level} ${this.sun.mapSize}×${this.sun.numCascades} ${this.preset.shadowFilter.toUpperCase()} ${per} bias ${s.sunBias.toFixed(4)}/${s.sunNormalBias.toFixed(3)} ${lantern} 캐스터 ${this.casters.size}`;
  }

  dispose(): void {
    this.unsubscribe();
    this.lanternGen?.dispose();
    this.sun.dispose();
  }

  // ---------------------------------------------------------------------------

  private applyPreset(p: Readonly<QualityPreset>): void {
    this.preset = p;
    const g = this.sun;
    if (g.numCascades !== p.shadowCascades) g.numCascades = p.shadowCascades;
    if (g.mapSize !== p.shadowMapSize) g.mapSize = p.shadowMapSize;
    g.filter = p.shadowFilter === "pcss" ? ShadowGenerator.FILTER_PCSS : ShadowGenerator.FILTER_PCF;
    g.filteringQuality = p.shadowFilterQuality === "high" ? ShadowGenerator.QUALITY_HIGH : p.shadowFilterQuality === "medium" ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
    // 캐스케이드 구성이 바뀌면 저장해 둔 행렬은 무효 — 다음 프레임은 전부 새로 계산/렌더
    this.snaps.length = 0;
    this.stats.cascadeRenders = new Array<number>(p.shadowCascades).fill(0);
    this.stats.cascadeSkips = new Array<number>(p.shadowCascades).fill(0);

    // 등불 그림자 (High 이상)
    if (p.lanternShadow) {
      if (!this.lanternGen || this.lanternGen.mapSize !== p.lanternShadowMapSize) {
        this.lanternGen?.dispose();
        const lg = new ShadowGenerator(p.lanternShadowMapSize, this.lanternLight);
        lg.usePoissonSampling = true;
        this.lanternGen = lg;
        for (const [m, c] of this.casters) if (c.lantern) lg.addShadowCaster(m, false);
      }
    } else if (this.lanternGen) {
      this.lanternGen.dispose();
      this.lanternGen = null;
    }
  }

  private isFrozen(layer: number): boolean {
    return this.stats.perCascadeUpdate && this.updateMask[layer] === false && this.snaps[layer] != null;
  }

  /** CSM 행렬 계산을 감싸 갱신하지 않는 캐스케이드는 직전 행렬을 유지 */
  private wrapComputeMatrices(): void {
    const g = this.sun as unknown as Partial<CsmInternals>;
    const ok =
      typeof g._computeMatrices === "function" &&
      Array.isArray(g._viewMatrices) &&
      Array.isArray(g._projectionMatrices) &&
      Array.isArray(g._transformMatrices) &&
      g._transformMatricesAsArray instanceof Float32Array &&
      Array.isArray(g._lightSizeUVCorrection) &&
      Array.isArray(g._depthCorrection) &&
      Array.isArray(g._cascadeMinExtents) &&
      Array.isArray(g._cascadeMaxExtents);
    if (!ok) {
      this.stats.perCascadeUpdate = false;
      console.warn("[render] CascadedShadowGenerator 내부 구조가 예상과 달라 원거리 캐스케이드도 매 프레임 갱신합니다 (Babylon 버전 확인)");
      return;
    }
    const csm = g as CsmInternals;
    const orig = csm._computeMatrices.bind(csm);
    csm._computeMatrices = () => {
      orig();
      const n = csm._numCascades;
      for (let i = 0; i < n; i++) {
        const snap = this.snaps[i];
        if (this.updateMask[i] === false && snap) this.restore(csm, i, snap);
        else this.snaps[i] = this.capture(csm, i, this.snaps[i] ?? null);
      }
    };
  }

  private capture(c: CsmInternals, i: number, into: CascadeSnapshot | null): CascadeSnapshot {
    const s = into ?? { view: new Float32Array(16), proj: new Float32Array(16), transform: new Float32Array(16), uvCorr: [0, 0], depthCorr: 0, min: [0, 0, 0], max: [0, 0, 0] };
    (c._viewMatrices[i] as Matrix).copyToArray(s.view);
    (c._projectionMatrices[i] as Matrix).copyToArray(s.proj);
    (c._transformMatrices[i] as Matrix).copyToArray(s.transform);
    s.uvCorr[0] = c._lightSizeUVCorrection[i * 2] ?? 0;
    s.uvCorr[1] = c._lightSizeUVCorrection[i * 2 + 1] ?? 0;
    s.depthCorr = c._depthCorrection[i] ?? 0;
    const mn = c._cascadeMinExtents[i] as Vector3;
    const mx = c._cascadeMaxExtents[i] as Vector3;
    s.min[0] = mn.x;
    s.min[1] = mn.y;
    s.min[2] = mn.z;
    s.max[0] = mx.x;
    s.max[1] = mx.y;
    s.max[2] = mx.z;
    return s;
  }

  private restore(c: CsmInternals, i: number, s: CascadeSnapshot): void {
    Matrix.FromArrayToRef(s.view, 0, c._viewMatrices[i] as Matrix);
    Matrix.FromArrayToRef(s.proj, 0, c._projectionMatrices[i] as Matrix);
    Matrix.FromArrayToRef(s.transform, 0, c._transformMatrices[i] as Matrix);
    c._transformMatricesAsArray.set(s.transform, i * 16);
    c._lightSizeUVCorrection[i * 2] = s.uvCorr[0];
    c._lightSizeUVCorrection[i * 2 + 1] = s.uvCorr[1];
    c._depthCorrection[i] = s.depthCorr;
    (c._cascadeMinExtents[i] as Vector3).set(s.min[0], s.min[1], s.min[2]);
    (c._cascadeMaxExtents[i] as Vector3).set(s.max[0], s.max[1], s.max[2]);
  }

  /** 그림자 맵(층 = 캐스케이드)에 갱신 건너뛰기 훅을 건다 — 맵이 다시 만들어지면 다시 건다 */
  private hookShadowMap(): void {
    const map = this.sun.getShadowMap();
    if (!map) return;
    const stillHooked = map === this.hookedMap && this.layerObserver && map.onBeforeRenderObservable.observers.includes(this.layerObserver);
    if (stillHooked || !this.stats.perCascadeUpdate) return;
    this.hookedMap = map;
    this.snaps.length = 0;
    this.layerObserver = map.onBeforeRenderObservable.add((layer) => {
      this.currentLayer = layer;
      const st = this.stats;
      if (this.isFrozen(layer)) st.cascadeSkips[layer] = (st.cascadeSkips[layer] ?? 0) + 1;
      else st.cascadeRenders[layer] = (st.cascadeRenders[layer] ?? 0) + 1;
    });
    // 지우기: 갱신하지 않는 층은 지우지 않아 직전 깊이를 유지 (옵저버가 있으면 기본 지우기 대신 이것만 불린다)
    map.onClearObservable.add((engine) => {
      if (!this.isFrozen(this.currentLayer)) engine.clear(map.clearColor ?? this.scene.clearColor, true, true, true);
    });
    // 그리기: 갱신하지 않는 층은 빈 목록
    const prev = map.getCustomRenderList;
    map.getCustomRenderList = (layer, renderList, len) => (this.isFrozen(layer) ? EMPTY : prev ? prev(layer, renderList, len) : null);
  }
}
