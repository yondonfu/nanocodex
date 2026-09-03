import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredHosts, sandboxOutbound } from "../src/sandbox-outbound-auth";

describe("sandbox outbound authentication", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reauthorizes every request before injecting service-provided headers", async () => {
    const upstream = vi.fn(async (request: Request) => new Response(JSON.stringify({
      authorization: request.headers.get("authorization"),
      visibleRequestHeader: request.headers.get("x-visible"),
    })));
    vi.stubGlobal("fetch", upstream);
    let calls = 0;
    const binding = {
      async fetch() {
        calls += 1;
        return Response.json({
          headers: { authorization: `Basic injected-secret-${calls}` }, expiresAt: Date.now() + 60_000,
        }, { headers: { "cache-control": "no-store" } });
      },
    } as unknown as Fetcher;
    const env = {
      NANOCODEX_COMPUTE_OUTBOUND_AUTH: binding,
      NANOCODEX_COMPUTE_OUTBOUND_AUTH_HOSTS: "git.example.test",
    };
    const request = new Request("https://git.example.test/repo.git", { headers: { "x-visible": "yes" } });
    for (let index = 1; index <= 2; index += 1) {
      const response = await sandboxOutbound(request, env, { containerId: "container-1", className: "Sandbox" });
      expect(await response.json()).toEqual({
        authorization: `Basic injected-secret-${index}`,
        visibleRequestHeader: "yes",
      });
    }
    expect(calls).toBe(2);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("fails closed for missing binding, denial, and unlisted hosts", async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("must not forward"); }));
    const target = new Request("https://git.example.test/repo.git");
    expect((await sandboxOutbound(target, {
      NANOCODEX_COMPUTE_OUTBOUND_AUTH_HOSTS: "git.example.test",
    }, { containerId: "container", className: "Sandbox" })).status).toBe(502);
    expect((await sandboxOutbound(target, {
      NANOCODEX_COMPUTE_OUTBOUND_AUTH_HOSTS: "git.example.test",
      NANOCODEX_COMPUTE_OUTBOUND_AUTH: {
        fetch: async () => new Response(null, { status: 403 }),
      } as unknown as Fetcher,
    }, { containerId: "container-denied", className: "Sandbox" })).status).toBe(403);
    expect((await sandboxOutbound(new Request("https://other.example.test"), {}, {
      containerId: "container", className: "Sandbox",
    })).status).toBe(403);
  });

  it("validates exact and wildcard host configuration", () => {
    expect(configuredHosts("git.example.test, *.packages.example.test,git.example.test"))
      .toEqual(["git.example.test", "*.packages.example.test"]);
    expect(() => configuredHosts("https://git.example.test")).toThrow("invalid");
    expect(() => configuredHosts("*")).toThrow("invalid");
  });
});
