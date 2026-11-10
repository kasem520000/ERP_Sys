import { randomBytes } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { reloadEnv } from "../config/env";
import { withTenant } from "../infra/db/tenant-context";
import { openSecret, sealSecret } from "../modules/identity/infrastructure/secret-envelope";
import {
  signWebhook,
  verifyWebhookSignatureWithRotation,
} from "../modules/tenancy/application/billing/provider-adapter";
import { FilesService } from "../modules/files/api/files";
import { S3FilesStore } from "../modules/files/infrastructure/s3-files.store";
import * as certs from "../modules/tax/certs/certificate-service";
import { ensureTestDb, superuserClient } from "./test-db";
import { setupPackTenant, X_ACTOR, type PackTenant } from "./tax/fixtures";

/**
 * PHASE-024 T6 — the SECRETS-ROTATION DRILL (PHASE-024 §5 T6;
 * SECRETS_MANAGEMENT §3 rotation policy), executed as an automated db spec
 * so the drill is REPRODUCIBLE PROOF, not a narrative. Four blocks:
 *
 * - S-01 DB app credentials: `ALTER ROLE erp_app PASSWORD` via the
 *   superuser client → a NEW connection with the new password works → the
 *   OLD password fails (the canary) → the original password is restored
 *   and re-verified. The 90-day procedure (§3 S-01 row) rehearsed.
 * - S-03-class app secret (IDENTITY_SECRET_KEY): seal under key A →
 *   rotate env to key B + `IDENTITY_SECRET_KEY_PREVIOUS`=A → the sealed
 *   value stays readable through the dual-accept window → remove PREVIOUS
 *   → openSecret fails closed (window closed). The 180-day dual-accept
 *   procedure (§3 S-03 row) rehearsed end-to-end through the env
 *   singleton exactly as a rolling restart would see it.
 * - S-11 webhook signer: the same window shape for the billing webhook
 *   HMAC (`WEBHOOK_SIGNING_SECRET_PREVIOUS` — provider-coordinated
 *   zero-downtime rotation, §3 S-11 row).
 * - S-10 certificate rotation: one enroll→rotate cycle through the real
 *   certificate service, against the FAKE-AUTHORITY HARNESS ONLY
 *   (adapter `fake-zatca` — the harness in tests/authorities/fake-zatca;
 *   throwaway synthetic PEM material, never production authority
 *   material, §3 S-10 row + PHASE-024 §2 scope item 5), asserting the
 *   `rotated_from_id` chain, predecessor revocation, and the usage-audit
 *   rows (§6.3 usage audit).
 *
 * TIMINGS: every block records wall-clock ms in `timings` (asserted
 * present by the final test and printed for the drill record — the drill
 * record cites these numbers from this spec's output:
 * docs/operations/drills/2026-11-06-secrets-rotation.md).
 *
 * The §7 revoke-first checklist is walked TABLETOP-STYLE in the drill
 * record (this spec is the execution, not the incident rehearsal).
 */

const files = new FilesService(new S3FilesStore());

/** Drill timings (ms) — cited by the drill record from this run's output. */
const timings: Record<string, number> = {};

const S03_ENV_KEYS = [
  "IDENTITY_SECRET_KEY",
  "IDENTITY_SECRET_KEY_ID",
  "IDENTITY_SECRET_KEY_PREVIOUS",
  "IDENTITY_SECRET_KEY_ID_PREVIOUS",
] as const;

const S11_ENV_KEYS = ["BILLING_WEBHOOK_SECRET", "WEBHOOK_SIGNING_SECRET_PREVIOUS"] as const;

let envSnapshot: Record<string, string | undefined>;

