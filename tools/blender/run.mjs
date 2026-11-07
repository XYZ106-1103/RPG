#!/usr/bin/env node
// @ts-check
/**
 * 블렌더 스크립트 실행기 (윈도우/맥/리눅스). 블렌더를 찾아 헤드리스(-b)로 스크립트를 돌린다.
 *
 * 사용:
 *   node tools/blender/run.mjs cleanup  -- --input raw/models/x/x.glb --type prop --out raw/models/x/x_clean.glb
 *   node tools/blender/run.mjs merge    -- --character raw/models/x/x_rigged.fbx --anims raw/animations/x --out raw/models/x/x.glb --root-motion
 *   node tools/blender/run.mjs selftest
 *
 * 블렌더 찾는 순서: 환경 변수 BLENDER → PATH의 blender → 기본 설치 위치 (여러 개면 가장 높은 버전)
 * 블렌더가 없으면 설치 안내를 출력하고 종료 코드 2.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = /** @type {const} */ ({ cleanup: "cleanup_model.py", merge: "merge_animations.py", selftest: "selftest.py" });
const MIN_VERSION = [4, 2];
const here = dirname(fileURLToPath(import.meta.url));

/** @param {string} dir @param {RegExp} re @returns {string[]} */
function listDirs(dir, re) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && re.test(d.name))
      .map((d) => join(dir, d.name));
  } catch {
    return [];
  }
}

/** 기본 설치 위치 후보 */
function candidates() {
  /** @type {string[]} */
  const out = [];
  if (process.platform === "win32") {
    for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs")]) {
      if (!base) continue;
      for (const d of listDirs(join(base, "Blender Foundation"), /^Blender/i)) out.push(join(d, "blender.exe"));
    }
    // Steam 설치
    out.push("C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender\\blender.exe");
  } else if (process.platform === "darwin") {
    out.push("/Applications/Blender.app/Contents/MacOS/Blender");
    for (const d of listDirs("/Applications", /^Blender.*\.app$/i)) out.push(join(d, "Contents/MacOS/Blender"));
  } else {
    out.push("/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender");
    for (const d of listDirs("/opt", /^blender/i)) out.push(join(d, "blender"));
    if (process.env.HOME) for (const d of listDirs(process.env.HOME, /^blender/i)) out.push(join(d, "blender"));
  }
  return out.filter((p) => existsSync(p));
}

/** @param {string} bin @returns {number[] | null} */
function versionOf(bin) {
  const r = spawnSync(bin, ["-b", "--factory-startup", "--version"], { encoding: "utf8", timeout: 60000 });
  const m = /Blender (\d+)\.(\d+)(?:\.(\d+))?/.exec(r.stdout ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** @param {number[]} a @param {number[]} b */
function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function findBlender() {
  if (process.env.BLENDER) {
    const v = versionOf(process.env.BLENDER);
    if (!v) throw new Error(`BLENDER=${process.env.BLENDER} 을(를) 실행할 수 없습니다.`);
    return { bin: process.env.BLENDER, version: v };
  }
  /** @type {{ bin: string, version: number[] }[]} */
  const found = [];
  const onPath = versionOf(process.platform === "win32" ? "blender.exe" : "blender");
  if (onPath) found.push({ bin: process.platform === "win32" ? "blender.exe" : "blender", version: onPath });
  for (const bin of candidates()) {
    const v = versionOf(bin);
    if (v) found.push({ bin, version: v });
  }
  found.sort((a, b) => cmp(b.version, a.version));
  return found[0] ?? null;
}

function printInstallGuide() {
  console.error(`✗ 블렌더를 찾을 수 없습니다. ${MIN_VERSION.join(".")} 이상(권장: 4.5 LTS 또는 5.2 LTS)을 설치하세요.

  윈도우 : winget install BlenderFoundation.Blender
           또는 https://www.blender.org/download/ 에서 설치 파일
  맥     : brew install --cask blender
  리눅스 : https://download.blender.org/release/Blender4.5/ 에서 linux-x64.tar.xz를 받아 /opt에 풀기
           (예: tar -xf blender-4.5.*-linux-x64.tar.xz -C /opt)

  설치 위치가 특이하면 환경 변수로 지정: BLENDER=/경로/blender (윈도우: set BLENDER=C:\\...\\blender.exe)`);
}

const [command, ...rest] = process.argv.slice(2);
const script = command && command in SCRIPTS ? SCRIPTS[/** @type {keyof typeof SCRIPTS} */ (command)] : null;
if (!script) {
  console.error(`사용: node tools/blender/run.mjs <${Object.keys(SCRIPTS).join("|")}> -- [스크립트 인자]`);
  process.exit(2);
}
const args = rest[0] === "--" ? rest.slice(1) : rest;

let blender;
try {
  blender = findBlender();
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
if (!blender) {
  printInstallGuide();
  process.exit(2);
}
if (cmp(blender.version, MIN_VERSION) < 0) {
  console.error(`✗ 블렌더 ${blender.version.join(".")}는 너무 오래됐습니다 (${MIN_VERSION.join(".")} 이상 필요).`);
  printInstallGuide();
  process.exit(2);
}
console.log(`[blender] ${blender.bin} (${blender.version.join(".")})`);
const r = spawnSync(blender.bin, ["-b", "--factory-startup", "--python-exit-code", "1", "-P", join(here, script), "--", ...args], { stdio: "inherit" });
process.exit(r.status ?? 1);
