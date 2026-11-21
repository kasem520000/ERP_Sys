import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  TAG_CODE_ENTROPY_BYTES,
  buildTagCode,
  generateTagPayload,
  signTagPayload,
  verifyTagCode,
} from "./cmms-tag-code";

/**
 * PHASE-049 (W-19 — T-11) THE TAG CODE SIGNING/UNIQUENESS FOLDS —
 * unit-first (the plan §4's own list: "the tag code signing/uniqueness
 * folds (D-09)").
 */

const KEY = createHash("sha256").update("cmms-tag-code-unit-key").digest();
const OTHER_KEY = createHash("sha256").update("a-different-key-entirely").digest();

describe("the payload's entropy (256-bit — D-09's own number)", () => {
  it("the payload is base64url(32 bytes) — exactly 43 chars, URL-safe, no data inside", () => {
    for (let index = 0; index < 64; index += 1) {
      const payload = generateTagPayload();
      expect(payload).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(payload, "base64url").length).toBe(TAG_CODE_ENTROPY_BYTES);
    }
  });

  it("unguessable by construction: 4,096 generated codes are all distinct (the birthday floor far below 2^128)", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 4_096; index += 1) {
      seen.add(generateTagPayload());
    }
    expect(seen.size).toBe(4_096);
  });
});

describe("the signature (the capability-token shape — payload.signature)", () => {
  it("build → verify round-trips the payload", () => {
    const { payload, code } = buildTagCode(KEY);
    expect(code).toBe(`${payload}.${signTagPayload(KEY, payload)}`);
    expect(verifyTagCode(KEY, code)).toEqual({ payload });
  });

  it("the generated code sits inside the 0106 DB floor (16 ≤ len ≤ 512)", () => {
    const { code } = buildTagCode(KEY);
    expect(code.length).toBeGreaterThanOrEqual(16);
    expect(code.length).toBeLessThanOrEqual(512);
    expect(code.length).toBe(43 + 1 + 43);
  });

  it("a tampered payload refuses at the signature (never at a lookup)", () => {
    const { code } = buildTagCode(KEY);
    const tampered = `A${code}`;
    expect(verifyTagCode(KEY, tampered)).toBeNull();
  });

  it("a re-signed code under a different key refuses (one platform secret, one rotation story)", () => {
    const { payload } = buildTagCode(KEY);
    const forged = `${payload}.${signTagPayload(OTHER_KEY, payload)}`;
    expect(verifyTagCode(KEY, forged)).toBeNull();
  });

  it("the malformed shapes refuse: no separator, two separators, empty segments, non-base64url bodies, absurd lengths", () => {
    expect(verifyTagCode(KEY, "")).toBeNull();
    expect(verifyTagCode(KEY, "noseparator")).toBeNull();
    expect(verifyTagCode(KEY, ".")).toBeNull();
    expect(verifyTagCode(KEY, "abc.")).toBeNull();
    expect(verifyTagCode(KEY, ".abc")).toBeNull();
    expect(verifyTagCode(KEY, "a.b.c")).toBeNull();
    expect(verifyTagCode(KEY, "pay+load.sig")).toBeNull(); // + is not base64url
    expect(verifyTagCode(KEY, "payload.signa/ture")).toBeNull(); // / neither
    expect(verifyTagCode(KEY, `${"x".repeat(600)}.sig`)).toBeNull();
    expect(verifyTagCode(KEY, "ab")).toBeNull();
  });

  it("the verification never throws — every refusal is the null the caller names TAG_CODE_INVALID", () => {
    expect(() => verifyTagCode(KEY, "whatever")).not.toThrow();
    expect(() => verifyTagCode(KEY, `${"A".repeat(43)}.${"B".repeat(43)}`)).not.toThrow();
  });
});
