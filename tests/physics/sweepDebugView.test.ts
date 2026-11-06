import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Observable } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HavokHitQuery, SweepRecord } from "../../src/physics/combat/havokHitQuery";
import { SWEEP_TRAIL_SECONDS, SweepDebugView } from "../../src/physics/combat/sweepDebugView";
import { vec3 } from "../../src/sim/math/vec3";

let engine: NullEngine;
let scene: Scene;
let clock = 0;
const onSweep = new Observable<SweepRecord>();
const fakeQuery = { onSweep } as unknown as HavokHitQuery;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  clock = 1000;
});
afterEach(() => {
  onSweep.clear();
  engine.dispose();
});

const record = (): SweepRecord => ({
  team: "player",
  poses: [
    { hilt: vec3(0, 1, 0), tip: vec3(1, 1, 0) },
    { hilt: vec3(0, 1, 0), tip: vec3(0.7, 1, 0.7) },
    { hilt: vec3(0, 1, 0), tip: vec3(0, 1, 1) },
  ],
  hits: [vec3(0.5, 1, 0.5)],
  block: vec3(0, 1, 1),
});

describe("스윕 궤적 디버그 표시", () => {
  it("켜져 있을 때만 기록을 구독하고, 꺼지면 구독을 끊는다", () => {
    const view = new SweepDebugView(scene, fakeQuery, () => clock);
    expect(onSweep.hasObservers()).toBe(false);
    view.setEnabled(true);
    expect(onSweep.hasObservers()).toBe(true);
    view.setEnabled(false);
    expect(onSweep.hasObservers()).toBe(false);
  });

  it("칼날/경로/십자 선을 그리고 0.5초가 지나면 사라진다", () => {
    const view = new SweepDebugView(scene, fakeQuery, () => clock);
    view.setEnabled(true);
    onSweep.notifyObservers(record());
    view.update();
    // 칼날 3 + (손잡이·칼끝 경로 2) × 2 + 맞은 십자 3 + 막힘 십자 3
    expect(view.liveLineCount).toBe(3 + 4 + 3 + 3);
    expect(scene.getMeshByName("sweepTrail")).not.toBeNull();
    clock += SWEEP_TRAIL_SECONDS * 1000 * 0.9;
    view.update();
    expect(view.liveLineCount).toBe(13);
    clock += SWEEP_TRAIL_SECONDS * 1000 * 0.2;
    view.update();
    expect(view.liveLineCount).toBe(0);
  });

  it("끄면 선 메시를 지운다", () => {
    const view = new SweepDebugView(scene, fakeQuery, () => clock);
    view.setEnabled(true);
    onSweep.notifyObservers(record());
    view.update();
    view.setEnabled(false);
    expect(scene.getMeshByName("sweepTrail")).toBeNull();
    expect(view.liveLineCount).toBe(0);
  });

  it("용량을 넘으면 오래된 선부터 덮어쓴다 (메시를 새로 만들지 않음)", () => {
    const view = new SweepDebugView(scene, fakeQuery, () => clock);
    view.setEnabled(true);
    for (let i = 0; i < 200; i++) onSweep.notifyObservers(record());
    view.update();
    const mesh = scene.getMeshByName("sweepTrail");
    expect(view.liveLineCount).toBe(768);
    onSweep.notifyObservers(record());
    view.update();
    expect(scene.getMeshByName("sweepTrail")).toBe(mesh);
    expect(scene.meshes.filter((m) => m.name === "sweepTrail").length).toBe(1);
  });
});
