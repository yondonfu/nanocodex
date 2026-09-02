import { ContainerProxy, Sandbox as CloudflareSandbox } from "@cloudflare/sandbox";

const MAX_RESPONSE_BYTES = 16 * 1024;
const EXPIRY_SKEW_MS = 15_000;

export type SandboxOutboundAuthEnv = Readonly<{
  NANOCODEX_COMPUTE_OUTBOUND_AUTH?: Fetcher;
  NANOCODEX_COMPUTE_OUTBOUND_AUTH_HOSTS?: string;
  NANOCODEX_COMPUTE_ALLOWED_HOSTS?: string;
}>;

type OutboundContext = Readonly<{ containerId: string; className: string }>;
type CachedHeaders = Readonly<{ headers: Readonly<Record<string, string>>; expiresAt: number }>;
const authCache = new Map<string, CachedHeaders>();

/** Generic outbound policy: configured hosts, opaque container identity, and header injection. */
export async function sandboxOutbound(
  request: Request,
  env: SandboxOutboundAuthEnv,
  context: OutboundContext,
): Promise<Response> {
  const host = new URL(request.url).hostname.toLowerCase();
  if (matchesAny(host, configuredHosts(env.NANOCODEX_COMPUTE_OUTBOUND_AUTH_HOSTS))) {
    if (!env.NANOCODEX_COMPUTE_OUTBOUND_AUTH || !context.containerId) {
      return new Response("outbound authentication unavailable", { status: 502 });
    }
    const headers = await headersFor(env.NANOCODEX_COMPUTE_OUTBOUND_AUTH, context.containerId, host);
    if (!headers) return new Response("outbound authentication denied", { status: 403 });
    const next = new Headers(request.headers);
    for (const [name, value] of Object.entries(headers)) next.set(name, value);
    return fetch(new Request(request, { headers: next }));
  }
  if (!matchesAny(host, configuredHosts(env.NANOCODEX_COMPUTE_ALLOWED_HOSTS))) {
    return new Response("outbound host denied", { status: 403 });
  }
  return fetch(request);
}

export class Sandbox extends CloudflareSandbox<SandboxOutboundAuthEnv> {
  enableInternet = false;
  interceptHttps = true;
  allowedHosts: string[];

  constructor(ctx: DurableObjectState<{}>, env: SandboxOutboundAuthEnv) {
    super(ctx, env);
    this.allowedHosts = [
      ...configuredHosts(env.NANOCODEX_COMPUTE_OUTBOUND_AUTH_HOSTS),
      ...configuredHosts(env.NANOCODEX_COMPUTE_ALLOWED_HOSTS),
    ];
  }
}

// The SDK exposes an inherited registry setter, so assignment is intentional.
Sandbox.outbound = sandboxOutbound;
export { ContainerProxy };

async function headersFor(binding: Fetcher, containerId: string, host: string): Promise<Readonly<Record<string, string>> | null> {
  const now = Date.now();
  const key = `${containerId}\n${host}`;
  const cached = authCache.get(key);
  if (cached && cached.expiresAt - now > EXPIRY_SKEW_MS) return cached.headers;
  authCache.delete(key);
  const response = await binding.fetch("https://outbound-auth.internal/v1/authorize", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ containerId, host }),
  });
  if (!response.ok) return null;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  const parsed = authResponse(value, now);
  if (!parsed) return null;
  authCache.set(key, parsed);
  return parsed.headers;
}

function authResponse(value: unknown, now: number): CachedHeaders | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const expiresAt = typeof row.expiresAt === "string" ? Date.parse(row.expiresAt) : Number(row.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  if (!row.headers || typeof row.headers !== "object" || Array.isArray(row.headers)) return null;
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(row.headers as Record<string, unknown>)) {
    const name = rawName.toLowerCase();
    if (typeof rawValue !== "string" || rawValue.length === 0 || rawValue.length > 8_192
      || !/^[a-z0-9-]+$/.test(name) || FORBIDDEN_HEADERS.has(name)) return null;
    headers[name] = rawValue;
  }
  if (Object.keys(headers).length === 0 || Object.keys(headers).length > 16) return null;
  return { headers: Object.freeze(headers), expiresAt };
}

const FORBIDDEN_HEADERS = new Set([
  "connection", "content-length", "cookie", "host", "proxy-connection", "te", "trailer",
  "transfer-encoding", "upgrade",
]);

export function configuredHosts(value: string | undefined): string[] {
  if (!value) return [];
  const hosts = value.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (hosts.length > 64 || hosts.some((host) => !validHostPattern(host))) {
    throw new Error("Nanocodex compute outbound host configuration is invalid");
  }
  return [...new Set(hosts)];
}

function validHostPattern(host: string): boolean {
  const value = host.startsWith("*.") ? host.slice(2) : host;
  return value.length <= 253 && value.includes(".")
    && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && !value.includes("..");
}

function matchesAny(host: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => pattern.startsWith("*.")
    ? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2)
    : host === pattern);
}
