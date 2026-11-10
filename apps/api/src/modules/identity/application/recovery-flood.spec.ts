import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecoveryService } from "./recovery-service";
import type { UserRow } from "../infrastructure/identity.store";

/**
 * PHASE-024 T5 — R-05 per-account password-reset flood gate, plain unit
 * evidence (no DB): the uniform 200 survives saturation (no oracle) while
 * the email is suppressed (no bombing), per-account isolation, and the
 * 60-minute window slide. Store + limiter modules are faked at the seam
 * (the reservation-sweep spec pattern); the HTTP-level proof over real
 * rows lands in the orchestrator's db suite.
 */

/** Manual clock — drives the 60-minute account window without sleeping. */
const hoisted = vi.hoisted(() => {
  const clockState = { nowMs: 1_700_000_000_000 };
  return {
    clockState,
    clock: {
      now: () => new Date(clockState.nowMs),
      sleep: async () => undefined,
    },
    store: {
      findUserByEmail: vi.fn<(email: string) => Promise<UserRow | undefined>>(),
      membershipOptions: vi.fn<() => Promise<unknown[]>>(),
    },
  };
});

vi.mock("../infrastructure/identity.store", () => hoisted.store);

vi.mock("../infrastructure/rate-limiter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infrastructure/rate-limiter")>();
  return {
    ...actual,
    // Fresh windows on a manual clock: per-IP effectively unbounded (the
    // per-IP leg is R-05's other half, proven at HTTP level), per-account
    // 3 per 60 min — the policy under test here.
    RESET_LIMITER: new actual.RateLimiter(hoisted.clock, 1_000, 60 * 60 * 1000),
    RESET_ACCOUNT_LIMITER: new actual.RateLimiter(hoisted.clock, 3, 60 * 60 * 1000),
  };
});

const ACCOUNT_WINDOW_MS = 60 * 60 * 1000;

function user(id: string, email: string): UserRow {
  return {
    id,
    email,
    phone: null,
    fullName: "Probe User",
    passwordHash: "x",
    status: "ACTIVE",
    locale: "ar",
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    version: 1,
  };
}

const USER_A = user("11111111-1111-4111-8111-111111111111", "victim-a@example.com");
const USER_B = user("22222222-2222-4222-8222-222222222222", "victim-b@example.com");

function makeService(): { service: RecoveryService; sendResetEmail: ReturnType<typeof vi.fn> } {
  const sendResetEmail = vi.fn(async () => undefined);
  const service = new RecoveryService({
    password: {} as never,
    sessions: {} as never,
    audit: { record: vi.fn(async () => undefined) } as never,
    sendResetEmail,
  });
  return { service, sendResetEmail };
}

beforeEach(() => {
  // Age every prior window out (jump 2× the window — nothing survives) and
  // start each case from a clean account budget.
  hoisted.clockState.nowMs += 2 * ACCOUNT_WINDOW_MS;
  hoisted.store.findUserByEmail.mockReset();
  hoisted.store.membershipOptions.mockReset();
  hoisted.store.membershipOptions.mockResolvedValue([]); // no tenant → audit no-op
});

describe("RecoveryService.requestReset — R-05 per-account flood gate", () => {
  it("sends the email while under the per-account budget (3/h, distributed IPs)", async () => {
    hoisted.store.findUserByEmail.mockResolvedValue(USER_A);
    const { service, sendResetEmail } = makeService();
    for (let i = 1; i <= 3; i += 1) {
      const result = await service.requestReset(USER_A.email, `10.0.0.${i}`);
      expect(result).toEqual({ accepted: true });
    }
    expect(sendResetEmail).toHaveBeenCalledTimes(3);
    expect(sendResetEmail).toHaveBeenCalledWith(
      USER_A.id,
      USER_A.email,
      USER_A.locale,
      expect.any(String),
    );
  });

  it("4th request within the hour: uniform 200, email SUPPRESSED (no bombing)", async () => {
    hoisted.store.findUserByEmail.mockResolvedValue(USER_A);
    const { service, sendResetEmail } = makeService();
    for (let i = 1; i <= 3; i += 1) {
      await service.requestReset(USER_A.email, `10.0.1.${i}`);
    }
    const fourth = await service.requestReset(USER_A.email, "10.0.1.4");
    expect(fourth).toEqual({ accepted: true }); // NO oracle: same shape as ever
    expect(sendResetEmail).toHaveBeenCalledTimes(3); // the 4th sent nothing
  });

  it("unknown email consumes NO account budget (uniform 200, no email)", async () => {
    const { service: unknownService, sendResetEmail: unknownEmails } = makeService();
    hoisted.store.findUserByEmail.mockResolvedValue(undefined);
    const unknown = await unknownService.requestReset("nobody@example.com", "10.0.2.0");
    expect(unknown).toEqual({ accepted: true });
    expect(unknownEmails).not.toHaveBeenCalled();
    // Budget untouched: the next KNOWN-account burst still gets its full 3.
    hoisted.store.findUserByEmail.mockResolvedValue(USER_A);
    const { service, sendResetEmail } = makeService();
    for (let i = 1; i <= 3; i += 1) {
      const result = await service.requestReset(USER_A.email, `10.0.2.${i}`);
      expect(result).toEqual({ accepted: true });
    }
    expect(sendResetEmail).toHaveBeenCalledTimes(3);
  });

  it("per-account isolation: B's saturation never touches A's budget", async () => {
    hoisted.store.findUserByEmail.mockImplementation(async (email: string) =>
      email === USER_B.email ? USER_B : USER_A,
    );
    const { service, sendResetEmail } = makeService();
    for (let i = 1; i <= 4; i += 1) {
      await service.requestReset(USER_B.email, `10.0.3.${i}`); // B saturates
    }
    const a = await service.requestReset(USER_A.email, "10.0.3.9");
    expect(a).toEqual({ accepted: true });
    expect(sendResetEmail).toHaveBeenCalledTimes(3 + 1); // B: 3, then A: 1
    expect(sendResetEmail).toHaveBeenLastCalledWith(
      USER_A.id,
      USER_A.email,
      USER_A.locale,
      expect.any(String),
    );
  });

  it("the 60-minute window slides: budget returns, email resumes", async () => {
    hoisted.store.findUserByEmail.mockResolvedValue(USER_A);
    const { service, sendResetEmail } = makeService();
    for (let i = 1; i <= 4; i += 1) {
      await service.requestReset(USER_A.email, `10.0.4.${i}`); // 4th suppressed
    }
    expect(sendResetEmail).toHaveBeenCalledTimes(3);
    hoisted.clockState.nowMs += ACCOUNT_WINDOW_MS + 1;
    const after = await service.requestReset(USER_A.email, "10.0.4.5");
    expect(after).toEqual({ accepted: true });
    expect(sendResetEmail).toHaveBeenCalledTimes(4);
  });
});
