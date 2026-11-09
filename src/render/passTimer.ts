/**
 * 패스별 GPU 시간 (디버그 F5). 측정 자체에 비용이 있어 켰을 때만 동작한다.
 *
 *  - WebGPU: 렌더 타깃별 타임스탬프 쿼리 (Babylon이 렌더 패스마다 그 패스가 그리는 렌더 타깃의 카운터에 누적한다).
 *    후처리 패스 i의 시간 = 패스 i가 그려 넣는 다음 패스의 입력 텍스처 카운터 (마지막 패스는 화면 = 메인 패스 카운터).
 *    씬 = 첫 패스 입력(또는 프리패스 MRT), 그림자 = 태양/등불 그림자 맵 카운터. ("timestamp-query" 기능 필요)
 *  - WebGL2: EXT_disjoint_timer_query_webgl2 시간 쿼리를 패스 앞뒤에 (겹치면 안 되므로 순서대로, 결과는 몇 프레임 뒤 도착).
 *    프레임 전체 GPU 시간 측정(같은 종류의 쿼리)과 겹칠 수 없어 F5를 켜면 그것은 잠시 끈다.
 *  - 둘 다 없으면 (Firefox/Safari 등) "측정 불가".
 */
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { RenderTargetWrapper } from "@babylonjs/core/Engines/renderTargetWrapper";
import type { WebGPUPerfCounter } from "@babylonjs/core/Engines/WebGPU/webgpuPerfCounter";
import type { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import type { Effect } from "@babylonjs/core/Materials/effect";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery";
import "@babylonjs/core/Engines/Extensions/engine.query";
import { AverageMs } from "../ui/fpsMeter";
import type { FxPassGroup } from "./postfx/postFx";

/** WebGL2 시간 쿼리 (Babylon ThinEngine의 engine.query 확장 — 토큰 내부는 몰라도 된다) */
type TimeToken = object;
interface GlTimeQuery {
  startTimeQuery(): TimeToken | null;
  /** 끝내고 결과(ns)를 돌려준다, 아직 없으면 -1 (다시 부르면 결과만 확인) */
  endTimeQuery(token: TimeToken): number;
}

interface GlTimer {
  token: TimeToken | null;
  pending: boolean;
}

interface Hooked {
  label: string;
  before: Observer<Effect>;
  after: Observer<Effect>;
  timer: GlTimer;
}

export interface PassTimerSources {
  /** 지금 붙어 있는 후처리 효과별 패스 (정해진 순서) */
  groups(): FxPassGroup[];
  /** 그림자 맵 (라벨, 렌더 타깃) */
  shadowMaps(): { label: string; map: RenderTargetTexture | null }[];
  /** 프리패스 MRT (없으면 null) */
  prePassTarget(): RenderTargetWrapper | null;
  /** 프레임 전체 GPU 시간 측정 켜기/끄기 (WebGL2에서 쿼리가 겹치지 않게) */
  setFrameCapture(on: boolean): void;
  /** 프레임 전체 GPU 시간 (ms, 모르면 null) — 패스 합계와의 차이(기타)를 보여 준다 */
  frameGpuMs(): number | null;
}

const NS_TO_MS = 1e-6;

export class PassTimer {
  private on = false;
  private readonly avgs = new Map<string, AverageMs>();
  private readonly order: string[] = [];
  private readonly webgpu: boolean;
  private readonly hasGlTimer: boolean;
  private readonly gl: GlTimeQuery | null;
  /** WebGL2: 후처리 패스 훅 */
  private readonly hooked = new Map<PostProcess, Hooked>();
  private sceneObs: Observer<Scene>[] = [];
  private readonly sceneTimers = new Map<string, GlTimer>();

  constructor(
    private readonly engine: AbstractEngine,
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly src: PassTimerSources,
  ) {
    this.webgpu = engine.isWebGPU;
    this.hasGlTimer = !this.webgpu && !!engine.getCaps().timerQuery;
    this.gl = this.hasGlTimer ? (engine as unknown as GlTimeQuery) : null;
  }

  get enabled(): boolean {
    return this.on;
  }

  get supported(): boolean {
    return this.webgpu || this.hasGlTimer;
  }

  toggle(): void {
    this.setEnabled(!this.on);
  }

  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.avgs.clear();
    this.order.length = 0;
    if (!this.webgpu) {
      this.src.setFrameCapture(!on);
      if (on && this.hasGlTimer) this.installSceneHooks();
      else this.uninstallAll();
    }
  }

  /** 렌더 프레임마다 (scene.render 뒤) */
  update(): void {
    if (!this.on || !this.supported) return;
    if (this.webgpu) this.readWebGpu();
    else this.syncGlHooks();
  }

  /** 디버그 패널 줄들 (켜져 있을 때만) */
  lines(): string[] {
    if (!this.on) return [];
    if (!this.supported) return ["GPU 패스 (F5)  측정 불가 — 이 브라우저는 GPU 타이머를 지원하지 않습니다"];
    const items = this.order.map((l) => [l, this.avgs.get(l)?.ms ?? 0] as const);
    const total = items.reduce((s, [, v]) => s + v, 0);
    const parts = items.map(([l, v]) => `${l} ${v.toFixed(2)}`);
    const frame = this.src.frameGpuMs();
    // 패스로 잡히지 않는 GPU 작업(밉맵 생성, 복사 등)이나 타이머 한계(타일 방식 GPU)로 생기는 차이
    const other = frame !== null ? `  프레임 GPU ${frame.toFixed(2)} · 기타 ${Math.max(0, frame - total).toFixed(2)}` : "";
    const rows: string[] = [`GPU 패스 (F5, ms)  합계 ${total.toFixed(2)}${other}${items.length === 0 ? "  측정 중…" : ""}`];
    for (let i = 0; i < parts.length; i += 4) rows.push(`  ${parts.slice(i, i + 4).join(" · ")}`);
    return rows;
  }

  dispose(): void {
    this.uninstallAll();
  }

  // ---------------------------------------------------------------------------

  private record(label: string, ms: number): void {
    let a = this.avgs.get(label);
    if (!a) {
      a = new AverageMs(0.1);
      this.avgs.set(label, a);
    }
    if (!this.order.includes(label)) this.order.push(label);
    a.add(ms);
  }

  // --- WebGPU ------------------------------------------------------------------

  private readWebGpu(): void {
    const counter = (w: RenderTargetWrapper | null | undefined): number => {
      const c = (w as unknown as { gpuTimeInFrame?: WebGPUPerfCounter } | null | undefined)?.gpuTimeInFrame;
      return c ? c.counter.current * NS_TO_MS : 0;
    };
    for (const { label, map } of this.src.shadowMaps()) if (map) this.record(label, counter(map.renderTarget));
    const list = this.camera._postProcesses.filter((p): p is PostProcess => p !== null);
    const first = list[0];
    this.record("씬", counter(this.src.prePassTarget()) + counter(first?.inputTexture));
    const mainPass = (this.engine as unknown as { gpuTimeInFrameForMainPass?: WebGPUPerfCounter }).gpuTimeInFrameForMainPass;
    for (const g of this.src.groups()) {
      let ms = 0;
      for (const pp of g.passes) {
        const i = list.indexOf(pp);
        if (i < 0) continue;
        const next = list[i + 1];
        ms += next ? counter(next.inputTexture) : mainPass ? mainPass.counter.current * NS_TO_MS : 0;
      }
      this.record(g.label, ms);
    }
  }

  // --- WebGL2 ------------------------------------------------------------------

  private begin(t: GlTimer): void {
    if (t.pending) return; // 직전 결과를 아직 못 받았으면 이번 프레임은 건너뛴다
    t.token = this.gl?.startTimeQuery() ?? null;
  }

  private end(t: GlTimer): void {
    if (t.pending || !t.token) return;
    this.gl?.endTimeQuery(t.token); // 쿼리 종료 (결과는 나중에)
    t.pending = true;
  }

  private poll(label: string, t: GlTimer): void {
    if (!t.pending || !t.token) return;
    const ns = this.gl?.endTimeQuery(t.token) ?? -1;
    if (ns >= 0) {
      t.pending = false;
      this.record(label, ns * NS_TO_MS);
    }
  }

  private installSceneHooks(): void {
    const timer = (label: string): GlTimer => {
      let t = this.sceneTimers.get(label);
      if (!t) {
        t = { token: null, pending: false };
        this.sceneTimers.set(label, t);
      }
      return t;
    };
    const rt = timer("그림자·RT");
    const draw = timer("씬");
    const s = this.scene;
    this.sceneObs = [
      s.onBeforeRenderTargetsRenderObservable.add(() => {
        this.poll("그림자·RT", rt);
        this.begin(rt);
      }),
      s.onAfterRenderTargetsRenderObservable.add(() => this.end(rt)),
      s.onBeforeDrawPhaseObservable.add(() => {
        this.poll("씬", draw);
        this.begin(draw);
      }),
      s.onAfterDrawPhaseObservable.add(() => this.end(draw)),
    ];
  }

  /** 후처리 패스 목록이 바뀌었으면 훅을 다시 건다 */
  private syncGlHooks(): void {
    if (!this.hasGlTimer) return;
    const want = new Map<PostProcess, string>();
    for (const g of this.src.groups()) for (const pp of g.passes) want.set(pp, g.label);
    for (const [pp, h] of this.hooked) {
      if (want.get(pp) !== h.label) {
        pp.onApplyObservable.remove(h.before );
        pp.onAfterRenderObservable.remove(h.after );
        this.hooked.delete(pp);
      }
    }
    // 같은 효과의 여러 패스는 패스별 쿼리로 재고 라벨로 합산
    const perLabel = new Map<string, number>();
    for (const [pp, label] of want) {
      if (this.hooked.has(pp)) continue;
      const timer: GlTimer = { token: null, pending: false };
      const key = `${label}#${(perLabel.get(label) ?? 0) + 1}`;
      perLabel.set(label, (perLabel.get(label) ?? 0) + 1);
      const before = pp.onApplyObservable.add(() => {
        this.pollInto(label, key, timer);
        this.begin(timer);
      });
      const after = pp.onAfterRenderObservable.add(() => this.end(timer));
      this.hooked.set(pp, { label, before, after, timer });
    }
  }

  /** 효과(라벨) 단위 합산: 패스별 최신값을 모아 라벨 평균에 넣는다 */
  private readonly latest = new Map<string, Map<string, number>>();

  private pollInto(label: string, key: string, t: GlTimer): void {
    if (!t.pending || !t.token) return;
    const ns = this.gl?.endTimeQuery(t.token) ?? -1;
    if (ns < 0) return;
    t.pending = false;
    let m = this.latest.get(label);
    if (!m) {
      m = new Map();
      this.latest.set(label, m);
    }
    m.set(key, ns * NS_TO_MS);
    let sum = 0;
    for (const v of m.values()) sum += v;
    this.record(label, sum);
  }

  private uninstallAll(): void {
    for (const o of this.sceneObs) o.remove();
    this.sceneObs = [];
    this.sceneTimers.clear();
    for (const [pp, h] of this.hooked) {
      pp.onApplyObservable.remove(h.before );
      pp.onAfterRenderObservable.remove(h.after );
    }
    this.hooked.clear();
    this.latest.clear();
  }
}
