import { describe, expect, it } from "vitest";
import { cloudflareSandboxId } from "../src/cloudflare-sandbox-id";

describe("Cloudflare Sandbox IDs", () => {
  it("preserves readable IDs that fit the provider limit", async () => {
    await expect(cloudflareSandboxId("nanocodex", "session-1"))
      .resolves.toBe("nanocodex-session-1");
  });

  it("maps long application IDs to stable distinct IDs within 63 characters", async () => {
    const prefix = "nanocodex-compute";
    const first = await cloudflareSandboxId(prefix, `account:${"a".repeat(80)}`);
    const repeated = await cloudflareSandboxId(prefix, `account:${"a".repeat(80)}`);
    const second = await cloudflareSandboxId(prefix, `account:${"b".repeat(80)}`);

    expect(first).toBe(repeated);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^nanocodex-compute-[0-9a-f]+$/);
    expect(first.length).toBe(63);
  });

  it("rejects a prefix that leaves too little room for collision resistance", async () => {
    await expect(cloudflareSandboxId("p".repeat(47), "s".repeat(80)))
      .rejects.toThrow("sandbox ID prefix is too long");
  });
});
