import { describe, expect, it } from "vitest";

import {
  base32Decode,
  base32Encode,
  currentTimestep,
  generateTotpSecret,
  hotp,
  otpauthUri,
  timestepStartInstant,
  verifyTotp,
} from "./totp";

/** RFC 6238 vectors (SHA-1, 8 digits → truncated to our 6-digit display). */
describe("TOTP domain (RFC 6238)", () => {
  it("base32 round-trips", () => {
    const secret = Buffer.from("12345678901234567890");
    expect(base32Encode(secret)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(Buffer.compare(base32Decode(base32Encode(secret)), secret)).toBe(0);
  });

  it("HOTP matches the RFC 4226 test vector (timestep 0)", () => {
    const secret = base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(hotp(secret, 0)).toBe("755224");
  });

  it("verifies the current window and ±1 drift", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = currentTimestep(now);
    const code = hotp(base32Decode(secret), step);
    expect(verifyTotp(secret, code, now).valid).toBe(true);
    // A code from the previous step still verifies one step later (drift).
    const late = hotp(base32Decode(secret), step);
    expect(verifyTotp(secret, late, now + 30_000).valid).toBe(true);
    // Two steps late: outside the ±1 window → rejected.
    const stale = hotp(base32Decode(secret), step - 1);
    expect(verifyTotp(secret, stale, now + 30_000).valid).toBe(false);
  });

  it("M-06: replay of an accepted timestep is rejected", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = currentTimestep(now);
    const code = hotp(base32Decode(secret), step);
    const first = verifyTotp(secret, code, now);
    expect(first.valid).toBe(true);
    const replay = verifyTotp(secret, code, now + 1000, first.matchedTimestep);
    expect(replay.valid).toBe(false);
    // Advancing to a fresh timestep works again.
    const nextCode = hotp(base32Decode(secret), step + 1);
    expect(verifyTotp(secret, nextCode, now + 30_000, first.matchedTimestep).valid).toBe(true);
  });

  it("timestep start instant round-trips through last_used_at", () => {
    const step = currentTimestep(Date.now());
    const instant = timestepStartInstant(step);
    expect(currentTimestep(instant.getTime())).toBe(step);
  });

  it("otpauth URI carries issuer + account + parameters", () => {
    const uri = otpauthUri("JBSWY3DPEHPK3PXP", "user@corp", "ERP");
    expect(uri.startsWith("otpauth://totp/ERP%3Auser%40corp?")).toBe(true);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
  });

  it("malformed codes never reach HMAC comparison", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "12ab45", Date.now()).valid).toBe(false);
    expect(verifyTotp(secret, "12345", Date.now()).valid).toBe(false);
  });
});
