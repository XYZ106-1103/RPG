#!/usr/bin/env node
// @ts-check
/**
 * 애니메이션 이벤트 추정 파일 생성: src/anim/events/<이름>.json (CLAUDE.md "애니메이션 이벤트").
 *
 * 사용:
 *   node tools/gen_anim_events.mjs --name hero [--glb public/assets/characters/hero.glb] [--meta raw/animations/hero] [--force]
 *   node tools/gen_anim_events.mjs --name hero --table      현재 이벤트 파일을 조정용 표로 출력
 *
 * 길이: GLB 애니메이션 길이(초) × 30fps. 이벤트는 길이 비율로 추정하고 "note"에 "추정값 (NN%)"을 단다.
 *  - 공격: hit_start 35%, hit_end 55%, input_buffer_start 40%, cancel_window 70%, sfx:swing (hit_start 2프레임 전)
 *  - 구르기/백스텝: iframe_start 10%, iframe_end 45%, cancel_window 85%, sfx:roll (0프레임)
 *  - 루트 모션(rootMotion): animations.json에 distance가 있는 구르기/백스텝/달리기 공격 — 10%~80% 구간, smooth 곡선,
 *    거리 = distance × --scale (모델 키를 바꿨으면 키 배율)
 *  - 이동: sfx:step_l / sfx:step_r — animations.json의 접지 프레임(contacts)이 있으면 그 값
 *  - 피격/사망/회복 등: sfx 자리 (animations.json에 같은 의미의 이벤트가 있으면 그 프레임)
 * animations.json의 작성자 값(hit, invulnerable 등)은 "source"에 남겨 표에서 비교한다.
 * 이미 파일이 있으면 --force 없이는 덮어쓰지 않는다 (사용자가 조정한 값 보호).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

const FPS = 30;
const ATTACKS = ["attack_light_1", "attack_light_2", "attack_light_3", "attack_heavy", "attack_run"];
const EVADES = ["roll_f", "roll_b", "backstep"];
const LOCOMOTION = ["walk_f", "walk_b", "walk_l", "walk_r", "run_f", "sprint"];
/** 피격/사망 등의 sfx 자리: [이벤트 이름, animations.json에서 같은 의미의 키] */
const SFX_SLOTS = /** @type {Record<string, [string, string | null]>} */ ({
  hit_front: ["sfx:hit", null],
  hit_back: ["sfx:hit", null],
  stagger: ["sfx:stagger", null],
  parry: ["sfx:parry", null],
  death: ["sfx:body_fall", "down"],
  drink: ["sfx:drink", "drink"],
  guard: ["sfx:guard_impact", "impact"],
});

/**
 * @typedef {{ frame: number, name: string, note: string }} EventEntry
 * @typedef {{ start: number, end: number, distance: number, curve: string, note: string }} RootMotionEntry
 * @typedef {{ length: number, loop: boolean, source?: Record<string, unknown>, events: EventEntry[], rootMotion?: RootMotionEntry }} AnimEntry
 * @typedef {{ _설명: string, character: string, fps: number, animations: Record<string, AnimEntry> }} EventsFile
 */

/** GLB JSON 청크에서 애니메이션 이름/길이(초) */
export function glbAnimationDurations(/** @type {Buffer} */ buf) {
  if (buf.toString("latin1", 0, 4) !== "glTF") throw new Error("GLB가 아닙니다.");
  const len = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.toString("utf8", 20, 20 + len));
  /** @type {Record<string, number>} */
  const out = {};
  for (const a of gltf.animations ?? []) {
    let end = 0;
    for (const s of a.samplers) end = Math.max(end, gltf.accessors[s.input].max?.[0] ?? 0);
    out[a.name] = end;
  }
  return out;
}

/** @param {number} length @param {number} ratio */
const at = (length, ratio) => Math.round(length * ratio);
/** @param {number} frame @param {number} length */
const pct = (frame, length) => `${Math.round((frame / length) * 100)}%`;
/** @param {number} frame @param {string} name @param {number} length @param {string} [why] */
const est = (frame, name, length, why) => ({ frame, name, note: `추정값 (${pct(frame, length)})${why ? ` — ${why}` : ""}` });

