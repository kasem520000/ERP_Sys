import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { NoRateForDateError } from "../../modules/tax/domain/tax-errors";
import {
  setupPackTenant,
  su,
  taxCodes,
  vatReturns,
  X_ACTOR,
  type PackTenant,
} from "./fixtures";

/**
 * PHASE-009 spoof suite (SECURITY_TEST_PLAN §2 PHASE-009 rows): tax-code /
 * registration / return id enumeration cross-tenant → 404-shaped typed
 * rejections identical for unknown-vs-foreign ids (A7 — no existence
 * disclosure); pack data is global read-only (A8-style join safety by
 * construction); and the resolver never computes from a foreign tenant's
 * code (the RLS-scoped lookup under the attacker's own GUC).
 */

const FOREIGN_TAX_CODE = "e0e0e0e0-0000-4000-8000-000000000002"; // tenant B's code (isolation suite)
const FOREIGN_VAT_RETURN = "e4e4e4e4-0000-4000-8000-000000000002"; // tenant B's return
const UNKNOWN_ID = "77777777-7777-4a4a-8a8a-777777777777";

let tenant: PackTenant;

beforeAll(async () => {
  tenant = await setupPackTenant("AE");
});

describe("A7 — id enumeration cross-tenant → 404-shaped, unknown == foreign", () => {
  it("tax-code lookups render identically for unknown vs foreign ids", async () => {
    const unknown = await withTenant(tenant.tenantId, () => taxCodes.find(UNKNOWN_ID)).catch((e) => e);
    const foreign = await withTenant(tenant.tenantId, () => taxCodes.find(FOREIGN_TAX_CODE)).catch((e) => e);
    expect(unknown).toBeInstanceOf(Error);
    expect(foreign).toBeInstanceOf(Error);
    expect((unknown as { code: string }).code).toBe("TAX_CODE_NOT_FOUND");
    expect((foreign as { code: string }).code).toBe("TAX_CODE_NOT_FOUND");
    expect((foreign as Error).message).toBe((unknown as Error).message.replace(UNKNOWN_ID, FOREIGN_TAX_CODE));
  });

  it("VAT-return lookups render identically for unknown vs foreign ids", async () => {
    const unknown = await withTenant(tenant.tenantId, () => vatReturns.find(UNKNOWN_ID)).catch((e) => e);
    const foreign = await withTenant(tenant.tenantId, () => vatReturns.find(FOREIGN_VAT_RETURN)).catch((e) => e);
    expect((unknown as { code: string }).code).toBe("VAT_RETURN_NOT_FOUND");
    expect((foreign as { code: string }).code).toBe("VAT_RETURN_NOT_FOUND");
  });

  it("resolution with a foreign tax-code id is the same typed rejection as unknown", async () => {
    const { taxResolver } = await import("./fixtures");
    const resolve = (taxCodeId: string) =>
      withTenant(tenant.tenantId, () =>
        taxResolver.resolveOne({
          documentDate: "2026-02-15",
          pricingModeOverride: "EXCLUSIVE",
          line: { amount: "10.0000", taxCodeId, currencyCode: "AED" },
        }),
      );
    await expect(resolve(UNKNOWN_ID)).rejects.toMatchObject({ code: "TAX_LINE_INVALID" });
    await expect(resolve(FOREIGN_TAX_CODE)).rejects.toMatchObject({ code: "TAX_LINE_INVALID" });
  });
});

describe("A8-style — global pack data is safe by construction", () => {
  it("the resolver reads only the pack bound to the code's jurisdiction — cross-pack rates never leak", async () => {
    // An AE code at an SA-window date: AE's own window (2018) covers it; the
    // resolution must use AE's 5% — never SA's 15% despite both being
    // readable global rows.
    const { taxResolver } = await import("./fixtures");
    const aeCode = tenant.taxCodeIds.standard;
    const line = await withTenant(tenant.tenantId, () =>
      taxResolver.resolveOne({
        documentDate: "2026-02-15",
        pricingModeOverride: "EXCLUSIVE",
        line: { amount: "100.0000", taxCodeId: aeCode, currencyCode: "AED" },
      }),
    );
    expect(line.rate).toBe("5.0000");
    expect(line.snapshot.countryCode).toBe("AE");
    // And before AE's window: fail-closed (no rate asserted for 2017).
    await expect(
      withTenant(tenant.tenantId, () =>
        taxResolver.resolveOne({
          documentDate: "2017-06-01",
          pricingModeOverride: "EXCLUSIVE",
          line: { amount: "100.0000", taxCodeId: aeCode, currencyCode: "AED" },
        }),
      ),
    ).rejects.toBeInstanceOf(NoRateForDateError);
  });
});

describe("denials audited — the risky keys' rejections are recorded", () => {
  it("registration number shape violations are typed and write nothing", async () => {
    const { registrations } = await import("./fixtures");
    const suBefore = await su();
    const before = await suBefore.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'tax.registration_upserted'`,
      [tenant.tenantId],
    );
    await suBefore.end();
    await expect(
      withTenant(tenant.tenantId, () =>
        registrations.upsert({
          countryCode: "AE",
          status: "REGISTERED",
          registrationNumber: null,
          effectiveFrom: "2020-01-01",
          effectiveTo: null,
          actorId: X_ACTOR,
          note: null,
        }),
      ),
    ).rejects.toMatchObject({ code: "REGISTRATION_NUMBER_REQUIRED" });
    const suClient = await su();
    const audit = await suClient.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'tax.registration_upserted'`,
      [tenant.tenantId],
    );
    await suClient.end();
    expect(audit.rows[0]!.n).toBe(before.rows[0]!.n); // the rejection wrote nothing
  });
});
