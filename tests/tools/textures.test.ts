import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectOrmMaps, interleaveOrm, packOrm } from "../../tools/lib/orm.mjs";
import { classifyTexture, encodeOptionsFor, gpuBytes } from "../../tools/lib/textureMode.mjs";

describe("텍스처 슬롯 분류", () => {
  it("노멀 → normal, 컬러 → color, ORM 등 → data", () => {
    expect(classifyTexture(["normalTexture"])).toEqual({ mode: "normal", conflict: false });
    expect(classifyTexture(["clearcoatNormalTexture"]).mode).toBe("normal");
    expect(classifyTexture(["baseColorTexture"]).mode).toBe("color");
    expect(classifyTexture(["emissiveTexture"]).mode).toBe("color");
    expect(classifyTexture(["metallicRoughnessTexture", "occlusionTexture"])).toEqual({ mode: "data", conflict: false });
  });

  it("컬러와 데이터에 공유되면 선형(data) 우선 + 충돌 표시", () => {
    expect(classifyTexture(["baseColorTexture", "occlusionTexture"])).toEqual({ mode: "data", conflict: true });
  });

  it("인코더 옵션: 컬러는 ETC1S sRGB, 노멀/데이터는 UASTC 선형 + zstd + RDO", () => {
    expect(encodeOptionsFor("color")).toMatchObject({ isUASTC: false, isPerceptual: true, isSetKTX2SRGBTransferFunc: true });
    expect(encodeOptionsFor("normal")).toMatchObject({ isUASTC: true, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false, needSupercompression: true, enableRDO: true });
    expect(encodeOptionsFor("data")).toMatchObject({ isUASTC: true, isNormalMap: false, isSetKTX2SRGBTransferFunc: false });
    expect(encodeOptionsFor("data", { rdo: 0 })).toMatchObject({ enableRDO: false });
    expect(encodeOptionsFor("data", { rdo: 0 })).not.toHaveProperty("rdoQualityLevel");
  });

  it("GPU 메모리 추정: 원본 RGBA 4B/px, UASTC 1B/px, ETC1S 0.5B/px (밉맵 4/3)", () => {
    expect(gpuBytes(1024, 1024, "raw")).toBe(Math.round(1024 * 1024 * 4 * (4 / 3)));
    expect(gpuBytes(1024, 1024, "data")).toBe(Math.round(1024 * 1024 * (4 / 3)));
    expect(gpuBytes(1024, 1024, "color")).toBe(Math.round(1024 * 1024 * 0.5 * (4 / 3)));
    expect(gpuBytes(1024, 1024, "color", true)).toBe(gpuBytes(1024, 1024, "data"));
  });
});

describe("ORM 패킹", () => {
  it("파일명으로 채널을 찾는다 (Poly Haven / ambientCG 규칙, arm/미리보기 제외)", () => {
    expect(detectOrmMaps(["rock_ao_2k.jpg", "rock_rough_2k.jpg", "rock_arm_2k.jpg", "rock_diff_2k.jpg"])).toEqual({ ao: "rock_ao_2k.jpg", roughness: "rock_rough_2k.jpg" });
    expect(detectOrmMaps(["G_2K-JPG_AmbientOcclusion.jpg", "G_2K-JPG_Roughness.jpg", "G_2K-JPG_Metalness.jpg", "G_2K-JPG_Color.jpg"])).toEqual({
      ao: "G_2K-JPG_AmbientOcclusion.jpg",
      roughness: "G_2K-JPG_Roughness.jpg",
      metallic: "G_2K-JPG_Metalness.jpg",
    });
    expect(() => detectOrmMaps(["a_rough_1k.jpg", "a_rough_2k.jpg"])).toThrow(/여러 개/);
  });

  it("R=AO, G=Roughness, B=Metallic, 없는 채널은 기본값 (AO 255, Roughness 255, Metallic 0)", () => {
    const rgb = interleaveOrm({ roughness: new Uint8Array([10, 20]) }, 2, 1);
    expect([...rgb]).toEqual([255, 10, 0, 255, 20, 0]);
    expect(() => interleaveOrm({ ao: new Uint8Array(3) }, 2, 1)).toThrow(/크기/);
  });

  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "orm-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("실제 이미지: 크기가 다르면 큰 쪽에 맞추고 첫 채널 값을 쓴다", async () => {
    const gray = (v: number, size: number) => sharp({ create: { width: size, height: size, channels: 3, background: { r: v, g: v, b: v } } }).png().toBuffer();
    await sharp(await gray(100, 8)).toFile(join(dir, "ao.png"));
    await sharp(await gray(200, 4)).toFile(join(dir, "rough.png"));
    const out = join(dir, "orm.png");
    const r = await packOrm({ ao: join(dir, "ao.png"), roughness: join(dir, "rough.png") }, out);
    expect(r).toEqual({ width: 8, height: 8, used: ["ao", "roughness"] });
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    expect([data[0], data[1], data[2]]).toEqual([100, 200, 0]);
  });
});
