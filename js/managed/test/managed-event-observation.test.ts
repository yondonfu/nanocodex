import { describe, expect, it } from "vitest";
import { managedRuntimeEventObservation } from "../src/managed-event-observation";

describe("managed runtime event observations", () => {
  it("projects correlation and tool metadata without payload contents", () => {
    const secret = "ncx_live_synthetic_secret_must_not_escape";
    const observation = managedRuntimeEventObservation({
      cursor: "42",
      turnId: "run-1",
      message: {
        type: "event",
        event: {
          type: "tool.result",
          payload: {
            tool: "commons_repository_checkout",
            status: "failed",
            arguments: { authorization: `Bearer ${secret}` },
            result: { password: secret },
            error: `request failed: ${secret}`,
          },
        },
      },
    });

    expect(observation).toEqual({
      event_cursor: "42",
      turn_id: "run-1",
      event_type: "tool.result",
      tool_name: "commons_repository_checkout",
      status: "failed",
      outcome: "failure",
    });
    expect(JSON.stringify(observation)).not.toContain(secret);
  });

  it("omits unsafe tokens and ignores noisy or unknown event shapes", () => {
    expect(managedRuntimeEventObservation({
      cursor: "43",
      turnId: "run with spaces",
      message: {
        type: "event",
        event: { type: "tool.call", payload: { tool: "unsafe tool name", arguments: "secret" } },
      },
    })).toEqual({ event_cursor: "43", event_type: "tool.call" });

    expect(managedRuntimeEventObservation({
      cursor: "44",
      turnId: "run-1",
      message: { type: "event", event: { type: "api.event", payload: { body: "secret" } } },
    })).toBeNull();
    expect(managedRuntimeEventObservation({
      cursor: "45",
      turnId: "run-1",
      message: { type: "stream_failed", error: "secret" },
    })).toBeNull();
  });
});
