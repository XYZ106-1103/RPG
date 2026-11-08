/**
 * 3D 컬러 LUT (Babylon 비의존): 코드 생성, Adobe .cube 파서, 리샘플, 보간.
 *
 * 저장 형식: Float32Array RGB, 인덱스 = r + g·N + b·N² (R이 가장 빠름 — .cube와 3D 텍스처의 x 축 순서가 같다).
 * LUT는 Babylon 이미지 처리에서 ACES 톤매핑 + 감마(sRGB) 변환 뒤에 적용되므로 입력/출력 모두 sRGB(0~1) 값이다.
 */

export interface Lut {
  size: number;
  /** RGB, 길이 size³·3 */
  data: Float32Array;
}

export type Rgb = readonly [number, number, number];

/** 코드로 만드는 LUT 파라미터 (LUT 파일이 없을 때 대체) */
export interface LutParams {
  /** 채도 배율 (1 = 원본, 0 = 흑백) */
  saturation: number;
  /** 대비 (1 = 원본, 0.5 중심) */
  contrast: number;
  /** 밝기 오프셋 (-0.2 ~ 0.2) */
  brightness: number;
  /** 어두운 부분 색 (곱, 1 = 원본) */
  shadowTint: Rgb;
  /** 밝은 부분 색 (곱, 1 = 원본) */
  highlightTint: Rgb;
}

export const NEUTRAL_LUT_PARAMS: LutParams = {
  saturation: 1,
  contrast: 1,
  brightness: 0,
  shadowTint: [1, 1, 1],
  highlightTint: [1, 1, 1],
};

export const DEFAULT_LUT_SIZE = 32;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Rec.709 휘도 */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function identityLut(size = DEFAULT_LUT_SIZE): Lut {
  return generateLut(NEUTRAL_LUT_PARAMS, size);
}

/** 색 하나에 파라미터 적용 (LUT 생성과 테스트에서 공유) */
export function gradeColor(p: LutParams, r: number, g: number, b: number, out: [number, number, number]): void {
  // 채도
  const l = luminance(r, g, b);
  let cr = l + (r - l) * p.saturation;
  let cg = l + (g - l) * p.saturation;
  let cb = l + (b - l) * p.saturation;
  // 어두운/밝은 부분 색조: 휘도로 섞는다 (중간 회색에서 반반)
  const t = clamp01(l);
  const tr = p.shadowTint[0] + (p.highlightTint[0] - p.shadowTint[0]) * t;
  const tg = p.shadowTint[1] + (p.highlightTint[1] - p.shadowTint[1]) * t;
  const tb = p.shadowTint[2] + (p.highlightTint[2] - p.shadowTint[2]) * t;
  cr *= tr;
  cg *= tg;
  cb *= tb;
  // 대비 (0.5 기준) + 밝기
  cr = (cr - 0.5) * p.contrast + 0.5 + p.brightness;
  cg = (cg - 0.5) * p.contrast + 0.5 + p.brightness;
  cb = (cb - 0.5) * p.contrast + 0.5 + p.brightness;
  out[0] = clamp01(cr);
  out[1] = clamp01(cg);
  out[2] = clamp01(cb);
}

export function generateLut(p: LutParams, size = DEFAULT_LUT_SIZE): Lut {
  const data = new Float32Array(size * size * size * 3);
  const c: [number, number, number] = [0, 0, 0];
  const s = size - 1;
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        gradeColor(p, r / s, g / s, b / s, c);
        data[i++] = c[0];
        data[i++] = c[1];
        data[i++] = c[2];
      }
    }
  }
  return { size, data };
}

/**
 * Adobe .cube 파서 (LUT_3D_SIZE, DOMAIN_MIN/MAX, TITLE, 주석 지원. 1D LUT는 지원하지 않는다).
 * @throws 형식이 잘못되면
 */
