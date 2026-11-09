import { describe, expect, it } from "vitest";
import { chooseBackend, isIntelIntegrated, parseBackendPref, type BackendInputs } from "../../src/core/backendChoice";

const base: BackendInputs = { urlPref: null, storedPref: null, hasWebGPU: true, adapterVendor: "apple" };

describe("렌더 백엔드 선택", () => {
  it("자동: 보통은 WebGPU", () => {
    expect(chooseBackend(base)).toEqual({ want: "webgpu", reason: null, pref: "auto" });
    expect(chooseBackend({ ...base, adapterVendor: "nvidia" }).want).toBe("webgpu");
  });

  it("자동: Intel 내장 그래픽은 WebGL2 (Arc 외장은 WebGPU)", () => {
    const d = chooseBackend({ ...base, adapterVendor: "intel", adapterArchitecture: "gen-9" });
    expect(d.want).toBe("webgl2");
    expect(d.reason).toMatch(/Intel 내장/);
    expect(chooseBackend({ ...base, adapterVendor: "intel", adapterArchitecture: "xe-hpg" }).want).toBe("webgpu");
    expect(isIntelIntegrated("Intel", "", "Intel(R) UHD Graphics 630")).toBe(true);
    expect(isIntelIntegrated("intel", "", "Intel(R) Arc(TM) A770")).toBe(false);
    expect(isIntelIntegrated(null)).toBe(false);
  });

  it("WebGPU가 없으면 WebGL2", () => {
    expect(chooseBackend({ ...base, hasWebGPU: false })).toEqual({ want: "webgl2", reason: "WebGPU 미지원 브라우저", pref: "auto" });
    expect(chooseBackend({ ...base, hasWebGPU: false, storedPref: "webgpu" }).want).toBe("webgl2");
  });

  it("우선순위: 주소 > 저장값 > 자동", () => {
    expect(chooseBackend({ ...base, adapterVendor: "intel", storedPref: "webgpu" }).want).toBe("webgpu");
    expect(chooseBackend({ ...base, storedPref: "webgpu", urlPref: "webgl2" })).toMatchObject({ want: "webgl2", pref: "webgl2", reason: "주소 ?engine=webgl2" });
    expect(chooseBackend({ ...base, storedPref: "webgl2" })).toMatchObject({ want: "webgl2", reason: "직접 선택 (WebGL2)" });
    expect(chooseBackend({ ...base, adapterVendor: "intel", urlPref: "auto", storedPref: "webgpu" }).want).toBe("webgl2");
  });

  it("값 해석", () => {
    expect(parseBackendPref("WebGL2")).toBe("webgl2");
    expect(parseBackendPref("webgpu")).toBe("webgpu");
    expect(parseBackendPref("dx12")).toBeNull();
    expect(parseBackendPref(null)).toBeNull();
  });
});
