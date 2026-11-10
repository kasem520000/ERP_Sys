import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { env } from "../../../config/env";

/**
 * Application-level secret envelope for TOTP secrets at rest
 * (SECRETS_MANAGEMENT: secrets encrypted, never logged; ADR-0015 §4):
 * AES-256-GCM, key from the environment (IDENTITY_SECRET_KEY, base64,
 * 32 bytes) — never from the repo. Ciphertext carries a key id so key
 * rotation is a key-add + re-enroll, not a re-architecture. Development
 * and test derive a deterministic local key so flows stay exercisable
 * without committing secrets; production fails closed when unset.
 *
 * PHASE-024 T6 — S-03 dual-accept window (SECRETS_MANAGEMENT §3
 * "Dual-accept window (verify old+new) then retire old"): while
 * IDENTITY_SECRET_KEY_PREVIOUS (+ its key id) is set, `openSecret`
 * accepts envelopes sealed under EITHER the current or the previous key —
 * secrets sealed-in-flight before the rotation stay readable through the
 * window. `sealSecret` always seals with the CURRENT key (every new write
 * migrates onto the new key, so the window can close). When the previous
 * key is removed, old-key envelopes fail closed ("rotation required") —
 * the deliberate disruptive step the drill records. Drill + runbook:
 * docs/operations/drills/2026-11-06-secrets-rotation.md,
 * docs/operations/SECRETS_ROTATION_RUNBOOK.md §2.
 */

const DEV_KEY_ID = "dev";
const DEV_KEY_MATERIAL = createHash("sha256")
  .update("erp-dev-identity-secret-key-do-not-use-in-prod")
  .digest();

interface ActiveKey {
  readonly keyId: string;
  readonly key: Buffer;
}

function keyMaterial(): ActiveKey {
  const raw = env.IDENTITY_SECRET_KEY;
  if (raw !== undefined && raw !== "") {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new Error("IDENTITY_SECRET_KEY must be 32 bytes (base64)");
    }
    return { keyId: env.IDENTITY_SECRET_KEY_ID || "v1", key };
  }
  if (env.NODE_ENV === "production") {
    throw new Error("IDENTITY_SECRET_KEY is required in production");
  }
  return { keyId: DEV_KEY_ID, key: DEV_KEY_MATERIAL };
}

/**
 * The previous key during a rotation window (undefined = window closed).
 * Fail-fast on a malformed value (the env contract's own rule) — a
 * truncated previous key must never silently read as "no window".
 */
function previousKeyMaterial(): ActiveKey | undefined {
  const raw = env.IDENTITY_SECRET_KEY_PREVIOUS;
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("IDENTITY_SECRET_KEY_PREVIOUS must be 32 bytes (base64)");
  }
  return { keyId: env.IDENTITY_SECRET_KEY_ID_PREVIOUS || "v1", key };
}

function decryptWith(key: Buffer, nonce: Buffer, payload: Buffer): string {
  const tag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(0, payload.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Encrypt a secret into the `v1:{keyId}:{nonce}:{ct+tag}` envelope. */
export function sealSecret(plaintext: string): string {
  const { keyId, key } = keyMaterial();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${keyId}:${nonce.toString("base64url")}:${Buffer.concat([ciphertext, tag]).toString("base64url")}`;
}

/**
 * Decrypt an envelope produced by sealSecret. Dual-accept rotation window:
 * try the CURRENT key first; on an unknown key id (or an auth failure
 * under the current id) fall back to the PREVIOUS key when its key id
 * matches. Fails closed when neither key opens the envelope.
 */
export function openSecret(envelope: string): string {
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("malformed secret envelope");
  }
  const [, keyId, nonceB64, payloadB64] = parts as [string, string, string, string];
  const nonce = Buffer.from(nonceB64, "base64url");
  const payload = Buffer.from(payloadB64, "base64url");

  const current = keyMaterial();
  if (keyId === current.keyId) {
    try {
      return decryptWith(current.key, nonce, payload);
    } catch (error) {
      // Auth failure under the current id: a same-id material swap can
      // still be inside the window — try the previous key before failing.
      const previous = previousKeyMaterial();
      if (previous !== undefined && previous.keyId === keyId) {
        return decryptWith(previous.key, nonce, payload);
      }
      throw error;
    }
  }
  // Unknown-to-current key id: the rotation window is the only way an
  // old-key envelope stays readable (the key id must match the previous
  // key — an arbitrary attacker-chosen id never opens anything).
  const previous = previousKeyMaterial();
  if (previous !== undefined && previous.keyId === keyId) {
    return decryptWith(previous.key, nonce, payload);
  }
  throw new Error(`secret envelope key id ${keyId} is not active (rotation required)`);
}
