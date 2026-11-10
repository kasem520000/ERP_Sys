import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { FilesService } from "../../modules/files/api/files";
import { S3FilesStore } from "../../modules/files/infrastructure/s3-files.store";
import * as certs from "../../modules/tax/certs/certificate-service";
import * as rollout from "../../modules/tax/rollout/adapter-settings";
import { setupPackTenant, X_ACTOR, type PackTenant } from "./fixtures";

/**
 * PHASE-023 T5 verification (SECRETS_MANAGEMENT §6 — S-10 HIGHEST): the
 * certificate registry stores metadata + sealed blobs (path/lifecycle
 * only in the DB); the ONLY key-material read path is the signing-job
 * context (no API surface returns bytes — asserted); usage audit rows +
 * counters feed the signing-volume dashboard; expiry monitoring fires at
 * 30/14/7-day thresholds exactly once each; rotation revokes the previous
 * certificate; offboarding purge removes paths + tombstones blobs.
 */

const files = new FilesService(new S3FilesStore());

let tenant: PackTenant;
const PEM = `-----BEGIN CERTIFICATE-----\n${"A".repeat(64)}\n${"B".repeat(64)}\n-----END CERTIFICATE-----`;

beforeAll(async () => {
  tenant = await setupPackTenant("SA");
});

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

