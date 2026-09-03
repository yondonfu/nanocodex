const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface TicketTransaction {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface TicketStorage extends TicketTransaction {
  transaction<T>(callback: (txn: TicketTransaction) => Promise<T>): Promise<T>;
}

type StoredTicket = Readonly<{
  digest: string;
  expiresAt: number;
  value: unknown;
}>;

export class OneTimeTicketStore {
  readonly #storage: TicketStorage;
  readonly #key: string;
  readonly #ttlMs: number;

  constructor(storage: TicketStorage, key: string, ttlMs: number) {
    if (!key || !Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 60_000) {
      throw new TypeError("invalid one-time ticket configuration");
    }
    this.#storage = storage;
    this.#key = key;
    this.#ttlMs = ttlMs;
  }

  async issue(value: unknown, now = Date.now()): Promise<{ ticket: string; expires_in: number }> {
    const ticket = randomToken();
    const record: StoredTicket = {
      digest: await digest(ticket),
      expiresAt: now + this.#ttlMs,
      value,
    };
    await this.#storage.transaction(async (txn) => {
      await txn.put(this.#key, record);
    });
    return { ticket, expires_in: Math.ceil(this.#ttlMs / 1_000) };
  }

  async consume(ticket: string, now = Date.now()): Promise<unknown | undefined> {
    if (!TOKEN.test(ticket)) return undefined;
    const candidateDigest = await digest(ticket);
    return this.#storage.transaction(async (txn) => {
      const record = await txn.get<StoredTicket>(this.#key);
      if (!validStoredTicket(record)) {
        if (record !== undefined) await txn.delete(this.#key);
        return undefined;
      }
      if (record.expiresAt <= now) {
        await txn.delete(this.#key);
        return undefined;
      }
      if (record.digest !== candidateDigest) return undefined;
      await txn.delete(this.#key);
      return record.value;
    });
  }
}

function validStoredTicket(value: unknown): value is StoredTicket {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<StoredTicket>;
  return Object.keys(value).length === 3
    && typeof record.digest === "string" && /^[0-9a-f]{64}$/.test(record.digest)
    && typeof record.expiresAt === "number" && Number.isSafeInteger(record.expiresAt)
    && Object.hasOwn(value, "value");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
