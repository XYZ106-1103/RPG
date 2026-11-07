import { describe, expect, it } from "vitest";
import { ROLE_MODE, outputName, planTextureSet } from "../../tools/lib/textureSet.mjs";

describe("텍스처 세트 역할 판별", () => {
  it("Poly Haven: diff/nor_gl/arm/disp, DirectX 노멀은 건너뛴다", () => {
    const p = planTextureSet(["x_diff_2k.jpg", "x_nor_gl_2k.jpg", "x_nor_dx_2k.jpg", "x_arm_2k.jpg", "x_disp_2k.jpg", "readme.txt"]);
    expect(p.files).toEqual({ albedo: "x_diff_2k.jpg", normal: "x_nor_gl_2k.jpg", orm: "x_arm_2k.jpg", height: "x_disp_2k.jpg" });
    expect(p.separateOrm).toEqual({});
    expect(p.skipped).toEqual(["x_nor_dx_2k.jpg"]);
  });

  it("ambientCG: ORM이 없으면 AO/Roughness/Metalness를 따로 찾아 패킹 대상으로", () => {
    const p = planTextureSet(["G_Color.jpg", "G_NormalGL.jpg", "G_NormalDX.jpg", "G_Roughness.jpg", "G_AmbientOcclusion.jpg", "G_Displacement.jpg", "G_Opacity.jpg"]);
    expect(p.files).toEqual({ albedo: "G_Color.jpg", normal: "G_NormalGL.jpg", height: "G_Displacement.jpg" });
    expect(p.separateOrm).toEqual({ ao: "G_AmbientOcclusion.jpg", roughness: "G_Roughness.jpg" });
    expect(p.skipped.sort()).toEqual(["G_NormalDX.jpg", "G_Opacity.jpg"]);
  });

  it("ORM(arm)이 있으면 따로 있는 AO/Roughness는 쓰지 않는다 (건너뜀으로 보고)", () => {
    const p = planTextureSet(["x_diff.jpg", "x_arm.jpg", "x_rough.jpg"]);
    expect(p.files.orm).toBe("x_arm.jpg");
    expect(p.separateOrm).toEqual({});
    expect(p.skipped).toEqual(["x_rough.jpg"]);
  });

  it("같은 역할 후보가 둘이면 오류", () => {
    expect(() => planTextureSet(["a_diff_1k.jpg", "a_diff_2k.jpg"])).toThrow(/albedo 후보가 여러 개/);
  });

  it("역할 → 압축 방식, 출력 이름", () => {
    expect(ROLE_MODE).toEqual({ albedo: "color", normal: "normal", orm: "data", height: "data" });
    expect(outputName("terrain_ash", "albedo")).toBe("terrain_ash_albedo.ktx2");
  });
});
