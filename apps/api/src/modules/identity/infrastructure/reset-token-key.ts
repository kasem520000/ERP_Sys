import { createHash } from "node:crypto";

import { env } from "../../../config/env";

/**
 * HMAC key material for stateless reset tokens (see recovery-service for
 * the storage rationale): same source as the TOTP-secret envelope
 * (IDENTITY_SECRET_KEY; dev/test derive a local key; production fails
 * closed) — one identity secret, two derivations, one rotation story.
 */
export function keyMaterialForTokens(): Buffer {
  const raw = env.IDENTITY_SECRET_KEY;
  if (raw !== undefined && raw !== "") {
    return Buffer.from(raw, "base64");
  }
  if (env.NODE_ENV === "production") {
    throw new Error("IDENTITY_SECRET_KEY is required in production");
  }
  return createHash("sha256").update("erp-dev-identity-secret-key-do-not-use-in-prod").digest();
}
