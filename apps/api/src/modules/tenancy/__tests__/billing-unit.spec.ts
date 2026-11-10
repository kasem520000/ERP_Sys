import { describe, expect, it } from "vitest";

import {
  buildWebhookEvent,
  signWebhook,
  verifyWebhookSignature,
  webhookSecret,
} from "../application/billing/provider-adapter";
import {
  GRACE_DAYS,
  MAX_DUNNING_STEPS,
  TRIAL_DAYS,
  WEBHOOK_TOLERANCE_SECONDS,
  currentMonthPeriod,
  limitOf,
  plusDays,
} from "../application/billing/billing-config";

/**
 * PHASE-014 billing unit specs (PHASE-014 §6): the webhook signature
 * scheme (HMAC-SHA256 `t=…,v1=…`, constant-time verify, replay window),
 * the deterministic event ids (duplicate-delivery idempotency input), the
 * PLACEHOLDER config surface, and the §6 integer threshold forms. The
 * lifecycle/checkout/limits behaviors against a real database live in the
 * db suite (`src/__db__/billing/*`).
 */

describe("billing webhook signatures (PHASE-014 §2.2)", () => {
  const body = JSON.stringify({
    id: "evt_test_1",
    type: "payment.succeeded",
    created_unix: 1_700_000_000,
    data: { session_ref: "cs_sbx_x", tenant_id: "t1", invoice_number: "BI-2026-0001", amount: "0.0000", currency: "SAR" },
  });

  it("round-trips: sign → verify (ok)", () => {
    const at = 1_700_000_000;
    const signature = signWebhook(body, at, webhookSecret());
    const verdict = verifyWebhookSignature(body, signature, webhookSecret(), at);
    expect(verdict).toEqual({ ok: true });
  });

  it("rejects a tampered body (mismatch)", () => {
    const at = 1_700_000_000;
    const signature = signWebhook(body, at, webhookSecret());
    const verdict = verifyWebhookSignature(`${body} `, signature, webhookSecret(), at);
    expect(verdict).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a wrong secret (mismatch)", () => {
    const at = 1_700_000_000;
    const signature = signWebhook(body, at, "another-secret");
    const verdict = verifyWebhookSignature(body, signature, webhookSecret(), at);
    expect(verdict).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a stale timestamp outside the tolerance window (replay)", () => {
    const at = 1_700_000_000;
    const signature = signWebhook(body, at, webhookSecret());
    const now = at + WEBHOOK_TOLERANCE_SECONDS + 10;
    const verdict = verifyWebhookSignature(body, signature, webhookSecret(), now);
    expect(verdict).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects malformed headers (malformed)", () => {
    for (const bad of ["", "v1=deadbeef", "t=abc,v1=xyz", "t=1700000000", "t=1700000000,v1=nothex"]) {
      const verdict = verifyWebhookSignature(body, bad, webhookSecret(), 1_700_000_000);
      expect(verdict).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("event ids are unique per delivery; a delivery is internally consistent", () => {
    const a = buildWebhookEvent({
      sessionRef: "cs_sbx_same",
      tenantId: "t1",
      invoiceNumber: "BI-2026-0002",
      amount: "0.0000",
      currency: "SAR",
      outcome: "succeeded",
      atUnixSeconds: 1_700_000_000,
    });
    const b = buildWebhookEvent({
      sessionRef: "cs_sbx_same",
      tenantId: "t1",
      invoiceNumber: "BI-2026-0002",
      amount: "0.0000",
      currency: "SAR",
      outcome: "succeeded",
      atUnixSeconds: 1_700_000_500,
    });
    // Every delivery is a NEW event (real-provider semantics — dunning
    // retries are separate deliveries); the ingest dedupes by the id in
    // the payload, so re-posting the SAME bytes is the duplicate no-op.
    expect(a.event.id).not.toBe(b.event.id);
    expect(a.event.type).toBe("payment.succeeded");
    expect(a.event.id).toMatch(/^evt_[0-9a-f]{24}$/);
    expect(a.event.data.session_ref).toBe("cs_sbx_same");
    expect(a.event.data.tenant_id).toBe("t1");
  });

  it("built events verify against their own signature", () => {
    const built = buildWebhookEvent({
      sessionRef: "cs_sbx_roundtrip",
      tenantId: "t1",
      invoiceNumber: "BI-2026-0003",
      amount: "0.0000",
      currency: "SAR",
      outcome: "succeeded",
      atUnixSeconds: (Date.now() / 1000) | 0,
    });
    const verdict = verifyWebhookSignature(
      built.rawBody,
      built.signature,
      webhookSecret(),
      (Date.now() / 1000) | 0,
    );
    expect(verdict).toEqual({ ok: true });
  });
});

describe("billing configuration (PLACEHOLDER ⚠ OQ-002)", () => {
  it("carries the SUBSCRIPTION §7/§8 proposal defaults", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(GRACE_DAYS).toBe(14);
    expect(MAX_DUNNING_STEPS).toBe(2);
    expect(WEBHOOK_TOLERANCE_SECONDS).toBe(300);
  });

  it("period keys and lifecycle arithmetic", () => {
    expect(currentMonthPeriod(new Date("2026-11-05T10:00:00Z"))).toBe("2026-11");
    const from = new Date("2026-11-05T10:00:00Z");
    expect(plusDays(from, 14).toISOString()).toBe("2026-11-19T10:00:00.000Z");
  });

  it("limitOf: numbers pass, unlimited passes, unknowns fail open", () => {
    expect(limitOf({ users: 3 }, "users")).toBe(3);
    expect(limitOf({ branches: "unlimited" }, "branches")).toBe("unlimited");
    expect(limitOf({ users: "Unlimited" }, "users")).toBe("unlimited");
    expect(limitOf({}, "pos_terminals")).toBe("unlimited");
    expect(limitOf({ users: Number.NaN }, "users")).toBe("unlimited");
  });

  it("§6 integer threshold forms match Math.ceil for the plan ceilings", () => {
    // (4n+4)/5|0 == ceil(0.8n) for the seeded ceilings 3/10/50 and edges.
    for (const n of [1, 2, 3, 4, 5, 6, 10, 50, 5000]) {
      const integerForm = ((n * 4 + 4) / 5) | 0;
      // eslint-disable-next-line no-restricted-properties -- the reference oracle this test verifies against (integer threshold form), not money math (ADR-0009).
      const expected = Math.ceil(n * 0.8);
      expect(integerForm).toBe(expected);
    }
  });
});
