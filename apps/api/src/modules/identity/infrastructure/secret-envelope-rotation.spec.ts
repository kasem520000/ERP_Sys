import { randomBytes } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { reloadEnv } from "../../../config/env";
import { openSecret, sealSecret } from "./secret-envelope";

/**
 * PHASE-024 T6 — S-03 dual-accept rotation window (SECRETS_MANAGEMENT §3,
 * "Dual-accept window (verify old+new) then retire old"): the plain unit
 * proof for the key-rotation drill. The full drill (env rotation against
 * the real boot path) is the db spec
 * `src/__db__/secrets-rotation.db.spec.ts` run by the orchestrator; this
 * file proves the envelope semantics hermetically:
 *  - envelopes sealed with the OLD key stay readable while the previous
 *    key is configured (sealed-in-flight secrets survive the window);
 *  - removing the previous key closes the window — old-key envelopes
 *    fail closed;
 *  - tampered payloads fail closed under every configuration;
 *  - `sealSecret` always writes the CURRENT key id (the window can close
 *    because every new write migrates onto the new key).
 */

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
const KEY_C = randomBytes(32).toString("base64");

const ENV_KEYS = [
  "IDENTITY_SECRET_KEY",
  "IDENTITY_SECRET_KEY_ID",
  "IDENTITY_SECRET_KEY_PREVIOUS",
  "IDENTITY_SECRET_KEY_ID_PREVIOUS",
] as const;

let snapshot: Record<string, string | undefined>;

