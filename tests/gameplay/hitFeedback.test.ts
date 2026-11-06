import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../src/core/eventBus";
import { CameraShake } from "../../src/gameplay/camera/shake";
import { HITSTOP_FRAME_SECONDS, createFeelSettings, type FeelSettings } from "../../src/gameplay/feel/feelSettings";
import { HitFeedback } from "../../src/gameplay/feel/hitFeedback";
import { CharacterView, ViewMaterials } from "../../src/gameplay/player/characterView";
import { createEntity, type Entity } from "../../src/sim/entity";
import type { GameEventMap, HitEvent } from "../../src/sim/events";

let engine: NullEngine;
let scene: Scene;
let events: EventBus<GameEventMap>;
let shake: CameraShake;
let settings: FeelSettings;
let hero: Entity;
let dummy: Entity;
let views: Map<number, CharacterView>;
let feedback: HitFeedback;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  events = new EventBus<GameEventMap>();
  shake = new CameraShake();
  settings = createFeelSettings();
  hero = createEntity(1, "player", "player", { x: 0, y: 0, z: 0 }, 0);
  dummy = createEntity(2, "training_dummy", "enemy", { x: 0, y: 0, z: 1.5 }, Math.PI);
  const mats = new ViewMaterials(scene);
  views = new Map([
    [1, new CharacterView(scene, mats, hero)],
    [2, new CharacterView(scene, mats, dummy)],
  ]);
  feedback = new HitFeedback({ scene, events, viewOf: (id) => views.get(id), shake, heroId: 1 }, settings);
});
afterEach(() => engine.dispose());

const hit = (o: Partial<HitEvent> = {}): HitEvent => ({
  attacker: 1,
  target: 2,
  attack: "attack_light_1",
  damage: 22,
  point: { x: 0, y: 1.2, z: 1.1 },
  backAttack: false,
  hitstopFrames: 3,
  knockback: { x: 0, y: 0, z: 1.5 },
  staggered: false,
  killed: false,
  ...o,
});

function emitHit(o: Partial<HitEvent> = {}): void {
  events.enqueue("hit", hit(o));
  events.flush();
}

/** 렌더 n프레임 (sim은 매 프레임 진행했다고 가정해 엔티티를 앞으로 옮긴다) */
function render(n: number, move = 0): void {
  for (let i = 0; i < n; i++) {
    for (const e of [hero, dummy]) {
      views.get(e.id)?.capturePrevious(e);
      e.position.z += move;
    }
    for (const e of [hero, dummy]) views.get(e.id)?.sync(e, 1, "idle", null, 0, HITSTOP_FRAME_SECONDS);
    feedback.update(HITSTOP_FRAME_SECONDS);
  }
}

describe("히트스톱 (렌더 로컬)", () => {
  it("공격자와 피격자 표시가 히트스톱 프레임 동안 멈추고, sim이 진행한 만큼 따라잡는다", () => {
    render(1);
    emitHit({ hitstopFrames: 3 });
    const v = views.get(2);
    if (!v) throw new Error("view");
    const z0 = v.display.position.z;
    render(2, 0.05); // sim은 계속 진행
    expect(v.display.position.z).toBe(z0); // 표시는 멈춤
    expect(views.get(1)?.hitstop.isFrozen).toBe(true);
    render(12, 0);
    expect(v.display.position.z).toBeCloseTo(dummy.position.z, 9); // 따라잡음
  });

  it("히트스톱 동안 무기 휘두름도 멈춘다 (무기 자세 시간이 진행돼도)", () => {
    const v = views.get(1);
    if (!v) throw new Error("view");
    const inst = { id: 1, attackerId: 1, attack: "attack_light_1" as const, startTick: 0, active: true, hitList: new Set<number>() };
    let tick = 11;
    const frame = () => {
      v.capturePrevious(hero);
      v.sync(hero, 1, "attackLight", inst, (tick += 1), HITSTOP_FRAME_SECONDS);
    };
    frame();
    emitHit({ attacker: 1, target: 2, hitstopFrames: 4 });
    frame();
    const frozen = v.weapon.position.clone();
    frame();
    frame();
    expect(v.weapon.position.equals(frozen)).toBe(true);
    for (let i = 0; i < 10; i++) frame();
    expect(v.weapon.position.equals(frozen)).toBe(false);
  });

  it("밀림은 정지가 풀린 뒤에 시작한다 (멈췄다가 튕겨 나가는 느낌)", () => {
    render(1);
    emitHit({ hitstopFrames: 4, knockback: { x: 0, y: 0, z: 1.5 } });
    const v = views.get(2);
    if (!v) throw new Error("view");
    render(3);
    expect(v.body.position.z).toBeCloseTo(v.display.position.z, 9); // 정지 중: 밀림 없음
    render(4);
    expect(v.body.position.z).toBeGreaterThan(v.display.position.z + 1e-4);
  });

  it("관련 없는 엔티티는 멈추지 않는다", () => {
    emitHit({ attacker: 2, target: 2 });
    expect(views.get(1)?.hitstop.isFrozen).toBe(false);
  });

  it("배율 0 또는 꺼짐이면 멈추지 않는다", () => {
    settings.hitstop.enabled = false;
    emitHit();
    expect(views.get(2)?.hitstop.isFrozen).toBe(false);
  });
});

