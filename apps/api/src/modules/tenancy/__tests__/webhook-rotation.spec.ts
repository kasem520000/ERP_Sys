import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { reloadEnv } from "../../../config/env";
import {
  acceptedWebhookSecrets,
  signWebhook,
  verifyWebhookSignatureWithRotation,
  webhookSecret,
} from "../application/billing/provider-adapter";
import { WEBHOOK_TOLERANCE_SECONDS } from "../application/billing/billing-config";

/**
 * PHASE-024 T6 — S-11 dual-secret window (SECRETS_MANAGEMENT §3
 * "Zero-downtime dual-secret window"): the plain unit proof for the
 * webhook-signer rotation drill. The full drill (rotation against the
 * live ingest path) is the db spec `src/__db__/secrets-rotation.db.spec.ts`
 * run by the orchestrator; this file proves the window semantics
 * hermetically: deliveries signed with the CURRENT secret pass, then
 * deliveries signed with the PREVIOUS secret pass while
 * WEBHOOK_SIGNING_SECRET_PREVIOUS is set, and stop passing (fail closed,
 * mismatch) once the window closes. Wrong signatures are rejected under
 * every configuration.
 */

const CURRENT_SECRET = "prod-rotation-current-signing-secret";
const PREVIOUS_SECRET = "prod-rotation-previous-signing-secret";
const ENV_KEYS = ["BILLING_WEBHOOK_SECRET", "WEBHOOK_SIGNING_SECRET_PREVIOUS"] as const;

const body = JSON.stringify({
  id: "evt_rotation_1",
  type: "payment.succeeded",
  created_unix: 1_800_000_000,
  data: {
    session_ref: "cs_sbx_rotation",
    tenant_id: "t1",
    invoice_number: "BI-2026-0300",
    amount: "0.0000",
    currency: "SAR",
  },
});

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
  applyEnv({ BILLING_WEBHOOK_SECRET: undefined, WEBHOOK_SIGNING_SECRET_PREVIOUS: undefined });
});

afterAll(() => {
  applyEnv(snapshot);
});

describe("S-11 dual-secret window (webhook signer rotation)", () => {
  const at = 1_800_000_000;

  it("current-secret deliveries pass with no window configured", () => {
    applyEnv({ BILLING_WEBHOOK_SECRET: CURRENT_SECRET });
    expect(acceptedWebhookSecrets()).toEqual([CURRENT_SECRET]);
    const signature = signWebhook(body, at, webhookSecret());
    expect(verifyWebhookSignatureWithRotation(body, signature, at)).toEqual({ ok: true });
  });

  it("previous-secret deliveries pass while the window is open (zero downtime)", () => {
    applyEnv({
      BILLING_WEBHOOK_SECRET: CURRENT_SECRET,
      WEBHOOK_SIGNING_SECRET_PREVIOUS: PREVIOUS_SECRET,
    });
    // The provider may still deliver with the old secret for a while.
    const oldSigned = signWebhook(body, at, PREVIOUS_SECRET);
    expect(verifyWebhookSignatureWithRotation(body, oldSigned, at)).toEqual({ ok: true });
    // And new-secret deliveries keep passing on the same configuration.
    const newSigned = signWebhook(body, at, CURRENT_SECRET);
    expect(verifyWebhookSignatureWithRotation(body, newSigned, at)).toEqual({ ok: true });
  });

  it("closing the window (previous removed) fails closed for old-secret deliveries", () => {
    applyEnv({ BILLING_WEBHOOK_SECRET: CURRENT_SECRET });
    const oldSigned = signWebhook(body, at, PREVIOUS_SECRET);
    expect(verifyWebhookSignatureWithRotation(body, oldSigned, at)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("a signature from a WRONG secret is rejected whether or not the window is open", () => {
    const wrongSigned = signWebhook(body, at, "attacker-chosen-secret");
    applyEnv({ BILLING_WEBHOOK_SECRET: CURRENT_SECRET });
    expect(verifyWebhookSignatureWithRotation(body, wrongSigned, at)).toEqual({
      ok: false,
      reason: "mismatch",
    });
    applyEnv({
      BILLING_WEBHOOK_SECRET: CURRENT_SECRET,
      WEBHOOK_SIGNING_SECRET_PREVIOUS: PREVIOUS_SECRET,
    });
    expect(verifyWebhookSignatureWithRotation(body, wrongSigned, at)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("tampered bytes fail under the window (the tag covers the payload, not just the header)", () => {
    applyEnv({
      BILLING_WEBHOOK_SECRET: CURRENT_SECRET,
      WEBHOOK_SIGNING_SECRET_PREVIOUS: PREVIOUS_SECRET,
    });
    const oldSigned = signWebhook(body, at, PREVIOUS_SECRET);
    expect(verifyWebhookSignatureWithRotation(`${body} `, oldSigned, at)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("secret-independent verdicts surface unchanged through the rotation path", () => {
    applyEnv({
      BILLING_WEBHOOK_SECRET: CURRENT_SECRET,
      WEBHOOK_SIGNING_SECRET_PREVIOUS: PREVIOUS_SECRET,
    });
    // Malformed header.
    expect(verifyWebhookSignatureWithRotation(body, "v1=deadbeef", at)).toEqual({
      ok: false,
      reason: "malformed",
    });
    // Stale timestamp (replay window).
    const staleSigned = signWebhook(body, at, PREVIOUS_SECRET);
    const now = at + WEBHOOK_TOLERANCE_SECONDS + 10;
    expect(verifyWebhookSignatureWithRotation(body, staleSigned, now)).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("a previous secret identical to the current one collapses to a single accepted secret", () => {
    applyEnv({
      BILLING_WEBHOOK_SECRET: CURRENT_SECRET,
      WEBHOOK_SIGNING_SECRET_PREVIOUS: CURRENT_SECRET,
    });
    expect(acceptedWebhookSecrets()).toEqual([CURRENT_SECRET]);
  });
});