/** Apply an env overlay (undefined = delete) and re-parse the singleton. */
function applyEnv(overlay: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): void {
  for (const key of ENV_KEYS) {
    if (key in overlay) {
      const value = overlay[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
  reloadEnv();
}

beforeAll(() => {
  snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
});

afterEach(() => {
  applyEnv({
    IDENTITY_SECRET_KEY: undefined,
    IDENTITY_SECRET_KEY_ID: undefined,
    IDENTITY_SECRET_KEY_PREVIOUS: undefined,
    IDENTITY_SECRET_KEY_ID_PREVIOUS: undefined,
  });
});

afterAll(() => {
  // Restore the ambient environment exactly (unset keys stay unset).
  applyEnv(snapshot);
});

describe("S-03 dual-accept window (secret envelope rotation)", () => {
  const payload = "totp-seed-drill-AHZQ3XF4";

  it("seals with the old key, then reads it back under the rotation window (round-trip)", () => {
    // Pre-rotation: current key = A (id drill-a).
    applyEnv({ IDENTITY_SECRET_KEY: KEY_A, IDENTITY_SECRET_KEY_ID: "drill-a" });
    const sealedUnderOldKey = sealSecret(payload);
    expect(sealedUnderOldKey.split(":")[1]).toBe("drill-a");

    // Rotation: current key = B, previous = A — the sealed-in-flight value
    // must stay readable through the window (SECRETS §3 S-03 row).
    applyEnv({
      IDENTITY_SECRET_KEY: KEY_B,
      IDENTITY_SECRET_KEY_ID: "drill-b",
      IDENTITY_SECRET_KEY_PREVIOUS: KEY_A,
      IDENTITY_SECRET_KEY_ID_PREVIOUS: "drill-a",
    });
    expect(openSecret(sealedUnderOldKey)).toBe(payload);
  });

  it("new seals during the window use the CURRENT key id (the window can close)", () => {
    applyEnv({
      IDENTITY_SECRET_KEY: KEY_B,
      IDENTITY_SECRET_KEY_ID: "drill-b",
      IDENTITY_SECRET_KEY_PREVIOUS: KEY_A,
      IDENTITY_SECRET_KEY_ID_PREVIOUS: "drill-a",
    });
    const sealed = sealSecret(payload);
    expect(sealed.split(":")[1]).toBe("drill-b");
    // And the current-key envelope opens with or without the window.
    expect(openSecret(sealed)).toBe(payload);
    applyEnv({
      IDENTITY_SECRET_KEY_PREVIOUS: undefined,
      IDENTITY_SECRET_KEY_ID_PREVIOUS: undefined,
    });
    expect(openSecret(sealed)).toBe(payload);
  });

  it("closing the window (previous key removed) fails closed for old-key envelopes", () => {
    applyEnv({ IDENTITY_SECRET_KEY: KEY_A, IDENTITY_SECRET_KEY_ID: "drill-a" });
    const sealedUnderOldKey = sealSecret(payload);

    applyEnv({ IDENTITY_SECRET_KEY: KEY_B, IDENTITY_SECRET_KEY_ID: "drill-b" });
    expect(() => openSecret(sealedUnderOldKey)).toThrow(
      /secret envelope key id drill-a is not active \(rotation required\)/,
    );
  });

  it("a previous key whose id does NOT match the envelope's id never opens it", () => {
    applyEnv({ IDENTITY_SECRET_KEY: KEY_A, IDENTITY_SECRET_KEY_ID: "drill-a" });
    const sealedUnderOldKey = sealSecret(payload);

    // Previous configured with the WRONG id (operator error): keyId match
    // is required — fail closed, not fail-open on material alone.
    applyEnv({
      IDENTITY_SECRET_KEY: KEY_B,
      IDENTITY_SECRET_KEY_ID: "drill-b",
      IDENTITY_SECRET_KEY_PREVIOUS: KEY_A,
      IDENTITY_SECRET_KEY_ID_PREVIOUS: "wrongid",
    });
    expect(() => openSecret(sealedUnderOldKey)).toThrow(/not active/);
  });

  it("tampered envelopes fail closed under every window configuration", () => {
    applyEnv({ IDENTITY_SECRET_KEY: KEY_A, IDENTITY_SECRET_KEY_ID: "drill-a" });
    const sealed = sealSecret(payload);
    const parts = sealed.split(":");
    const tamperedBytes = Buffer.from(parts[3]!, "base64url");
    tamperedBytes[0] = (tamperedBytes[0]! + 1) % 256;
    parts[3] = tamperedBytes.toString("base64url");
    const tampered = parts.join(":");

    // Current key only.
    applyEnv({ IDENTITY_SECRET_KEY: KEY_B, IDENTITY_SECRET_KEY_ID: "drill-b" });
    expect(() => openSecret(tampered)).toThrow();

    // Window open with the sealing key as previous (GCM tag check holds
    // on the previous-key path too — tamper is never readable).
    applyEnv({
      IDENTITY_SECRET_KEY: KEY_B,
      IDENTITY_SECRET_KEY_ID: "drill-b",
      IDENTITY_SECRET_KEY_PREVIOUS: KEY_A,
      IDENTITY_SECRET_KEY_ID_PREVIOUS: "drill-a",
    });
    expect(() => openSecret(tampered)).toThrow();
  });

  it("a previous key that is not 32 bytes fails fast (bad rotation config is loud)", () => {
    applyEnv({
      IDENTITY_SECRET_KEY: KEY_B,
      IDENTITY_SECRET_KEY_ID: "drill-b",
      IDENTITY_SECRET_KEY_PREVIOUS: "c2hvcnQ=", // "short" — 5 bytes
    });
    expect(() => openSecret("v1:anything:aaaa:bbbb")).toThrow(
      /IDENTITY_SECRET_KEY_PREVIOUS must be 32 bytes/,
    );
  });

  it("the same envelope key id with rotated material stays readable through the window", () => {
    // Same-id material swap (operator kept the id, rotated the bytes):
    // the current attempt fails the tag, the previous attempt succeeds.
    applyEnv({ IDENTITY_SECRET_KEY: KEY_A, IDENTITY_SECRET_KEY_ID: "same" });
    const sealed = sealSecret(payload);
    applyEnv({
      IDENTITY_SECRET_KEY: KEY_B,
      IDENTITY_SECRET_KEY_ID: "same",
      IDENTITY_SECRET_KEY_PREVIOUS: KEY_A,
      IDENTITY_SECRET_KEY_ID_PREVIOUS: "same",
    });
    expect(openSecret(sealed)).toBe(payload);
    // Window closed again: the same-id swap fails closed too.
    applyEnv({
      IDENTITY_SECRET_KEY_PREVIOUS: undefined,
      IDENTITY_SECRET_KEY_ID_PREVIOUS: undefined,
    });
    expect(() => openSecret(sealed)).toThrow();
  });

  it("envelopes from a third (never-configured) key fail closed", () => {
    applyEnv({ IDENTITY_SECRET_KEY: KEY_C, IDENTITY_SECRET_KEY_ID: "drill-c" });
    const sealedByThirdKey = sealSecret(payload);

    applyEnv({
      IDENTITY_SECRET_KEY: KEY_B,
      IDENTITY_SECRET_KEY_ID: "drill-b",
      IDENTITY_SECRET_KEY_PREVIOUS: KEY_A,
      IDENTITY_SECRET_KEY_ID_PREVIOUS: "drill-a",
    });
    expect(() => openSecret(sealedByThirdKey)).toThrow(/not active/);
  });
});
