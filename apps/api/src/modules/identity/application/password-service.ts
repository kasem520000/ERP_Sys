import { hash as argonHash, needsRehash, verify as argonVerify, argon2id } from "argon2";

import { checkPasswordPolicy } from "../domain/password-policy";

/**
 * Argon2id password service (ADR-0015 §1: memory 64 MB / iterations 3 /
 * parallelism 1 — binding parameters, stored per-hash so future parameter
 * upgrades verify old hashes transparently and re-hash on next login).
 * Argon2 encodes the parameters in the PHC string itself.
 */

export const ARGON2_PARAMS = {
  type: argon2id,
  memoryCost: 65_536, // 64 MB
  timeCost: 3,
  parallelism: 1,
} as const;

export class PasswordService {
  /** Policy-check + hash. Never log the input at any level. */
  async hashFromNewPassword(newPassword: string): Promise<string> {
    checkPasswordPolicy(newPassword);
    return argonHash(newPassword, ARGON2_PARAMS);
  }

  /** Constant-time verification against the stored PHC string. */
  async verify(storedHash: string, presentedPassword: string): Promise<boolean> {
    return argonVerify(storedHash, presentedPassword);
  }

  /**
   * Login path: when the stored hash was created with weaker parameters
   * (future upgrades), re-hash after successful verification.
   */
  needsRehash(storedHash: string): boolean {
    return needsRehash(storedHash, ARGON2_PARAMS);
  }
}
