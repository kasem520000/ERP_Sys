import { createHmac } from "node:crypto";

import { keyMaterialForTokens } from "../../identity/infrastructure/reset-token-key";

/**
 * PHASE-016 · sync cursor tokens (SYNC_PROTOCOL §2): opaque, signed
 * wrappers over `{entityType, seq, issuedAt}` — clients store them
 * verbatim and never parse them; the signature keeps a tampered cursor
 * from reading another feed or skipping the seq order.
 *
 * PHASE-020: the encode/decode format is FROZEN (016 clients hold these
 * tokens verbatim across upgrades); only the contract-version constant
 * changed — it now re-exports `SYNC_CONTRACT_VERSION` from @erp/contracts
 * (the single version source, MASTER-PLAN §2; the 016 env-derived local
 * definition is retired).
 */

export interface CursorClaims {
  entityType: string;
  seq: number;
  issuedAt: string;
}

function sign(payload: string): string {
  return createHmac("sha256", keyMaterialForTokens()).update(`sync-cursor:${payload}`).digest("base64url");
}

/** Encode cursor claims into the opaque token handed to clients. */
export function encodeCursor(claims: CursorClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Decode + verify; returns undefined on any tamper/shape failure. */
export function decodeCursor(token: string): CursorClaims | undefined {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payload);
  if (signature.length !== expected.length) return undefined;
  if (!timingSafeEqualString(signature, expected)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CursorClaims;
    if (typeof claims.entityType !== "string" || typeof claims.seq !== "number") return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** The sync contract version advertised by /sync/status (§11 rule 3: the
 * generalized PHASE-020 protocol must accept a PHASE-016 terminal on day
 * one — the version gate is how). PHASE-020: re-exported from
 * @erp/contracts — the single source of truth shared with the device-side
 * sync-core (MASTER-PLAN §2). */
export { SYNC_CONTRACT_VERSION } from "@erp/contracts";
