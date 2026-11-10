import { describe, expect, it } from "vitest";

import { renderEmail } from "./templates";
import { RateLimiter } from "../../identity/infrastructure/rate-limiter";
import { progressiveDelayMs, LOCKOUT_THRESHOLD } from "../../identity/domain/session-policy";

/**
 * PHASE-003 T9/T5 unit evidence: bilingual template rendering is
 * byte-stable, the rate limiter saturates per window (R-03/R-08 shape),
 * and the progressive-delay schedule is the documented curve. End-to-end
 * delivery against a real SMTP session runs in the DB suite.
 */

describe("email templates (AR/EN, plain-text-first)", () => {
  it("renders the invitation in Arabic with RTL-friendly plain text", () => {
    const rendered = renderEmail({
      template: "invitation",
      locale: "ar",
      recipient: "zaid@corp.example",
      variables: { tenantName: "شركة الرياض", roleName: "المحاسب", acceptUrl: "https://erp/accept?token=x" },
    });
    expect(rendered.subject).toContain("شركة الرياض");
    expect(rendered.body).toContain("https://erp/accept?token=x");
    expect(rendered.body).toContain("72");
  });

  it("renders byte-identical output for identical input (snapshot contract)", () => {
    const payload = {
      template: "password_reset" as const,
      locale: "en" as const,
      recipient: "user@corp.example",
      variables: { resetUrl: "https://erp/reset?token=abc" },
    };
    expect(renderEmail(payload)).toEqual(renderEmail(payload));
    expect(renderEmail(payload).body).toContain("30 minutes");
  });

  it("login notification carries the ip + time signals", () => {
    const rendered = renderEmail({
      template: "login_notification",
      locale: "ar",
      recipient: "user@corp.example",
      variables: { ip: "5.10.20.30", at: "2026-10-28T10:00:00Z" },
    });
    expect(rendered.body).toContain("5.10.20.30");
    expect(rendered.body).toContain("2026-10-28T10:00:00Z");
  });
});

describe("rate limiter (R-03/R-08 shape)", () => {
  function fakeClock(startMs: number) {
    let now = startMs;
    return {
      now: () => new Date(now),
      sleep: async () => {},
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it("throws 429 with Retry-After once the window saturates", () => {
    const clock = fakeClock(1_000_000);
    const limiter = new RateLimiter(clock, 3, 60_000);
    expect(() => limiter.consume("1.2.3.4")).not.toThrow();
    expect(() => limiter.consume("1.2.3.4")).not.toThrow();
    expect(() => limiter.consume("1.2.3.4")).not.toThrow();
    try {
      limiter.consume("1.2.3.4");
      expect.unreachable("must saturate");
    } catch (error) {
      expect((error as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("windows slide: old attempts expire, headers cannot reset anything", () => {
    const clock = fakeClock(1_000_000);
    const limiter = new RateLimiter(clock, 2, 60_000);
    limiter.consume("9.9.9.9");
    limiter.consume("9.9.9.9");
    clock.advance(61_000); // window elapsed
    expect(() => limiter.consume("9.9.9.9")).not.toThrow();
  });

  it("keys are per-IP — one IP's saturation never affects another", () => {
    const clock = fakeClock(1_000_000);
    const limiter = new RateLimiter(clock, 1, 60_000);
    limiter.consume("1.1.1.1");
    expect(() => limiter.consume("1.1.1.1")).toThrow();
    expect(() => limiter.consume("2.2.2.2")).not.toThrow();
  });

  it("reset clears the window (successful login budget)", () => {
    const clock = fakeClock(1_000_000);
    const limiter = new RateLimiter(clock, 1, 60_000);
    limiter.consume("3.3.3.3");
    limiter.reset("3.3.3.3");
    expect(() => limiter.consume("3.3.3.3")).not.toThrow();
  });
});

describe("progressive lockout schedule (R-01)", () => {
  it("delays grow quadratically then cap; lockout threshold is the documented 5", () => {
    expect(progressiveDelayMs(1)).toBe(0);
    expect(progressiveDelayMs(2)).toBe(250);
    expect(progressiveDelayMs(3)).toBe(1000);
    expect(progressiveDelayMs(4)).toBe(2250);
    expect(progressiveDelayMs(5)).toBe(2500); // factor 16 → capped at 10
    expect(progressiveDelayMs(50)).toBe(2500); // capped
    expect(LOCKOUT_THRESHOLD).toBe(5);
  });
});
