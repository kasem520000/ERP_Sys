import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * PHASE-049 (W-19 — T-11, D-09) THE SIGNED TAG CODES' PURE FOLDS (the
 * plan §4's unit-first law; the capability-token precedent — the identity
 * reset-token's `base64url(payload).base64url(hmac)` shape, the
 * unguessable-code substrate the plan's code research named):
 *
 *   THE ENTROPY (256-bit — D-09's own number): the payload is
 *   `randomBytes(32)` in base64url (43 chars) — the tag's identity is the
 *   RANDOM BODY itself; the asset binding lives in the `asset_tags` row,
 *   never in the token (a scan resolves through the DB under RLS — the
 *   code carries no data to leak).
 *
 *   THE SIGNATURE (the platform's existing HMAC capability — one identity
 *   secret, the reset-token key material, one rotation story): HMAC-SHA256
 *   over the payload, base64url. A tag's signature NEVER EXPIRES — the
 *   physical label's law (a reset token is a 30-minute event; a printed QR
 *   is a years-long artifact — expiry would orphan every label in the
 *   field at once; revocation is the register's act: delete the row, the
 *   scan 404s).
 *
 *   THE VERIFICATION ORDER (the phase doc's own mitigation, verbatim):
 *   «an unsigned/forged code refuses at the signature, never at a lookup»
 *   — the shape check + the timing-safe signature compare happen BEFORE
 *   any DB touch; only a validly-PLATFORM-signed code reaches the RLS
 *   lookup (where a foreign tenant's row is invisible — the typed 404,
 *   never a cross-tenant oracle).
 *
 *   Pure by injection: the KEY is a parameter (the service supplies the
 *   platform's keyMaterialForTokens — the secret-envelope precedent's
 *   cross-module infra shape); the unit folds pass their own test key.
 */
export const TAG_CODE_ENTROPY_BYTES = 32;

/** The generated code's payload segment: base64url(32 random bytes) —
 * exactly 43 chars, 256 bits of entropy, no data inside. */
export function generateTagPayload(): string {
  return randomBytes(TAG_CODE_ENTROPY_BYTES).toString("base64url");
}

/** The signature segment: HMAC-SHA256 over the payload with the supplied
 * key, base64url (the reset-token derivation shape). */
export function signTagPayload(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("base64url");
}

/** Build one full code: `payload.signature` (the capability-token shape). */
export function buildTagCode(key: Buffer): { payload: string; code: string } {
  const payload = generateTagPayload();
  return { payload, code: `${payload}.${signTagPayload(key, payload)}` };
}

/** The base64url alphabet (URL-safe — the code rides a QR and a path
 * segment; no +/ padding shapes ever appear). */
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export interface VerifiedTagCode {
  readonly payload: string;
}

/**
 * Verify a presented code's SHAPE + SIGNATURE — the pre-lookup gate. Pure:
 * no clock, no store, no DB touch. Returns the payload when the code is a
 * well-formed platform-signed token; null otherwise (the caller's typed
 * TAG_CODE_INVALID names the refusal — the signature, never a lookup).
 */
export function verifyTagCode(key: Buffer, code: string): VerifiedTagCode | null {
  if (typeof code !== "string" || code.length < 3 || code.length > 1024) {
    return null;
  }
  const dot = code.indexOf(".");
  if (dot <= 0 || dot !== code.lastIndexOf(".")) {
    return null; // exactly one separator — the two-segment shape's floor
  }
  const payload = code.slice(0, dot);
  const signature = code.slice(dot + 1);
  if (payload.length === 0 || signature.length === 0) {
    return null;
  }
  if (!BASE64URL_RE.test(payload) || !BASE64URL_RE.test(signature)) {
    return null;
  }
  const expected = createHmac("sha256", key).update(payload, "utf8").digest();
  const presented = Buffer.from(signature, "base64url");
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return null; // forged or re-signed elsewhere — the signature refusal
  }
  return { payload };
}