/**
 * 애니메이션 하나의 추정 이벤트
 * @param {string} name 이름 규칙
 * @param {number} length 프레임
 * @param {Record<string, unknown>} meta animations.json 항목 (없으면 {})
 * @returns {EventEntry[]}
 */
export function estimateEvents(name, length, meta) {
  const ev = /** @type {Record<string, unknown>} */ (meta.events ?? {});
  if (ATTACKS.includes(name)) {
    const hs = Math.max(1, at(length, 0.35));
    const he = Math.max(hs + 1, at(length, 0.55));
    return [
      est(Math.max(0, hs - 2), "sfx:swing", length, "휘두름 소리, hit_start 2프레임 전"),
      est(hs, "hit_start", length),
      est(at(length, 0.4), "input_buffer_start", length),
      est(he, "hit_end", length),
      est(at(length, 0.7), "cancel_window", length),
    ].sort((a, b) => a.frame - b.frame);
  }
  if (EVADES.includes(name)) {
    const is = Math.max(1, at(length, 0.1));
    return [
      est(0, "sfx:roll", length, "구르기 시작 소리 자리"),
      est(is, "iframe_start", length),
      est(Math.max(is + 1, at(length, 0.45)), "iframe_end", length),
      est(at(length, 0.85), "cancel_window", length, "75%면 일어나기 전에 끊긴다"),
    ];
  }
  if (LOCOMOTION.includes(name)) {
    const contacts = /** @type {Record<string, number> | undefined} */ (meta.contacts);
    if (contacts && typeof contacts.L === "number" && typeof contacts.R === "number") {
      return [
        { frame: contacts.L, name: "sfx:step_l", note: `animations.json 접지 프레임 (${pct(contacts.L, length)})` },
        { frame: contacts.R, name: "sfx:step_r", note: `animations.json 접지 프레임 (${pct(contacts.R, length)})` },
      ].sort((a, b) => a.frame - b.frame);
    }
    return [est(0, "sfx:step_l", length, "발소리 자리"), est(at(length, 0.5), "sfx:step_r", length, "발소리 자리")];
  }
  const slot = SFX_SLOTS[name];
  if (slot) {
    const [sfx, key] = slot;
    const src = key ? ev[key] : undefined;
    const frame = typeof src === "number" ? src : Array.isArray(src) && typeof src[0] === "number" ? src[0] : 0;
    return [{ frame, name: sfx, note: key && src !== undefined ? `animations.json '${key}' 프레임 (${pct(frame, length)})` : `추정값 (${pct(frame, length)}) — 소리 자리` }];
  }
  return [];
}

/**
 * @param {Record<string, number>} durations GLB 애니메이션 이름 → 초
 * @param {Record<string, Record<string, unknown>>} meta animations.json (원본 이름 기준)
 * @param {Record<string, string | null>} mapping 원본 이름 → 이름 규칙
 * @param {string} character
 * @param {number} [scale] animations.json distance에 곱할 배율 (모델 키를 바꿨을 때)
 * @returns {EventsFile}
 */
