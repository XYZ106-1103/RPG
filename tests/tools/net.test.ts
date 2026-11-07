import { describe, expect, it } from "vitest";
import { HostBlockedError, classifyFetchError, fetchChecked, isPolicyBlock } from "../../tools/lib/net.mjs";

function fakeFetch(routes: Record<string, () => Response | Promise<Response>>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const host = new URL(url).host;
    const route = routes[url] ?? routes[host];
    if (!route) throw new TypeError("fetch failed", { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" }) });
    return route();
  }) as typeof fetch;
}

describe("허용 목록 차단 감지", () => {
  it("리다이렉트 끝의 호스트가 막히면 그 호스트 이름을 담은 HostBlockedError", async () => {
    const f = fakeFetch({
      "https://ambientcg.com/get?file=x.zip": () => new Response(null, { status: 302, headers: { location: "https://acg-download.struffelproductions.com/x.zip" } }),
    });
    const err = await fetchChecked("https://ambientcg.com/get?file=x.zip", { fetchImpl: f }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HostBlockedError);
    expect((err as HostBlockedError).host).toBe("acg-download.struffelproductions.com");
  });

  it("프록시의 403 allowlist 응답도 차단으로 본다 (일반 403은 일반 오류)", async () => {
    const blocked = fakeFetch({ "dl.polyhaven.org": () => new Response("Host not in allowlist", { status: 403 }) });
    await expect(fetchChecked("https://dl.polyhaven.org/a.jpg", { fetchImpl: blocked })).rejects.toBeInstanceOf(HostBlockedError);
    const forbidden = fakeFetch({ "dl.polyhaven.org": () => new Response("Forbidden", { status: 403 }) });
    const err = await fetchChecked("https://dl.polyhaven.org/a.jpg", { fetchImpl: forbidden }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(HostBlockedError);
    expect(String(err)).toMatch(/HTTP 403/);
  });

  it("상대 경로 리다이렉트를 따라가 최종 응답을 돌려준다", async () => {
    const f = fakeFetch({
      "https://a.com/x": () => new Response(null, { status: 301, headers: { location: "/y" } }),
      "https://a.com/y": () => new Response("ok", { status: 200 }),
    });
    expect(await (await fetchChecked("https://a.com/x", { fetchImpl: f })).text()).toBe("ok");
  });

  it("classifyFetchError / isPolicyBlock", () => {
    const dns = new TypeError("fetch failed", { cause: Object.assign(new Error("x"), { code: "EAI_AGAIN" }) });
    expect(classifyFetchError(dns, "h")).toBeInstanceOf(HostBlockedError);
    const other = new Error("boom");
    expect(classifyFetchError(other, "h")).toBe(other);
    expect(isPolicyBlock(403, "request blocked: host not in allowlist")).toBe(true);
    expect(isPolicyBlock(404, "allowlist")).toBe(false);
  });
});
