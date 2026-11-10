import { beforeAll, describe, expect, it } from "vitest";

import {
  T_ACTOR,
  TENANT_T,
  accounts,
  allocations,
  receipts,
  setupTreasuryFixture,
  withTenant,
  type TreasuryFixture,
} from "./fixtures";

/**
 * PHASE-008 spoof suite (SECURITY_TEST_PLAN §2): foreign partner /
 * open-item / cash-account references in nested payloads are rejected with
 * typed errors (404-shaped) and ZERO partial creation (S-04) — the receipt
 * row, its allocations, and any movement all roll back together.
 *
 * The foreign ids come from the isolation suite's tenants (1111…/2222…) and
 * the PHASE-007 accounting tenant (3333…) — ids that exist in the database
 * but belong to other tenants, so the attack distinguishes RLS-scoped
 * lookups from FK leakage.
 */

const FOREIGN_PARTNER = "b5b5b5b5-0000-4000-8000-000000000002"; // tenant B's partner
const FOREIGN_ACCOUNT = "d0d0d0d0-0000-4000-8000-000000000002"; // tenant B's cash account
const FOREIGN_OPEN_ITEM = "cececece-0000-4000-8000-000000000002"; // tenant B's subledger row
const ACCOUNTING_TENANT_PARTNER = "b5b5b5b5-0000-4000-8000-000000000001"; // tenant A's partner

let fixture: TreasuryFixture;

beforeAll(async () => {
  fixture = await setupTreasuryFixture();
});

describe("S-04 — foreign references in nested payloads → typed rejection, zero partial creation", () => {
  it("a receipt referencing a foreign partner id is rejected; no receipt row survives", async () => {
    await expect(
      withTenant(TENANT_T, () =>
        receipts.create({
          cashAccountId: fixture.accountIds.cash,
          partnerId: FOREIGN_PARTNER,
          method: "CASH",
          payerName: null,
          currencyCode: "SAR",
          amount: "25.0000",
          exchangeRate: null,
          valueDate: "2026-07-01",
          reference: null,
          description: "spoof partner",
          descriptionAr: null,
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "PARTNER_NOT_FOUND" });
    const listed = await withTenant(TENANT_T, () => receipts.list({ limit: 500 }));
    const spoofed = listed.filter((row) => row.description === "spoof partner");
    expect(spoofed).toHaveLength(0);
  });

  it("a receipt referencing a foreign cash account id is rejected; zero partial creation", async () => {
    await expect(
      withTenant(TENANT_T, () =>
        receipts.create({
          cashAccountId: FOREIGN_ACCOUNT,
          partnerId: fixture.partners.customerA.id,
          method: "CASH",
          payerName: null,
          currencyCode: "SAR",
          amount: "25.0000",
          exchangeRate: null,
          valueDate: "2026-07-02",
          reference: null,
          description: "spoof account",
          descriptionAr: null,
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "CASH_ACCOUNT_NOT_FOUND" });
    const listed = await withTenant(TENANT_T, () => receipts.list({ limit: 500 }));
    expect(listed.filter((row) => row.description === "spoof account")).toHaveLength(0);
  });

  it("allocations to a foreign open item are rejected; the allocation table stays clean", async () => {
    const created = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.customerA.id,
        method: "CASH",
        payerName: null,
        currencyCode: "SAR",
        amount: "25.0000",
        exchangeRate: null,
        valueDate: "2026-07-03",
        reference: null,
        description: "spoof allocation base",
        descriptionAr: null,
        actorId: T_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_T, () =>
        allocations.setAllocations({
          docType: "receipt",
          docId: created.id,
          allocations: [{ openItemId: FOREIGN_OPEN_ITEM, amount: "25.0000" }],
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "OPEN_ITEM_NOT_FOUND" });
    const rows = await withTenant(TENANT_T, () => allocations.listForDoc("receipt", created.id));
    expect(rows).toHaveLength(0);
    // A cross-TENANT partner (accounting suite's tenant) is equally opaque.
    await expect(
      withTenant(TENANT_T, () =>
        receipts.create({
          cashAccountId: fixture.accountIds.cash,
          partnerId: ACCOUNTING_TENANT_PARTNER,
          method: "CASH",
          payerName: null,
          currencyCode: "SAR",
          amount: "25.0000",
          exchangeRate: null,
          valueDate: "2026-07-04",
          reference: null,
          description: "spoof cross-tenant partner",
          descriptionAr: null,
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "PARTNER_NOT_FOUND" });
  });

  it("an allocation to ANOTHER partner's (own-tenant) open item is rejected — the partner must match", async () => {
    const created = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.customerA.id,
        method: "CASH",
        payerName: null,
        currencyCode: "SAR",
        amount: "25.0000",
        exchangeRate: null,
        valueDate: "2026-07-05",
        reference: null,
        description: "spoof partner mismatch",
        descriptionAr: null,
        actorId: T_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_T, () =>
        allocations.setAllocations({
          docType: "receipt",
          docId: created.id,
          allocations: [{ openItemId: fixture.items.customerB, amount: "25.0000" }],
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "OPEN_ITEM_PARTNER_MISMATCH" });
  });

  it("A7 route id-probe parity: unknown-vs-foreign ids render identically (typed 404s)", async () => {
    const unknown = await withTenant(TENANT_T, () =>
      receipts.find("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").catch((error: { code?: string }) => error.code),
    );
    const foreign = await withTenant(TENANT_T, () =>
      receipts.find(FOREIGN_ACCOUNT).catch((error: { code?: string }) => error.code),
    );
    expect(unknown).toBe("RECEIPT_NOT_FOUND");
    expect(foreign).toBe("RECEIPT_NOT_FOUND");
    const unknownAccount = await withTenant(TENANT_T, () =>
      accounts.find("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").catch((error: { code?: string }) => error.code),
    );
    const foreignAccountProbe = await withTenant(TENANT_T, () =>
      accounts.find(FOREIGN_ACCOUNT).catch((error: { code?: string }) => error.code),
    );
    expect(unknownAccount).toBe("CASH_ACCOUNT_NOT_FOUND");
    expect(foreignAccountProbe).toBe("CASH_ACCOUNT_NOT_FOUND");
  });
});