export function buildEventsFile(durations, meta, mapping, character, scale = 1) {
  /** 이름 규칙 → animations.json 항목 */
  /** @type {Record<string, Record<string, unknown>>} */
  const metaByRule = {};
  for (const [src, m] of Object.entries(meta)) {
    const rule = mapping[src] ?? src;
    if (rule) metaByRule[rule] = m;
  }
  /** @type {Record<string, AnimEntry>} */
  const animations = {};
  for (const name of Object.keys(durations).sort()) {
    const length = Math.round((durations[name] ?? 0) * FPS);
    const m = metaByRule[name] ?? {};
    /** @type {AnimEntry} */
    const entry = { length, loop: m.loop === true || LOCOMOTION.includes(name) || name === "idle", events: estimateEvents(name, length, m) };
    if (typeof m.distance === "number" && (EVADES.includes(name) || name === "attack_run")) {
      entry.rootMotion = {
        start: at(length, 0.1),
        end: at(length, 0.8),
        distance: Math.round(m.distance * scale * 100) / 100,
        curve: "smooth",
        note: `추정값 (10%~80%) — animations.json distance ${m.distance}m × ${scale}`,
      };
    }
    if (m.events || m.distance !== undefined) entry.source = { ...(m.events ? { events: m.events } : {}), ...(m.distance !== undefined ? { distance: m.distance } : {}) };
    animations[name] = entry;
  }
  return {
    _설명: `${character}의 애니메이션 이벤트 (30fps 프레임). "추정값"은 길이 비율로 넣은 값이라 테스트하며 조정한다. source는 animations.json 작성자 값(비교용).`,
    character,
    fps: FPS,
    animations,
  };
}

/** 조정용 표 (마크다운) */
export function formatTable(/** @type {EventsFile} */ file) {
  const lines = ["| 애니메이션 | 길이(f) | 이벤트 | 프레임 | 비율 | 메모 |", "|---|---|---|---|---|---|"];
  for (const [name, a] of Object.entries(file.animations)) {
    if (!a.events.length) {
      lines.push(`| ${name} | ${a.length} | — | | | ${a.loop ? "루프" : ""} |`);
      continue;
    }
    a.events.forEach((e, i) => {
      lines.push(`| ${i === 0 ? name : ""} | ${i === 0 ? a.length : ""} | \`${e.name}\` | ${e.frame} | ${pct(e.frame, a.length)} | ${e.note.replace(/^추정값 \(\d+%\)(?: — )?/, "추정값 ").trim()} |`);
    });
    if (a.rootMotion) lines.push(`| | | \`rootMotion\` | ${a.rootMotion.start}→${a.rootMotion.end} | ${pct(a.rootMotion.start, a.length)}→${pct(a.rootMotion.end, a.length)} | ${a.rootMotion.distance}m ${a.rootMotion.curve} |`);
    if (a.source?.events) lines.push(`| | | _작성자 값_ | | | \`${JSON.stringify(a.source.events)}\` |`);
  }
  return lines.join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      glb: { type: "string" },
      meta: { type: "string" },
      scale: { type: "string" },
      force: { type: "boolean", default: false },
      table: { type: "boolean", default: false },
    },
  });
  const name = values.name;
  if (!name || !/^[a-z0-9_]+$/i.test(name)) {
    console.error("사용: node tools/gen_anim_events.mjs --name <캐릭터> [--glb ...] [--meta raw/animations/<캐릭터>] [--force] [--table]");
    process.exit(2);
  }
  const out = join("src/anim/events", `${name}.json`);
  if (values.table) {
    console.log(formatTable(JSON.parse(await readFile(out, "utf8"))));
    return;
  }
  if (existsSync(out) && !values.force) {
    console.error(`✗ ${out}가 이미 있습니다 (조정한 값 보호). 다시 만들려면 --force`);
    process.exit(1);
  }
  const glb = values.glb ?? `public/assets/characters/${name}.glb`;
  const metaDir = values.meta ?? `raw/animations/${name}`;
  const durations = glbAnimationDurations(await readFile(glb));
  const metaPath = join(metaDir, "animations.json");
  const mapPath = join(metaDir, "mapping.json");
  const meta = existsSync(metaPath) ? JSON.parse(await readFile(metaPath, "utf8")) : {};
  const mapping = existsSync(mapPath) ? JSON.parse(await readFile(mapPath, "utf8")) : {};
  const scale = values.scale ? Number(values.scale) : 1;
  if (!(scale > 0)) throw new Error(`--scale이 올바르지 않습니다: ${values.scale}`);
  const file = buildEventsFile(durations, meta, mapping, name, scale);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(file, null, 2) + "\n");
  console.log(`✓ ${out}  (애니메이션 ${Object.keys(file.animations).length}개)\n`);
  console.log(formatTable(file));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) await main();
