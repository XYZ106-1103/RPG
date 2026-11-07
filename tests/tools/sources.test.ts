import { describe, expect, it } from "vitest";
import { creditFor as acgCredit, mapOfEntry, parseAsset, pickDownload } from "../../tools/lib/ambientcg.mjs";
import { creditFor as phCredit, kindFromType, rawDirFor, selectFiles } from "../../tools/lib/polyhaven.mjs";

const f = (name: string) => ({ url: `https://dl.polyhaven.org/${name}`, size: 10, md5: "m" });
const texFiles = {
  Diffuse: { "1k": { jpg: f("d1"), png: f("d1p") }, "2k": { jpg: f("d2") } },
  nor_gl: { "2k": { jpg: f("n2") } },
  nor_dx: { "2k": { jpg: f("x2") } },
  arm: { "2k": { jpg: f("a2") } },
  Rough: { "2k": { jpg: f("r2") } },
  blend: { "2k": { blend: f("b") } },
};

describe("Poly Haven", () => {
  it("텍스처 기본: 2K JPG 컬러 + OpenGL 노멀 + ARM", () => {
    const s = selectFiles("rock", "texture", texFiles);
    expect(s.map((x) => x.name)).toEqual(["rock_diff_2k.jpg", "rock_nor_gl_2k.jpg", "rock_arm_2k.jpg"]);
    expect(s[1]?.url).toContain("n2");
  });

  it("맵 별칭과 대소문자 무시 (rough → Rough, diff → Diffuse)", () => {
    expect(selectFiles("rock", "texture", texFiles, { maps: ["diff", "ROUGH"] }).map((x) => x.name)).toEqual(["rock_diff_2k.jpg", "rock_rough_2k.jpg"]);
  });

  it("없는 해상도/맵이면 가능한 값을 알려 준다", () => {
    expect(() => selectFiles("rock", "texture", texFiles, { res: "4k" })).toThrow(/가능한 해상도: 1k, 2k/);
    expect(() => selectFiles("rock", "texture", texFiles, { maps: ["foo"] })).toThrow(/가능한 맵: Diffuse, nor_gl, nor_dx, arm, Rough/);
  });

  it("HDRI는 hdr, 모델은 glTF와 include 파일 전부", () => {
    const hdri = { hdri: { "2k": { hdr: f("h2"), exr: f("e2") } }, tonemapped: f("t") };
    expect(selectFiles("sky", "hdri", hdri).map((x) => x.name)).toEqual(["sky_2k.hdr"]);
    const model = { gltf: { "1k": { gltf: { ...f("g"), include: { "crate.bin": f("bin"), "textures/crate_diff_1k.jpg": f("tex") } } } } };
    expect(selectFiles("crate", "model", model).map((x) => x.name)).toEqual(["crate_1k.gltf", "crate.bin", "textures/crate_diff_1k.jpg"]);
  });

  it("종류, 저장 폴더, credits (최종 위치 패턴 + 작가 + CC0)", () => {
    expect([kindFromType(0), kindFromType(1), kindFromType(2)]).toEqual(["hdri", "texture", "model"]);
    expect(() => kindFromType(9)).toThrow();
    expect(rawDirFor("crate", "model")).toBe("raw/models/crate");
    expect(rawDirFor("rock", "texture")).toBe("raw/textures/rock");
    expect(phCredit("rock", "texture", { authors: { "Amal Kumar": "All" } })).toEqual({ file: "textures/rock/*", source: "Poly Haven", url: "https://polyhaven.com/a/rock", author: "Amal Kumar", license: "CC0" });
    expect(phCredit("sky", "hdri", { authors: { A: "x", B: "y" } }).file).toBe("hdri/sky*");
    expect(phCredit("crate", "model", {}).author).toBe("Poly Haven");
    // --name: 위치 패턴은 게임 이름, 출처 링크는 원래 ID
    expect(phCredit("burned_ground_01", "texture", {}, "terrain_ash")).toMatchObject({ file: "textures/terrain_ash/*", url: "https://polyhaven.com/a/burned_ground_01" });
  });
});

describe("ambientCG", () => {
  const json = {
    foundAssets: [
      {
        assetId: "Ground054",
        displayName: "Ground 054",
        shortLink: "https://ambientcg.com/a/Ground054",
        downloadFolders: {
          default: {
            downloadFiletypeCategories: {
              zip: {
                downloads: [
                  { attribute: "1K-JPG", fullDownloadPath: "https://ambientcg.com/get?file=Ground054_1K-JPG.zip", fileName: "a.zip", size: 1 },
                  { attribute: "2K-JPG", fullDownloadPath: "https://ambientcg.com/get?file=Ground054_2K-JPG.zip", fileName: "b.zip", size: 2 },
                ],
              },
            },
          },
        },
      },
    ],
  };

  it("기본 2K-JPG를 고르고, 없으면 가능한 목록을 알려 준다", () => {
    const asset = parseAsset(json, "ground054");
    expect(pickDownload(asset).url).toContain("2K-JPG");
    expect(() => pickDownload(asset, "4K-PNG")).toThrow(/1K-JPG, 2K-JPG/);
    expect(() => parseAsset({ foundAssets: [] }, "x")).toThrow(/찾을 수 없습니다/);
  });

  it("압축 파일에서 NormalGL은 꺼내고 NormalDX/미리보기/재질 정의는 버린다", () => {
    expect(mapOfEntry("Ground054_2K-JPG_NormalGL.jpg")).toBe("NormalGL");
    expect(mapOfEntry("Ground054_2K-JPG_NormalDX.jpg")).toBeNull();
    expect(mapOfEntry("Ground054_2K-JPG_AmbientOcclusion.jpg")).toBe("AmbientOcclusion");
    expect(mapOfEntry("Ground054_2K-JPG_Color.jpg")).toBe("Color");
    expect(mapOfEntry("Ground054.png")).toBeNull();
    expect(mapOfEntry("Ground054_2K-JPG.usdc")).toBeNull();
    expect(mapOfEntry("Ground054_2K-JPG.mtlx")).toBeNull();
  });

  it("credits", () => {
    expect(acgCredit(parseAsset(json, "Ground054"), "terrain_mud")).toMatchObject({ file: "textures/terrain_mud/*", url: "https://ambientcg.com/a/Ground054" });
    expect(acgCredit(parseAsset(json, "Ground054"))).toEqual({ file: "textures/Ground054/*", source: "ambientCG", url: "https://ambientcg.com/a/Ground054", author: "Lennart Demes (ambientCG)", license: "CC0" });
  });
});
