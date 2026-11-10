import { z } from "zod";

import { InvalidValueError } from "@erp/domain-core";

/**
 * Password policy (ADR-0015 §1, AUTHENTICATION §4): min length 10 +
 * breached-password rejection; no forced rotation; no security questions.
 * Enforced at set/change (invite acceptance, reset consume, change).
 */

export const PASSWORD_MIN_LENGTH = 10;

export class WeakPasswordError extends InvalidValueError {
  constructor(reason: "too_short" | "breached") {
    super(
      reason === "too_short"
        ? `password must be at least ${PASSWORD_MIN_LENGTH} characters`
        : "password appears in known breached-password lists and is not accepted",
      { reason },
    );
  }
}

/**
 * Local breached-password deny-list (subset of the most common leaked
 * credentials, normalized). The full k-anonymity HIBP adapter is an
 * operations decision (post-phase, same envelope as the SMTP provider);
 * the list keeps the policy honest without a network dependency, and the
 * check shape (case/space-normalized) is what the adapter will reuse.
 */
const BREACHED_DENYLIST = new Set([
  "password", "password1", "password12", "password123", "password1234",
  "password12345", "password123456", "123456789", "1234567890", "12345678910",
  "qwertyuiop", "qwertyuioplkjh", "qwerty123456", "letmein12345",
  "iloveyou123", "admin123456", "administrator1", "welcome12345",
  "monkey123456", "dragon123456", "sunshine1234", "princess1234",
  "football1234", "baseball1234", "superman1234", "batman12345",
  "trustno12345", "master123456", "michael123456", "shadow123456",
  "abc12345678", "abcd123456", "aaaa123456", "asdfgh123456",
  "zaq123456789", "1q2w3e4r5t6y", "qwe123456789", "p@ssw0rd123",
  "passw0rd123456", "abcdef123456", "aaaaaaaaaa", "aaaaaaaa123",
  "asdfasdfasdf", "123456789abc", "temppass12345", "changeme1234",
  "secret123456", "hello1234567", "killer123456", "hunter123456",
  "soccer1234567", "jordan1234567", "harley1234567", "ranger1234567",
]);

export function normalizeForBreachCheck(password: string): string {
  return password.toLowerCase().replaceAll(/\s+/g, "");
}

export function checkPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new WeakPasswordError("too_short");
  }
  if (BREACHED_DENYLIST.has(normalizeForBreachCheck(password))) {
    throw new WeakPasswordError("breached");
  }
}

/** Zod schema used at the API boundary before policy evaluation. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(200)
  .refine((value) => !BREACHED_DENYLIST.has(normalizeForBreachCheck(value)), {
    message: "breached password rejected",
  });
