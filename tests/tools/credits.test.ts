import { describe, expect, it } from "vitest";
import { checkCredits, matchesPattern, upsertInto, validateEntry } from "../../tools/lib/credits.mjs";

const entry = (file: string) => ({ file, source: "Poly Haven", url: "https://polyhaven.com/a/x", author: "A", license: "CC0" });

describe("credits 패턴", () => {
  it("*는 한 폴더 단계 안에서만, **는 하위 폴더까지 맞는다", () => {
    expect(matchesPattern("textures/rock/*", "textures/rock/rock_orm.ktx2")).toBe(true);
    expect(matchesPattern("textures/rock/*", "textures/rock/sub/a.png")).toBe(false);
    expect(matchesPattern("textures/rock/**", "textures/rock/sub/a.png")).toBe(true);
    expect(matchesPattern("props/crate*", "props/crate.glb")).toBe(true);
    expect(matchesPattern("props/crate*", "props/crate_lod1.glb")).toBe(true);
    expect(matchesPattern("props/crate*", "props/barrel.glb")).toBe(false);
    expect(matchesPattern("hdri/sky.env", "hdri/sky.env")).toBe(true);
    expect(matchesPattern("hdri/sky.env", "hdri/skyXenv")).toBe(false); // "."은 문자 그대로
  });
});

describe("checkCredits", () => {
  it("기록 없는 파일과 빈 필드 항목을 찾고, credits.json/.gitkeep은 제외한다", () => {
    const files = ["credits.json", "props/.gitkeep", "props/crate.glb", "textures/rock/rock_orm.ktx2", "hdri/sky.env"];
    const entries = [entry("props/crate*"), entry("textures/rock/*"), { file: "hdri/other*", source: "", url: "u", author: "a", license: "CC0" }];
    const r = checkCredits(files, entries);
    expect(r.uncredited).toEqual(["hdri/sky.env"]);
    expect(r.invalid).toEqual([{ index: 2, missing: ["source"] }]);
    expect(r.unused).toEqual(["hdri/other*"]);
  });

  it("에셋이 없으면 통과", () => {
    expect(checkCredits(["credits.json"], [])).toEqual({ uncredited: [], invalid: [], unused: [] });
  });

  it("validateEntry: 객체가 아니거나 문자열이 아니면 필드 누락", () => {
    expect(validateEntry(null)).toEqual(["file", "source", "url", "author", "license"]);
    expect(validateEntry({ ...entry("a"), license: 0 })).toEqual(["license"]);
    expect(validateEntry({ ...entry("a"), author: "  " })).toEqual(["author"]);
  });
});

describe("upsertInto", () => {
  it("같은 file이면 교체, 아니면 추가하고 file 순으로 정렬, 필드 순서는 CLAUDE.md 형식", () => {
    const list: unknown[] = [entry("textures/b/*")];
    expect(upsertInto(list, entry("props/a*"))).toBe("added");
    expect(upsertInto(list, { ...entry("textures/b/*"), author: "B" })).toBe("updated");
    expect(list.map((e) => (e as { file: string }).file)).toEqual(["props/a*", "textures/b/*"]);
    expect(Object.keys(list[1] as object)).toEqual(["file", "source", "url", "author", "license"]);
    expect((list[1] as { author: string }).author).toBe("B");
  });

  it("빈 필드가 있으면 기록하지 않는다", () => {
    expect(() => upsertInto([], { ...entry("a"), license: "" })).toThrow(/license/);
  });
});