/** Apply an env overlay (undefined = unset) through the live singleton. */
function applyEnv(
  keys: readonly string[],
  overlay: Record<string, string | undefined>,
): void {
  for (const key of keys) {
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

let tenant: PackTenant;

beforeAll(() => {
  ensureTestDb();
  envSnapshot = Object.fromEntries(
    [...S03_ENV_KEYS, ...S11_ENV_KEYS].map((key) => [key, process.env[key]]),
  );
});

afterAll(() => {
  // Restore the ambient environment exactly as the suite found it — the
  // drill must never leak rotation state into other specs.
  applyEnv([...S03_ENV_KEYS, ...S11_ENV_KEYS], envSnapshot);
  // The timings the drill record cites (attached to the run transcript).
  console.log("[secrets-rotation-drill] timings (ms):", JSON.stringify(timings));
});

describe("S-01 DB app credentials (ALTER ROLE rotation + old-password canary)", () => {
  it("rotates the app-role password, proves the old one fails, then restores it", async () => {
    const start = Date.now();
    try {
      const state = ensureTestDb();
      const url = new URL(state.databaseUrl);
      const role = url.username;
      const originalPassword = decodeURIComponent(url.password);
      // Generated from a URL-safe alphabet: safe to embed in the ALTER ROLE
      // literal (no quoting hazards, no injection surface).
      const rotatedPassword = `drill${randomBytes(18).toString("base64url")}`;

      const su = await superuserClient();
      try {
        // 0. The ORIGINAL credential works before anything is touched.
        const baseline = new Client({ connectionString: state.databaseUrl });
        await baseline.connect();
        await baseline.query("SELECT 1");
        await baseline.end();

        // 1. Rotate: superuser sets the new password (§3 S-01 procedure:
        // create/deploy new value → retire old; here the role is reused so
        // the drill proves the mechanism + the canary).
        await su.query(`ALTER ROLE ${role} PASSWORD '${rotatedPassword}'`);

        // 2. A NEW connection with the NEW password works.
        url.password = rotatedPassword;
        const rotatedUrl = url.toString();
        const freshClient = new Client({ connectionString: rotatedUrl });
        await freshClient.connect();
        await freshClient.query("SELECT 1");
        await freshClient.end();

        // 3. The OLD password fails — the revoke-first canary (§7 step 6:
        // confirm the old secret fails authentication attempts).
        const oldClient = new Client({ connectionString: state.databaseUrl });
        await expect(oldClient.connect()).rejects.toThrow(/password authentication failed/i);
        await oldClient.end().catch(() => undefined);
      } finally {
        // 4. Restore the original password FIRST (the suite's other specs
        // open app-role connections) and verify the restore.
        await su.query(`ALTER ROLE ${role} PASSWORD '${originalPassword}'`);
        await su.end();
      }

      const restored = new Client({ connectionString: state.databaseUrl });
      await restored.connect();
      await restored.query("SELECT 1");
      await restored.end();
    } finally {
      // Recorded even on failure — the drill record cites honest numbers.
      timings["s01-db-app-credentials"] = Date.now() - start;
    }
  });
});

describe("S-03 identity envelope key (dual-accept window, then fail closed)", () => {
  const KEY_A = randomBytes(32).toString("base64");
  const KEY_B = randomBytes(32).toString("base64");
  const payload = "drill-totp-seed-GEZDGNBVGY3TQOJQ";

  it("seals under key A, reads it through the window, fails closed when it closes", () => {
    const start = Date.now();
    // Pre-rotation: current key = A.
    applyEnv(S03_ENV_KEYS, {
      IDENTITY_SECRET_KEY: KEY_A,
      IDENTITY_SECRET_KEY_ID: "drill-a",
    });
    const sealedUnderOldKey = sealSecret(payload);
    expect(sealedUnderOldKey.split(":")[1]).toBe("drill-a");

    // Rotation: current = B, previous = A — the window keeps sealed-in-
    // flight secrets readable (SECRETS §3 S-03 dual-accept).
    applyEnv(S03_ENV_KEYS, {
      IDENTITY_SECRET_KEY: KEY_B,
      IDENTITY_SECRET_KEY_ID: "drill-b",
      IDENTITY_SECRET_KEY_PREVIOUS: KEY_A,
      IDENTITY_SECRET_KEY_ID_PREVIOUS: "drill-a",
    });
    expect(openSecret(sealedUnderOldKey)).toBe(payload);
    // New seals move onto the current key (the window can close).
    const sealedUnderNewKey = sealSecret("drill-new-write");
    expect(sealedUnderNewKey.split(":")[1]).toBe("drill-b");

    // Window closed (previous removed): old-key envelopes FAIL CLOSED.
    applyEnv(S03_ENV_KEYS, {
      IDENTITY_SECRET_KEY: KEY_B,
      IDENTITY_SECRET_KEY_ID: "drill-b",
      IDENTITY_SECRET_KEY_PREVIOUS: undefined,
      IDENTITY_SECRET_KEY_ID_PREVIOUS: undefined,
    });
    expect(() => openSecret(sealedUnderOldKey)).toThrow(
      /secret envelope key id drill-a is not active \(rotation required\)/,
    );
    // ...while current-key envelopes keep working (no disruption beyond
    // the old-key retirement).
    expect(openSecret(sealedUnderNewKey)).toBe("drill-new-write");
    timings["s03-identity-envelope"] = Date.now() - start;
  });
});

describe("S-11 webhook signer (dual-secret window)", () => {
  it("accepts old-secret deliveries through the window, rejects them after close", () => {
    const start = Date.now();
    const CURRENT = `drill-current-${randomBytes(12).toString("base64url")}`;
    const PREVIOUS = `drill-previous-${randomBytes(12).toString("base64url")}`;
    const rawBody = JSON.stringify({
      id: "evt_drill_rotation",
      type: "payment.succeeded",
      created_unix: 1,
      data: { session_ref: "cs_drill", tenant_id: "t1", invoice_number: "BI-1", amount: "0", currency: "SAR" },
    });
    const at = 1_800_000_000;

    // Provider still signs with the OLD secret during the cutover.
    const oldSigned = signWebhook(rawBody, at, PREVIOUS);

    // Window open: both old- and new-secret deliveries verify.
    applyEnv(S11_ENV_KEYS, {
      BILLING_WEBHOOK_SECRET: CURRENT,
      WEBHOOK_SIGNING_SECRET_PREVIOUS: PREVIOUS,
    });
    expect(verifyWebhookSignatureWithRotation(rawBody, oldSigned, at)).toEqual({ ok: true });
    expect(
      verifyWebhookSignatureWithRotation(rawBody, signWebhook(rawBody, at, CURRENT), at),
    ).toEqual({ ok: true });

    // Window closed: old-secret deliveries fail closed (mismatch), and a
    // signature from a secret that was NEVER accepted is rejected in both
    // configurations.
    applyEnv(S11_ENV_KEYS, {
      BILLING_WEBHOOK_SECRET: CURRENT,
      WEBHOOK_SIGNING_SECRET_PREVIOUS: undefined,
    });
    expect(verifyWebhookSignatureWithRotation(rawBody, oldSigned, at)).toEqual({
      ok: false,
      reason: "mismatch",
    });
    expect(
      verifyWebhookSignatureWithRotation(rawBody, signWebhook(rawBody, at, "never-configured"), at),
    ).toEqual({ ok: false, reason: "mismatch" });
    timings["s11-webhook-signer"] = Date.now() - start;
  });
});

describe("S-10 certificate rotation (fake-authority harness only, never prod material)", () => {
  const PEM = `-----BEGIN CERTIFICATE-----\n${"K".repeat(64)}\n${"D".repeat(64)}\n-----END CERTIFICATE-----`;

  it("enrolls → rotates via the service: rotated_from chain, revoked predecessor, usage audit rows", async () => {
    const start = Date.now();
    tenant = await setupPackTenant("SA");

    // Enroll the predecessor (throwaway synthetic material for the
    // fake-zatca harness adapter — production authority material never
    // enters a drill: PHASE-024 §2 scope item 5, SECRETS §6).
    const first = await withTenant(tenant.tenantId, () =>
      certs.enrollCertificate(files, {
        countryCode: "SA",
        adapterId: "fake-zatca",
        label: "rotation drill (predecessor)",
        keyVersion: "drill-r1",
        pem: PEM,
        notBefore: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        notAfter: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        actorId: X_ACTOR,
      }),
    );
    expect(first.status).toBe("ACTIVE");
    expect(first.secretPath).toMatch(/^einvoicing\/sa\//);

    // One signing use on the predecessor so the rotation's usage-audit
    // chain spans both key versions.
    await withTenant(tenant.tenantId, () =>
      certs.useForSigning(files, {
        certificateId: first.id,
        submissionId: crypto.randomUUID(),
      }),
    );

    // Rotate: the successor chains via rotatedFromId and the predecessor
    // is REVOKED (never deleted — §6.4: rotation follows the authority's
    // re-enrollment process; here the fake-authority harness stands in).
    const second = await withTenant(tenant.tenantId, () =>
      certs.enrollCertificate(files, {
        countryCode: "SA",
        adapterId: "fake-zatca",
        label: "rotation drill (successor)",
        keyVersion: "drill-r2",
        pem: PEM,
        notBefore: new Date().toISOString(),
        notAfter: new Date(Date.now() + 180 * 86_400_000).toISOString(),
        actorId: X_ACTOR,
        rotatedFromId: first.id,
      }),
    );
    expect(second.rotatedFromId).toBe(first.id);
    const predecessor = await withTenant(tenant.tenantId, () => certs.findCertificate(first.id));
    expect(predecessor.status).toBe("REVOKED");

    // The signing path refuses the REVOKED predecessor (§6.2 fail-closed)
    // and serves the successor, writing usage-audit rows for it.
    await expect(
      withTenant(tenant.tenantId, () =>
        certs.useForSigning(files, {
          certificateId: first.id,
          submissionId: crypto.randomUUID(),
        }),
      ),
    ).rejects.toThrow(/REVOKED — signing refused/);
    const used = await withTenant(tenant.tenantId, () =>
      certs.useForSigning(files, {
        certificateId: second.id,
        submissionId: crypto.randomUUID(),
      }),
    );
    expect(used.keyVersion).toBe("drill-r2");

    // Usage audit rows: one SIGN row per accepted use, none for the
    // refused one (the refusal happened BEFORE any decrypt/usage row).
    const usageRows = await withTenant(tenant.tenantId, async () => {
      const { requireTenantContext } = await import("../infra/db/tenant-context");
      const { sql } = await import("drizzle-orm");
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT certificate_id AS "certificateId", key_version AS "keyVersion", operation
        FROM e_invoicing_certificate_usage
        WHERE certificate_id IN (${first.id}::uuid, ${second.id}::uuid)
        ORDER BY used_at
      `);
      return rows.rows as unknown as {
        certificateId: string;
        keyVersion: string;
        operation: string;
      }[];
    });
    expect(usageRows).toHaveLength(2); // 1× predecessor (pre-rotation) + 1× successor
    expect(usageRows.filter((row) => row.certificateId === first.id)).toHaveLength(1);
    expect(usageRows.filter((row) => row.certificateId === second.id)).toHaveLength(1);
    expect(usageRows.every((row) => row.operation === "SIGN")).toBe(true);

    // The metadata surface never carries key material (§6.1).
    const list = await withTenant(tenant.tenantId, () => certs.listCertificates());
    expect(JSON.stringify(list.find((row) => row.id === second.id))).not.toContain(
      "BEGIN CERTIFICATE",
    );
    timings["s10-certificate-rotation"] = Date.now() - start;
  });
});

describe("drill record", () => {
  it("timings were recorded for all four drill blocks (cited by the drill record)", () => {
    expect(Object.keys(timings).sort()).toEqual([
      "s01-db-app-credentials",
      "s03-identity-envelope",
      "s10-certificate-rotation",
      "s11-webhook-signer",
    ]);
    for (const value of Object.values(timings)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});
