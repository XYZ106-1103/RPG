/**
 * 성능 측정 (디버그 패널용): CPU 시간(sim / 렌더 제출), GPU 프레임 시간, 드로콜.
 *  - GPU 시간: WebGL2는 EXT_disjoint_timer_query_webgl2, WebGPU는 timestamp-query 기능이 있어야 측정된다.
 *    없으면 "GPU 측정 불가"로 표시한다 (브라우저/드라이버가 막는 경우가 있다).
 *  - CPU 렌더 시간이 프레임 시간에 가깝다면 CPU 병목, GPU 시간이 크면 GPU 병목.
 */
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { EngineInstrumentation } from "@babylonjs/core/Instrumentation/engineInstrumentation";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import type { Scene } from "@babylonjs/core/scene";
// GPU 시간 측정 확장 (WebGL2 / WebGPU) — 엔진에 captureGPUFrameTime을 붙인다
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery";
import "@babylonjs/core/Engines/Extensions/engine.query";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.query";
import { AverageMs } from "../ui/fpsMeter";

export class PerfProbe {
  readonly sim = new AverageMs();
  readonly render = new AverageMs();
  private readonly engineInst: EngineInstrumentation;
  private readonly sceneInst: SceneInstrumentation;
  private simAccum = 0;

  constructor(engine: AbstractEngine, scene: Scene) {
    this.engineInst = new EngineInstrumentation(engine);
    try {
      this.engineInst.captureGPUFrameTime = true;
    } catch (err) {
      console.warn("[perf] GPU 시간 측정을 켤 수 없습니다", err);
    }
    this.sceneInst = new SceneInstrumentation(scene);
  }

  /** 프레임 전체 GPU 시간 측정 켜기/끄기 (WebGL2에서 패스별 측정(F5)과 쿼리가 겹치지 않게) */
  setFrameCapture(on: boolean): void {
    try {
      this.engineInst.captureGPUFrameTime = on;
    } catch {
      // 확장이 없으면 무시
    }
  }

  /** 고정 스텝 한 번의 시간 (한 프레임에 여러 번 돌 수 있어 합산) */
  addSim(ms: number): void {
    this.simAccum += ms;
  }

  /** 렌더 프레임 끝: 이번 프레임 렌더 제출 시간 기록, sim 합산값 확정 */
  endFrame(renderMs: number): void {
    this.render.add(renderMs);
    this.sim.add(this.simAccum);
    this.simAccum = 0;
  }

  /** GPU 프레임 시간 (ms), 측정 불가면 null */
  get gpuMs(): number | null {
    const c = this.engineInst.gpuFrameTimeCounter;
    return c.count > 0 && c.lastSecAverage > 0 ? c.lastSecAverage * 1e-6 : null;
  }

  /** 직전 프레임 드로콜 수 */
  get drawCalls(): number {
    return this.sceneInst.drawCallsCounter.current;
  }

  describe(): string {
    const gpu = this.gpuMs;
    return `CPU sim ${this.sim.ms.toFixed(1)}ms 렌더 ${this.render.ms.toFixed(1)}ms  GPU ${gpu === null ? "측정 불가" : `${gpu.toFixed(1)}ms`}  드로콜 ${this.drawCalls}`;
  }

  dispose(): void {
    this.engineInst.dispose();
    this.sceneInst.dispose();
  }
}
