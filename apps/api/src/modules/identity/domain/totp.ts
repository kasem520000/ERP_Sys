import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP per RFC 6238 (ADR-0015 §4): SHA-1, 6 digits, 30-second period,
 * ±1 step drift window. Secrets are 160-bit, base32-encoded for QR
 * enrollment; one-time-use is enforced by storing the last accepted
 * timestep (as its start instant) in `mfa_factors.last_used_at` — a replayed
 * code computes to a timestep ≤ the stored one and is rejected (M-06).
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_DRIFT_STEPS = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Random 160-bit secret, base32-encoded (otpauth-ready). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(encoded: string): Buffer {
  const clean = encoded.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`invalid base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Current timestep at the given epoch milliseconds. Pure integer arithmetic
 * (no floating-point rounding anywhere near money or time — the same
 * discipline ADR-0009 demands for decimal values): div and mod on the
 * millisecond count keep the step exact for any representable instant.
 */
export function currentTimestep(atMs: number, periodSeconds = TOTP_PERIOD_SECONDS): number {
  const periodMs = periodSeconds * 1000;
  return (atMs - mod(atMs, periodMs)) / periodMs;
}

function mod(dividend: number, divisor: number): number {
  return ((dividend % divisor) + divisor) % divisor;
}

/** RFC 4226 HOTP value for a timestep. */
export function hotp(secret: Buffer, timestep: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timestep));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
}

export interface TotpVerification {
  /** True when the code matches within the drift window. */
  valid: boolean;
  /** Matched timestep (only when valid) — persist for replay rejection. */
  matchedTimestep: number;
}

/**
 * Verify a code against the secret, rejecting replays: any matched
 * timestep ≤ lastAcceptedTimestep is a replayed or stale code (M-06).
 */
export function verifyTotp(
  secret: string,
  code: string,
  atMs: number,
  lastAcceptedTimestep?: number,
  periodSeconds = TOTP_PERIOD_SECONDS,
): TotpVerification {
  if (!/^\d{6}$/.test(code)) {
    return { valid: false, matchedTimestep: -1 };
  }
  const step = currentTimestep(atMs, periodSeconds);
  for (let drift = -TOTP_DRIFT_STEPS; drift <= TOTP_DRIFT_STEPS; drift += 1) {
    const timestep = step + drift;
    if (timestep < 0) {
      continue;
    }
    const candidate = hotp(base32Decode(secret), timestep);
    if (timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) {
      if (lastAcceptedTimestep !== undefined && timestep <= lastAcceptedTimestep) {
        return { valid: false, matchedTimestep: timestep };
      }
      return { valid: true, matchedTimestep: timestep };
    }
  }
  return { valid: false, matchedTimestep: -1 };
}

/** Start instant of a timestep (persisted as last_used_at for replay checks). */
export function timestepStartInstant(timestep: number): Date {
  return new Date(timestep * TOTP_PERIOD_SECONDS * 1000);
}

/** otpauth:// enrollment URI (rendered as QR by clients). */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
