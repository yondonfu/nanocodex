import { describe, expect, it } from "vitest";

import {
  createStickyExecutionTool,
  managedNativeComputeInstruction,
  nativeTimeoutMs,
} from "../src/computer-runtime";
import type { ComputerExecRequest, ManagedComputerProvider } from "../src/computer-provider";

describe("managed native compute policy", () => {
  it("reports configured availability without naming an application or provider", () => {
    expect(managedNativeComputeInstruction(false)).toContain("No native-process provider is configured");
    expect(managedNativeComputeInstruction(true)).toContain("configured native-process provider is available");
    expect(managedNativeComputeInstruction(true)).not.toMatch(/Commons|SMA|Cloudflare|ix\.dev/u);
  });

  it("adds and passes a bounded native timeout while omission preserves the provider default", async () => {
    const requests: ComputerExecRequest[] = [];
    const provider: ManagedComputerProvider = {
      async exec(request) {
        requests.push(request);
        return { stdout: "ok\n", stderr: "", exitCode: 0 };
      },
    };
    const virtual = {
      name: "exec_command",
      description: "execute",
      parameters: {
        type: "object",
        properties: { cmd: { type: "string" } },
        required: ["cmd"],
        additionalProperties: false,
      },
      async handler() { return { output: "virtual\n", wall_time_seconds: 0, exit_code: 0 }; },
    };
    const tool = createStickyExecutionTool(virtual, provider, new Set(["echo"]));
    const schema = tool.parameters as { properties: { timeout_ms: Record<string, unknown> } };
    expect(schema.properties.timeout_ms).toMatchObject({ type: "integer", minimum: 1, maximum: 120_000 });

    const context = { callId: "call-1", signal: new AbortController().signal } as never;
    await tool.handler({ cmd: "npm test", timeout_ms: 42_000 }, context);
    await tool.handler({ cmd: "pwd" }, context);
    expect(requests.map((request) => request.timeoutMs)).toEqual([42_000, undefined]);
    expect(requests.every((request) => request.requirements.capabilities.includes("native-process"))).toBe(true);
  });

  it("rejects invalid native timeouts at the protocol boundary", () => {
    expect(() => nativeTimeoutMs(0)).toThrow(/between 1 and 120000/u);
    expect(() => nativeTimeoutMs(120_001)).toThrow(/between 1 and 120000/u);
    expect(() => nativeTimeoutMs(1.5)).toThrow(/integer/u);
    expect(nativeTimeoutMs(120_000)).toBe(120_000);
  });
});