describe("카메라 셰이크", () => {
  it("약공은 약하게, 강공(4프레임)/백어택/경직은 강하게", () => {
    emitHit({ hitstopFrames: 3 });
    const light = shake.intensity();
    shake.clear();
    emitHit({ hitstopFrames: 4 });
    const heavy = shake.intensity();
    shake.clear();
    emitHit({ backAttack: true });
    const back = shake.intensity();
    expect(light).toBeCloseTo(settings.shake.light.amplitude, 9);
    expect(heavy).toBeCloseTo(settings.shake.heavy.amplitude, 9);
    expect(back).toBeCloseTo(settings.shake.heavy.amplitude, 9);
    expect(heavy).toBeGreaterThan(light);
  });

  it("플레이어가 관련 없는 타격은 기본적으로 흔들지 않는다", () => {
    emitHit({ attacker: 2, target: 3 });
    expect(shake.activeCount).toBe(0);
    settings.shake.shakeOnOthers = true;
    emitHit({ attacker: 2, target: 3 });
    expect(shake.activeCount).toBe(1);
  });
});

describe("피격 리액션과 스파크", () => {
  it("피격자가 맞은 방향으로 밀렸다 돌아오고, 흰색 플래시가 났다 사라진다", () => {
    settings.hitstop.enabled = false;
    render(1);
    emitHit({ knockback: { x: 0, y: 0, z: 1.5 } });
    const v = views.get(2);
    if (!v) throw new Error("view");
    render(3);
    expect(v.body.position.z).toBeGreaterThan(dummy.position.z); // +Z로 밀림
    expect(v.body.renderOverlay).toBe(true);
    render(30);
    expect(v.body.position.z).toBeCloseTo(dummy.position.z, 9);
    expect(v.body.renderOverlay).toBe(false);
  });

  it("타격 지점에서 스파크가 나고 수명이 지나면 사라진다", () => {
    emitHit();
    expect(feedback.hitSparks.sim.alive).toBe(settings.sparks.hitCount);
    render(60);
    expect(feedback.hitSparks.sim.alive).toBe(0);
  });

  it("가드/튕김/패리도 연출을 낸다", () => {
    events.enqueue("guard", { attacker: 2, target: 1, attack: "hollow_slash", chipDamage: 2, staminaDamage: 20, broken: false, point: { x: 0, y: 1, z: 0.5 }, hitstopFrames: 3, knockback: { x: 0, y: 0, z: -1 } });
    events.enqueue("weapon_bounce", { attacker: 1, attack: "attack_light_1", instance: 1, point: { x: 1, y: 1, z: 0 }, normal: { x: -1, y: 0, z: 0 } });
    events.enqueue("parry", { parrier: 1, attacker: 2, attack: "hollow_slash", point: { x: 0, y: 1, z: 0.5 } });
    events.flush();
    expect(feedback.guardSparks.sim.alive).toBeGreaterThan(0);
    expect(shake.activeCount).toBe(3);
    expect(views.get(1)?.hitstop.isFrozen).toBe(true);
  });
});
