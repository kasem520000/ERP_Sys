import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque credential tokens (ADR-0015): session ids, invitation tokens,
 * password-reset tokens and CSRF tokens are 256-bit random values; the
 * database stores only their SHA-256 hash, compared timing-safe. Nothing
 * here is a JWT — revocation is server-side by design.
 */

/** Cryptographically random opaque token, URL-safe (base64url, no padding). */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hash of a token — the only value persisted at rest. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Timing-safe equality for token hashes (constant-time, null-safe). */
export function tokenHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
