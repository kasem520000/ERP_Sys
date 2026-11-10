import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "../../../config/env";

/**
 * PHASE-023 T1 — the sealed-artifact envelope for submission payloads and
 * authority responses at rest (E_INVOICING §6: "raw payloads/responses
 * stored as encrypted files"): AES-256-GCM with key material from the
 * environment — the secret-envelope precedent (identity TOTP) applied to
 * the e-invoicing artifact class. Ciphertext is what reaches the files
 * store; signed URLs hand out READS only, and only through the registry
 * service (tenant-scoped, audited).
 *
 * Key id rotation = key-add + re-encrypt on next write (same envelope
 * discipline); production fails closed when the key is unset.
 */

const DEV_KEY_ID = "dev";
const DEV_KEY_MATERIAL = createHash("sha256")
  .update("erp-dev-einvoicing-artifact-key-do-not-use-in-prod")
  .digest();

function keyMaterial(): { keyId: string; key: Buffer } {
  const raw = env.EINVOICING_SECRET_KEY ?? env.IDENTITY_SECRET_KEY;
  if (raw !== undefined && raw !== "") {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new Error("EINVOICING_SECRET_KEY must be 32 bytes (base64)");
    }
    return { keyId: env.EINVOICING_SECRET_KEY_ID || env.IDENTITY_SECRET_KEY_ID || "v1", key };
  }
  if (env.NODE_ENV === "production") {
    throw new Error("EINVOICING_SECRET_KEY (or IDENTITY_SECRET_KEY) is required in production");
  }
  return { keyId: DEV_KEY_ID, key: DEV_KEY_MATERIAL };
}

/** Seal bytes into the `v1:{keyId}:{nonce}:{ct+tag}` envelope. */
export function sealArtifact(plaintext: Buffer): Buffer {
  const { keyId, key } = keyMaterial();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.from(`einvs1:${keyId}:`, "utf8");
  return Buffer.concat([header, nonce, ciphertext, tag]);
}

/** Open an envelope produced by sealArtifact (authenticates the tag). */
export function openArtifact(envelope: Buffer): Buffer {
  const prefix = Buffer.from("einvs1:", "utf8");
  if (envelope.subarray(0, prefix.length).equals(prefix) !== true) {
    throw new Error("malformed artifact envelope");
  }
  const colon = envelope.indexOf(":", prefix.length);
  if (colon === -1) {
    throw new Error("malformed artifact envelope key id");
  }
  const keyId = envelope.subarray(prefix.length, colon).toString("utf8");
  const { keyId: currentId, key } = keyMaterial();
  if (keyId !== currentId) {
    throw new Error(`artifact envelope key id ${keyId} is not active (rotation required)`);
  }
  const nonce = envelope.subarray(colon + 1, colon + 13);
  const tag = envelope.subarray(envelope.length - 16);
  const ciphertext = envelope.subarray(colon + 13, envelope.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
