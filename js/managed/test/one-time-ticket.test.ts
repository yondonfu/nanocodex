import { describe, expect, it } from "vitest";

import {
  OneTimeTicketStore,
  type TicketStorage,
  type TicketTransaction,
} from "../src/one-time-ticket";

class MemoryStorage implements TicketStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async transaction<T>(callback: (txn: TicketTransaction) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("OneTimeTicketStore", () => {
  it("stores only a digest and consumes the ticket exactly once", async () => {
    const storage = new MemoryStorage();
    const tickets = new OneTimeTicketStore(storage, "ticket", 15_000);
    const issued = await tickets.issue({ ownerId: "owner-1" }, 1_000);

    expect(issued).toMatchObject({ expires_in: 15 });
    expect(issued.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify([...storage.values.values()])).not.toContain(issued.ticket);
    await expect(tickets.consume(issued.ticket, 2_000)).resolves.toEqual({ ownerId: "owner-1" });
    await expect(tickets.consume(issued.ticket, 2_000)).resolves.toBeUndefined();
  });

  it("does not let an invalid guess consume the active ticket", async () => {
    const storage = new MemoryStorage();
    const tickets = new OneTimeTicketStore(storage, "ticket", 15_000);
    const issued = await tickets.issue({ ownerId: "owner-1" }, 1_000);

    await expect(tickets.consume("a".repeat(43), 2_000)).resolves.toBeUndefined();
    await expect(tickets.consume(issued.ticket, 2_000)).resolves.toEqual({ ownerId: "owner-1" });
  });

  it("expires unused tickets and replaces an earlier issuance", async () => {
    const storage = new MemoryStorage();
    const tickets = new OneTimeTicketStore(storage, "ticket", 15_000);
    const first = await tickets.issue({ generation: 1 }, 1_000);
    const second = await tickets.issue({ generation: 2 }, 2_000);

    await expect(tickets.consume(first.ticket, 3_000)).resolves.toBeUndefined();
    await expect(tickets.consume(second.ticket, 3_000)).resolves.toEqual({ generation: 2 });
    const expired = await tickets.issue({ generation: 3 }, 4_000);
    await expect(tickets.consume(expired.ticket, 19_000)).resolves.toBeUndefined();
  });
});
