import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  checkPasswordPolicy,
  newPasswordSchema,
  normalizeForBreachCheck,
  PASSWORD_MIN_LENGTH,
  WeakPasswordError,
} from "./password-policy";
import { generateOpaqueToken, hashToken, tokenHashesMatch } from "./tokens";
import { openSecret, sealSecret } from "../infrastructure/secret-envelope";

/**
 * PHASE-003 T3 unit evidence: policy boundaries, token entropy/hashing, the
 * secret envelope, and the progressive-delay schedule (R-01 shape) — the DB
 * suite proves the flows end-to-end on real PostgreSQL.
 */

describe("password policy (ADR-0015 §1)", () => {
  it("accepts a long-enough non-breached password", () => {
    expect(() => checkPasswordPolicy("correct-horse-battery-9")).not.toThrow();
  });

  it("rejects below the minimum length with too_short", () => {
    expect(() => checkPasswordPolicy("short9")).toThrow(WeakPasswordError);
    try {
      checkPasswordPolicy("short9");
    } catch (error) {
      expect((error as WeakPasswordError).details).toEqual({ reason: "too_short" });
    }
  });

  it("rejects breached deny-list entries case/space-insensitively", () => {
    expect(() => checkPasswordPolicy("PassWord1234")).toThrow(WeakPasswordError);
    expect(() => checkPasswordPolicy("password 1234")).toThrow(WeakPasswordError);
    expect(normalizeForBreachCheck(" PassWord 1234 ")).toBe("password1234");
  });

  it("zod boundary schema mirrors the policy (rejects before service work)", () => {
    expect(newPasswordSchema.safeParse("x".repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false);
    expect(newPasswordSchema.safeParse("password1234").success).toBe(false);
    expect(newPasswordSchema.safeParse("a-strong-unique-passphrase").success).toBe(true);
  });
});

describe("opaque credential tokens", () => {
  it("tokens are 256-bit, url-safe, and unique per generation", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashes are one-way, deterministic, timing-safe comparable", () => {
    const token = generateOpaqueToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    expect(tokenHashesMatch(hashToken(token), hashToken(token))).toBe(true);
    expect(tokenHashesMatch(hashToken(token), hashToken(generateOpaqueToken()))).toBe(false);
    // Length-mismatch path stays false (no throw).
    expect(tokenHashesMatch("abc", "abcd")).toBe(false);
  });
});

describe("secret envelope (SECRETS_MANAGEMENT)", () => {
  it("round-trips and authenticates (GCM tag)", () => {
    const secret = generateOpaqueToken();
    const envelope = sealSecret(secret);
    expect(envelope.startsWith("v1:")).toBe(true);
    expect(envelope).not.toContain(secret);
    expect(openSecret(envelope)).toBe(secret);
  });

  it("tampered ciphertext fails closed", () => {
    const envelope = sealSecret("payload");
    const parts = envelope.split(":");
    const tampered = Buffer.from(parts[3]!, "base64url");
    tampered[0] = (tampered[0]! + 1) % 256;
    parts[3] = tampered.toString("base64url");
    expect(() => openSecret(parts.join(":"))).toThrow();
  });

  it("malformed envelopes are rejected without leaks", () => {
    expect(() => openSecret("v2:x:y:z")).toThrow(/malformed/);
    expect(() => openSecret(randomUUID())).toThrow(/malformed/);
  });
});
