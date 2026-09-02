import { describe, expect, it } from "vitest";

import {
  cloudflareSandboxName,
  configuredComputerProvider,
  registerConfiguredComputerOutboundContext,
} from "../src/computer-provider-config";

describe("managed compute provider configuration", () => {
  it("stays virtual when no provider is configured", () => {
    expect(configuredComputerProvider({}, "thread-1")).toBeUndefined();
  });

  it("fails closed when ix is selected without broker credentials", () => {
    expect(() => configuredComputerProvider({
      NANOCODEX_COMPUTE_PROVIDER: "ix",
    }, "thread-1")).toThrow("NANOCODEX_IX_BROKER_TOKEN");

    expect(() => configuredComputerProvider({
      NANOCODEX_COMPUTE_PROVIDER: "ix",
      NANOCODEX_IX_BROKER_TOKEN: "secret",
    }, "thread-1")).toThrow("NANOCODEX_IX_BROKER_URL");
  });

  it("constructs ix lazily without contacting the broker", () => {
    const factory = configuredComputerProvider({
      NANOCODEX_COMPUTE_PROVIDER: "ix",
      NANOCODEX_IX_BROKER_TOKEN: "secret",
      NANOCODEX_IX_BROKER_URL: "https://ix-broker.example.test",
      NANOCODEX_IX_REGION: "us-west-1",
    }, "018f.foo:bar");

    expect(factory).toBeTypeOf("function");
    const workspace = {
      root: "/workspace",
      async list() { return []; },
      async readFile() { throw new Error("missing"); },
      async writeFile() {},
      async mkdir() {},
      async remove() {},
    };
    expect(factory!(workspace)).toMatchObject({ exec: expect.any(Function) });
  });

  it("requires the Cloudflare Sandbox binding when cloudflare is selected", () => {
    expect(() => configuredComputerProvider({
      NANOCODEX_COMPUTE_PROVIDER: "cloudflare",
    }, "thread-1")).toThrow("NANOCODEX_COMPUTE_SANDBOX");
  });

  it("registers opaque session context by deterministic container id", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const binding = {
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return new Response(null, { status: 204 });
      },
    } as unknown as Fetcher;
    const namespace = {
      idFromName(name: string) { return { toString: () => `do:${name}` }; },
    } as unknown as DurableObjectNamespace<import("@cloudflare/sandbox").Sandbox>;
    await registerConfiguredComputerOutboundContext({
      NANOCODEX_COMPUTE_PROVIDER: "cloudflare",
      NANOCODEX_COMPUTE_SANDBOX: namespace,
      NANOCODEX_COMPUTE_OUTBOUND_AUTH: binding,
      NANOCODEX_COMPUTE_OUTBOUND_AUTH_HOSTS: "git.example.test",
    }, { runtimeId: "runtime-1", sessionId: "session-1" });
    expect(calls).toEqual([{
      url: "https://outbound-auth.internal/v1/context",
      body: { containerId: "do:nanocodex-compute-runtime-1", sessionId: "session-1" },
    }]);
    expect(cloudflareSandboxName("runtime-1")).toBe("nanocodex-compute-runtime-1");
  });

  it("fails closed when outbound auth hosts lack a service binding", async () => {
    await expect(registerConfiguredComputerOutboundContext({
      NANOCODEX_COMPUTE_PROVIDER: "cloudflare",
      NANOCODEX_COMPUTE_SANDBOX: { idFromName: () => ({}) } as unknown as
        DurableObjectNamespace<import("@cloudflare/sandbox").Sandbox>,
      NANOCODEX_COMPUTE_OUTBOUND_AUTH_HOSTS: "git.example.test",
    }, { runtimeId: "runtime-1", sessionId: "session-1" })).rejects.toThrow(
      "NANOCODEX_COMPUTE_OUTBOUND_AUTH",
    );
  });
});