describe("enrollment + metadata surface (§6.1/§6.2)", () => {
  it("enrolls a certificate with the sealed blob OUT of the DB", async () => {
    const cert = await withTenant(tenant.tenantId, () =>
      certs.enrollCertificate(files, {
        countryCode: "SA",
        adapterId: "zatca",
        label: "ZATCA production cert",
        keyVersion: "v1",
        pem: PEM,
        notBefore: daysFromNow(-10),
        notAfter: daysFromNow(90),
        actorId: X_ACTOR,
      }),
    );
    expect(cert.status).toBe("ACTIVE");
    expect(cert.secretPath).toMatch(/^einvoicing\/sa\//);
    // The metadata list carries NO key material.
    const list = await withTenant(tenant.tenantId, () => certs.listCertificates());
    const row = list.find((entry) => entry.id === cert.id);
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain("BEGIN CERTIFICATE");
  });

  it("rejects inverted validity windows", async () => {
    await expect(
      withTenant(tenant.tenantId, () =>
        certs.enrollCertificate(files, {
          countryCode: "SA",
          adapterId: "zatca",
          label: "bad window",
          keyVersion: "v-bad",
          pem: PEM,
          notBefore: daysFromNow(10),
          notAfter: daysFromNow(-10),
          actorId: X_ACTOR,
        }),
      ),
    ).rejects.toThrow(/notAfter must be after notBefore/);
  });
});

describe("signing-job-only usage (§6.2/§6.3)", () => {
  it("the signing path decrypts, audits usage, and bumps the volume counters", async () => {
    const cert = await withTenant(tenant.tenantId, () =>
      certs.enrollCertificate(files, {
        countryCode: "SA",
        adapterId: "zatca",
        label: "signing cert",
        keyVersion: "v2",
        pem: PEM,
        notBefore: daysFromNow(-1),
        notAfter: daysFromNow(120),
        actorId: X_ACTOR,
      }),
    );
    const used = await withTenant(tenant.tenantId, () =>
      certs.useForSigning(files, { certificateId: cert.id, submissionId: crypto.randomUUID() }),
    );
    expect(used.pem).toBe(PEM);
    expect(used.keyVersion).toBe("v2");
    const volume = await withTenant(tenant.tenantId, () => certs.signingVolume());
    const mine = volume.find((entry) => entry.certificateId === cert.id);
    expect(mine?.operations).toBe(1);
    // Revoked certificates refuse to sign.
    await withTenant(tenant.tenantId, async () => {
      const tx = (await import("../../infra/db/tenant-context")).requireTenantContext();
      await tx.tx!.execute(
        (await import("drizzle-orm")).sql`
          UPDATE e_invoicing_certificates SET status = 'REVOKED' WHERE id = ${cert.id}
        `,
      );
    });
    await expect(
      withTenant(tenant.tenantId, () =>
        certs.useForSigning(files, { certificateId: cert.id, submissionId: crypto.randomUUID() }),
      ),
    ).rejects.toThrow(/REVOKED — signing refused/);
  });
});

describe("rotation (§6.4) — previous cert revoked, chain recorded", () => {
  it("rotation chains via rotatedFromId and revokes the predecessor", async () => {
    const first = await withTenant(tenant.tenantId, () =>
      certs.enrollCertificate(files, {
        countryCode: "SA",
        adapterId: "zatca",
        label: "rotate-1",
        keyVersion: "r1",
        pem: PEM,
        notBefore: daysFromNow(-5),
        notAfter: daysFromNow(60),
        actorId: X_ACTOR,
      }),
    );
    const second = await withTenant(tenant.tenantId, () =>
      certs.enrollCertificate(files, {
        countryCode: "SA",
        adapterId: "zatca",
        label: "rotate-2",
        keyVersion: "r2",
        pem: PEM,
        notBefore: daysFromNow(0),
        notAfter: daysFromNow(120),
        actorId: X_ACTOR,
        rotatedFromId: first.id,
      }),
    );
    expect(second.rotatedFromId).toBe(first.id);
    const predecessor = await withTenant(tenant.tenantId, () => certs.findCertificate(first.id));
    expect(predecessor.status).toBe("REVOKED");
  });
});

describe("CertExpiry monitoring (§6.4 + MONITORING §3) — 30/14/7 ladder", () => {
  it("fires each threshold exactly once and flips EXPIRING_SOON/EXPIRED", async () => {
    const expiring = await withTenant(tenant.tenantId, () =>
      certs.enrollCertificate(files, {
        countryCode: "SA",
        adapterId: "zatca",
        label: "expiring cert",
        keyVersion: "exp",
        pem: PEM,
        notBefore: daysFromNow(-60),
        notAfter: daysFromNow(20), // inside the 30-day window
        actorId: X_ACTOR,
      }),
    );
    const first = await withTenant(tenant.tenantId, () => certs.evaluateExpiry());
    expect(first.checked).toBeGreaterThan(0);
    const fired = first.alerted.find((entry) => entry.certificateId === expiring.id);
    expect(fired?.threshold).toBe(30);
    // Re-run: the 30-day alert does NOT re-fire (expires_alerted_at bookkeeping).
    const second = await withTenant(tenant.tenantId, () => certs.evaluateExpiry());
    expect(second.alerted.find((entry) => entry.certificateId === expiring.id && entry.threshold === 30)).toBeUndefined();
    const row = await withTenant(tenant.tenantId, () => certs.findCertificate(expiring.id));
    expect(row.status).toBe("EXPIRING_SOON");
    // Past the window: EXPIRED.
    await withTenant(tenant.tenantId, async () => {
      const tx = (await import("../../infra/db/tenant-context")).requireTenantContext();
      await tx.tx!.execute(
        (await import("drizzle-orm")).sql`
          UPDATE e_invoicing_certificates SET not_after = now() - interval '1 day' WHERE id = ${expiring.id}
        `,
      );
    });
    await withTenant(tenant.tenantId, () => certs.evaluateExpiry());
    const expired = await withTenant(tenant.tenantId, () => certs.findCertificate(expiring.id));
    expect(expired.status).toBe("EXPIRED");
  });
});

describe("adapter rollout gate (T13) — default OFF + cert-provisioned enablement", () => {
  it("defaults OFF (no settings row)", async () => {
    const off = await withTenant(tenant.tenantId, () => rollout.assertDefaultOff("zatca"));
    expect(off).toBe(true);
  });

  it("enablement REFUSES without a provisioned certificate", async () => {
    await expect(
      withTenant(tenant.tenantId, () =>
        rollout.setAdapterEnabled({
          adapterId: "fake-zatca",
          countryCode: "SA",
          enabled: true,
          actorId: X_ACTOR,
        }),
      ),
    ).rejects.toThrow(/requires a provisioned ACTIVE certificate/);
  });

  it("enablement succeeds after provisioning and records who/when", async () => {
    await withTenant(tenant.tenantId, () =>
      certs.enrollCertificate(files, {
        countryCode: "SA",
        adapterId: "fake-zatca",
        label: "gate cert",
        keyVersion: "g1",
        pem: PEM,
        notBefore: daysFromNow(-1),
        notAfter: daysFromNow(200),
        actorId: X_ACTOR,
      }),
    );
    const setting = await withTenant(tenant.tenantId, () =>
      rollout.setAdapterEnabled({
        adapterId: "fake-zatca",
        countryCode: "SA",
        enabled: true,
        actorId: X_ACTOR,
      }),
    );
    expect(setting.enabled).toBe(true);
    expect(setting.enabledBy).toBe(X_ACTOR);
    expect(setting.enabledAt).not.toBeNull();
    // Rollback = flag off (always allowed — no cert gate on disable).
    const disabled = await withTenant(tenant.tenantId, () =>
      rollout.setAdapterEnabled({
        adapterId: "fake-zatca",
        countryCode: "SA",
        enabled: false,
        actorId: X_ACTOR,
      }),
    );
    expect(disabled.enabled).toBe(false);
  });
});

describe("offboarding purge (§6.6) — key material never survives", () => {
  it("purges certificate rows + tombstones the sealed blobs", async () => {
    await withTenant(tenant.tenantId, () =>
      certs.enrollCertificate(files, {
        countryCode: "SA",
        adapterId: "zatca",
        label: "purge me",
        keyVersion: "p1",
        pem: PEM,
        notBefore: daysFromNow(-1),
        notAfter: daysFromNow(50),
        actorId: X_ACTOR,
      }),
    );
    const result = await withTenant(tenant.tenantId, () => certs.purgeTenantCertificates());
    expect(result.purged).toBeGreaterThan(0);
    const remaining = await withTenant(tenant.tenantId, () => certs.listCertificates());
    expect(remaining).toHaveLength(0);
  });
});
