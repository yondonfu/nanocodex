const MAX_SANDBOX_ID_LENGTH = 63;
const MIN_DIGEST_LENGTH = 16;

/**
 * Preserve readable Cloudflare Sandbox IDs when they fit and map overlong
 * application identifiers to a stable, collision-resistant bounded ID.
 */
export async function cloudflareSandboxId(prefix: string, applicationId: string): Promise<string> {
  const readable = `${prefix}-${applicationId}`;
  if (readable.length <= MAX_SANDBOX_ID_LENGTH) return readable;

  const available = MAX_SANDBOX_ID_LENGTH - prefix.length - 1;
  if (available < MIN_DIGEST_LENGTH) throw new Error("sandbox ID prefix is too long");
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(applicationId),
  ));
  const hexadecimal = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${hexadecimal.slice(0, available)}`;
}