export function parseCubeLut(text: string): Lut {
  let size = 0;
  let min: Rgb = [0, 0, 0];
  let max: Rgb = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const key = parts[0]?.toUpperCase() ?? "";
    if (key === "TITLE") continue;
    if (key === "LUT_1D_SIZE") throw new Error(".cube: 1D LUT는 지원하지 않습니다");
    if (key === "LUT_3D_SIZE") {
      size = Number(parts[1]);
      continue;
    }
    if (key === "DOMAIN_MIN" || key === "DOMAIN_MAX") {
      const v: Rgb = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
      if (v.some((x) => !Number.isFinite(x))) throw new Error(`.cube: ${key} 값이 잘못됐습니다`);
      if (key === "DOMAIN_MIN") min = v;
      else max = v;
      continue;
    }
    if (/^[A-Z_]+$/.test(key)) continue; // 모르는 키워드는 무시
    if (parts.length < 3) throw new Error(`.cube: 잘못된 줄 "${line}"`);
    for (let k = 0; k < 3; k++) {
      const v = Number(parts[k]);
      if (!Number.isFinite(v)) throw new Error(`.cube: 숫자가 아닙니다 "${line}"`);
      values.push(v);
    }
  }
  if (!(size >= 2 && size <= 256 && Number.isInteger(size))) throw new Error(".cube: LUT_3D_SIZE가 없거나 잘못됐습니다");
  if (values.length !== size * size * size * 3) throw new Error(`.cube: 데이터 개수 ${values.length / 3} ≠ ${size}³`);
  const data = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const ch = i % 3;
    const lo = min[ch] as number;
    const hi = max[ch] as number;
    data[i] = clamp01(((values[i] as number) - lo) / (hi - lo || 1));
  }
  return { size, data };
}

/** LUT를 3선형 보간으로 표본 (입력 0~1) */
export function sampleLut(lut: Lut, r: number, g: number, b: number, out: [number, number, number]): void {
  const n = lut.size;
  const s = n - 1;
  const fr = clamp01(r) * s;
  const fg = clamp01(g) * s;
  const fb = clamp01(b) * s;
  const r0 = Math.min(Math.floor(fr), s - 1);
  const g0 = Math.min(Math.floor(fg), s - 1);
  const b0 = Math.min(Math.floor(fb), s - 1);
  const dr = fr - r0;
  const dg = fg - g0;
  const db = fb - b0;
  const d = lut.data;
  for (let ch = 0; ch < 3; ch++) {
    const at = (ri: number, gi: number, bi: number): number => d[(ri + gi * n + bi * n * n) * 3 + ch] as number;
    const c00 = at(r0, g0, b0) * (1 - dr) + at(r0 + 1, g0, b0) * dr;
    const c10 = at(r0, g0 + 1, b0) * (1 - dr) + at(r0 + 1, g0 + 1, b0) * dr;
    const c01 = at(r0, g0, b0 + 1) * (1 - dr) + at(r0 + 1, g0, b0 + 1) * dr;
    const c11 = at(r0, g0 + 1, b0 + 1) * (1 - dr) + at(r0 + 1, g0 + 1, b0 + 1) * dr;
    const c0 = c00 * (1 - dg) + c10 * dg;
    const c1 = c01 * (1 - dg) + c11 * dg;
    out[ch] = c0 * (1 - db) + c1 * db;
  }
}

/** 크기가 다른 LUT를 같은 크기로 (지역 간 보간용) */
export function resampleLut(lut: Lut, size: number): Lut {
  if (lut.size === size) return { size, data: lut.data.slice() };
  const data = new Float32Array(size * size * size * 3);
  const c: [number, number, number] = [0, 0, 0];
  const s = size - 1;
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        sampleLut(lut, r / s, g / s, b / s, c);
        data[i++] = c[0];
        data[i++] = c[1];
        data[i++] = c[2];
      }
    }
  }
  return { size, data };
}

/** out = a + (b - a)·t (크기가 같아야 한다) */
export function lerpLut(a: Lut, b: Lut, t: number, out: Lut): void {
  if (a.size !== b.size || a.size !== out.size) throw new Error("lerpLut: LUT 크기가 다릅니다");
  const ad = a.data;
  const bd = b.data;
  const od = out.data;
  for (let i = 0; i < od.length; i++) {
    const x = ad[i] as number;
    od[i] = x + ((bd[i] as number) - x) * t;
  }
}

/** GPU 업로드용 RGBA8 (out 재사용) */
export function lutToRgba8(lut: Lut, out?: Uint8Array): Uint8Array {
  const n = lut.size * lut.size * lut.size;
  const o = out && out.length === n * 4 ? out : new Uint8Array(n * 4);
  const d = lut.data;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    o[i * 4] = Math.round(clamp01(d[j] as number) * 255);
    o[i * 4 + 1] = Math.round(clamp01(d[j + 1] as number) * 255);
    o[i * 4 + 2] = Math.round(clamp01(d[j + 2] as number) * 255);
    o[i * 4 + 3] = 255;
  }
  return o;
}
