const OBSERVED_EVENT_TYPES = new Set([
  "model.call.started",
  "model.call.completed",
  "model.call.failed",
  "run.started",
  "run.completed",
  "run.failed",
  "tool.call",
  "tool.result",
]);

export type ManagedRuntimeEventObservation = Readonly<{
  event_cursor: string;
  turn_id?: string;
  event_type: string;
  tool_name?: string;
  status?: string;
  outcome?: "success" | "failure" | "pending";
}>;

/**
 * Produce a deliberately metadata-only event observation for Worker logs.
 * Prompts, arguments, results, errors, headers, and unknown shapes are never
 * copied into the returned object.
 */
export function managedRuntimeEventObservation(input: Readonly<{
  cursor: unknown;
  turnId: unknown;
  message: unknown;
}>): ManagedRuntimeEventObservation | null {
  const cursor = safeToken(input.cursor, 32);
  const message = record(input.message);
  const event = record(message?.type === "event" ? message.event : undefined);
  const eventType = safeToken(event?.type, 64);
  if (!cursor || !eventType || !OBSERVED_EVENT_TYPES.has(eventType)) return null;

  const payload = record(event?.payload);
  const toolName = safeToken(payload?.tool, 128);
  const status = safeToken(payload?.status, 32);
  const turnId = safeToken(input.turnId, 128);
  return Object.freeze({
    event_cursor: cursor,
    ...(turnId ? { turn_id: turnId } : {}),
    event_type: eventType,
    ...(toolName ? { tool_name: toolName } : {}),
    ...(status ? { status, outcome: outcome(status) } : {}),
  });
}

function outcome(status: string): "success" | "failure" | "pending" {
  if (["completed", "succeeded", "success"].includes(status)) return "success";
  if (["cancelled", "error", "failed", "rejected", "timed_out"].includes(status)) return "failure";
  return "pending";
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeToken(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) return null;
  return /^[A-Za-z0-9._:-]+$/u.test(value) ? value : null;
}
