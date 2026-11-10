import { beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import * as journalStore from "../../modules/accounting/infrastructure/journal.store";
import { VatReturnCrossCheckFailedError, VatReturnStateError } from "../../modules/tax/domain/tax-errors";
import {
  registrations,
  su,
  taxReconciliation,
  vatReturns,
  X_ACTOR,
  expenses,
  packs,
} from "./fixtures";
import { setupPackTenant, taxCodes, type PackTenant } from "./fixtures";

/**
 * PHASE-009 T9/T11 — the VAT return v1 + INV-012 (RC-06/RC-07) suite on the
 * SA pack tenant: expense-driven INPUT tax + synthetic OUTPUT postings, the
 * side-by-side cross-check, ready-gating on mismatch, the RC-07 seeded-drift
 * fixture (superuser-only mutation of an append-only summary row → BROKEN
 * run + blocked READY + blocked period lock), the fake-adapter lifecycle,
 * the pack-upgrade BR-033 snapshot-preservation proof, the registration
 * migration (expand step), determinism (byte-identical re-runs), export, and
 * the mark-filed audit trail (the platform reports; humans file).
 */

let tenant: PackTenant;
let expenseCategoryId: string;
let cashTreasuryAccountId: string;

beforeAll(async () => {
  tenant = await setupPackTenant("SA");
});

describe("VAT return v1 — aggregation, cross-check, statuses, export", () => {
  it("G-11 expense with a standard-rated code: INPUT tax + summary + GL leg", async () => {
    // A treasury cash account on the mapped CASH GL account + an expense
    // category on the rent account (5210) with approval 'none'.
    await withTenant(tenant.tenantId, async () => {
      const { AccountService } = await import("../../modules/treasury/application/account-service");
      const { AuditService } = await import("../../modules/audit/api/audit");
      const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
      const accounts = new AccountService(new AuditService(new DrizzleAuditStore()));
      const existing = await accounts.list({ type: "CASH" });
      const found = existing.find((row) => row.currencyCode === "SAR");
      cashTreasuryAccountId =
        found?.id ??
        (
          await accounts.open({
            name: "Tax Cash (SA)",
            nameAr: null,
            type: "CASH",
            accountId: tenant.accountIds.cash,
            branchId: null,
            currencyCode: "SAR",
            actorId: X_ACTOR,
          })
        ).id;
      const categories = await expenses.listCategories(false);
      const category =
        categories.find((row) => row.code === "TAX-RENT") ??
        (await expenses.createCategory({
          code: "TAX-RENT",
          name: "Tax fixture rent",
          nameAr: "إيجار اختبار الضريبة",
          accountId: tenant.accountIds.rentExpense,
          approvalMode: "none",
          actorId: X_ACTOR,
        }));
      expenseCategoryId = category.id;
    });

    // BR-023: threshold 0 — attach a receipt (file_objects row via the
    // files substrate, mirroring the treasury golden's pattern).
    const suReceipt = await su();
    const receipt1 = await suReceipt.query<{ id: string }>(
      `INSERT INTO file_objects (id, tenant_id, owner_type, owner_id, storage_key, name, size_bytes, content_type)
       VALUES (gen_random_uuid(), $1, 'EXPENSE', gen_random_uuid(), 'tax/receipt1.pdf', 'receipt1.pdf', 10, 'application/pdf')
       RETURNING id`,
      [tenant.tenantId],
    );
    await suReceipt.end();
    // Gross 115.000 SAR at 15% → tax 15.00, net 100.00 (INCLUSIVE extraction).
    const created = await withTenant(tenant.tenantId, () =>
      expenses.create({
        categoryId: expenseCategoryId,
        cashAccountId: cashTreasuryAccountId,
        payeeName: "Tax Landlord",
        currencyCode: "SAR",
        amount: "115.0000",
        exchangeRate: null,
        taxCodeId: tenant.taxCodeIds.standard,
        receiptFileId: receipt1.rows[0]!.id,
        valueDate: "2026-03-10",
        description: "RC-06 expense",
        descriptionAr: "مصروف RC-06",
        actorId: X_ACTOR,
      }),
    );
    await withTenant(tenant.tenantId, () => expenses.submit(created.id, X_ACTOR));
    const posted = await withTenant(tenant.tenantId, () => expenses.post(created.id, X_ACTOR));
    expect(posted.idempotentReplay).toBe(false);

    // G-11 with the VAT leg: DR EXPENSE 100 · DR VAT_RECOVERABLE 15 · CR CASH 115.
    const lines = await withTenant(tenant.tenantId, () => journalStore.listLines(posted.journalEntryId));
    expect(
      lines.map((line) => ({ account: line.accountId, direction: line.direction, amount: line.amount })),
    ).toEqual([
      { account: tenant.accountIds.rentExpense, direction: "DEBIT", amount: "100.0000" },
      { account: tenant.accountIds.vatRecoverable, direction: "DEBIT", amount: "15.0000" },
      { account: tenant.accountIds.cash, direction: "CREDIT", amount: "115.0000" },
    ]);
    const vatLine = lines.find((line) => line.accountId === tenant.accountIds.vatRecoverable);
    expect(vatLine?.taxCodeId).toBe(tenant.taxCodeIds.standard);
  });

  it("RC-06: prepare → both sides agree → READY (byte-identical re-run)", async () => {
    const created = await withTenant(tenant.tenantId, () =>
      vatReturns.createDraft({
        countryCode: "SA",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        actorId: X_ACTOR,
      }),
    );
    const prepared = await withTenant(tenant.tenantId, () => vatReturns.prepare(created.id, X_ACTOR));
    expect(prepared.status).toBe("READY");
    expect(prepared.crossCheckOk).toBe(true);
    const crossCheck = prepared.crossCheck as {
      documentSide: Record<string, string>;
      glSide: Record<string, string>;
    };
    expect(crossCheck.documentSide.inputTaxRecoverable).toBe(crossCheck.glSide.vatRecoverableNetDebit);
    expect(crossCheck.documentSide.inputTaxRecoverable).toBe("15.0000");
    // Determinism: re-running prepare produces a byte-identical summary.
    const first = JSON.stringify((prepared as { summary: unknown }).summary);
    const rerun = await withTenant(tenant.tenantId, () => vatReturns.prepare(created.id, X_ACTOR));
    expect(JSON.stringify((rerun as { summary: unknown }).summary)).toBe(first);
    expect(rerun.status).toBe("READY");
  });

  it("export: CSV via the files module (signed URL, audited)", async () => {
    const returnsList = await withTenant(tenant.tenantId, () => vatReturns.list("SA"));
    const ready = returnsList.find((row) => row.status === "READY");
    expect(ready).toBeDefined();
    const exported = await withTenant(tenant.tenantId, () =>
      vatReturns.export({ id: ready!.id, format: "CSV", actorId: X_ACTOR }),
    );
    expect(exported.downloadUrl).toContain("X-Amz-Signature");
    expect(exported.rowCount).toBeGreaterThan(0);
  });

  it("mark-filed: human action with metadata, audited; FILED is immutable", async () => {
    const returnsList = await withTenant(tenant.tenantId, () => vatReturns.list("SA"));
    const ready = returnsList.find((row) => row.status === "READY")!;
    const filed = await withTenant(tenant.tenantId, () =>
      vatReturns.markFiled({
        id: ready.id,
        filingReference: "SA-RETURN-2026-03-001",
        filingNote: "filed by the accountant",
        actorId: X_ACTOR,
      }),
    );
    expect(filed.status).toBe("FILED");
    expect(filed.filingReference).toBe("SA-RETURN-2026-03-001");
    expect(filed.filedAt).not.toBeNull();
    // Filing audit trail (tax.returns.mark_filed — risky key).
    const suClient = await su();
    const audit = await suClient.query(
      `SELECT COUNT(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'tax.return_marked_filed'`,
      [tenant.tenantId],
    );
    await suClient.end();
    expect(audit.rows[0].n).toBe(1);
    await expect(
      withTenant(tenant.tenantId, () => vatReturns.prepare(filed.id, X_ACTOR)),
    ).rejects.toMatchObject({ code: "VAT_RETURN_ALREADY_FILED" });
  });

  it("mark-filed on a DRAFT return is refused (READY gates filing)", async () => {
    const draft = await withTenant(tenant.tenantId, () =>
      vatReturns.createDraft({
        countryCode: "SA",
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        actorId: X_ACTOR,
      }),
    );
    await expect(
      withTenant(tenant.tenantId, () =>
        vatReturns.markFiled({ id: draft.id, filingReference: "X", filingNote: null, actorId: X_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(VatReturnStateError);
  });

  it("RC-07: seeded summary drift (superuser-only) → BROKEN run + blocked READY", async () => {
    // A second, un-drifted expense in June (with its receipt).
    const suReceipt2 = await su();
    const receipt2 = await suReceipt2.query<{ id: string }>(
      `INSERT INTO file_objects (id, tenant_id, owner_type, owner_id, storage_key, name, size_bytes, content_type)
       VALUES (gen_random_uuid(), $1, 'EXPENSE', gen_random_uuid(), 'tax/receipt2.pdf', 'receipt2.pdf', 10, 'application/pdf')
       RETURNING id`,
      [tenant.tenantId],
    );
    await suReceipt2.end();
    const created = await withTenant(tenant.tenantId, () =>
      expenses.create({
        categoryId: expenseCategoryId,
        cashAccountId: cashTreasuryAccountId,
        payeeName: "Tax Landlord 2",
        currencyCode: "SAR",
        amount: "230.0000",
        exchangeRate: null,
        taxCodeId: tenant.taxCodeIds.standard,
        receiptFileId: receipt2.rows[0]!.id,
        valueDate: "2026-06-10",
        description: "RC-07 expense",
        descriptionAr: "مصروف RC-07",
        actorId: X_ACTOR,
      }),
    );
    await withTenant(tenant.tenantId, () => expenses.submit(created.id, X_ACTOR));
    await withTenant(tenant.tenantId, () => expenses.post(created.id, X_ACTOR));

    const draft = await withTenant(tenant.tenantId, () =>
      vatReturns.createDraft({
        countryCode: "SA",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        actorId: X_ACTOR,
      }),
    );
    const ok = await withTenant(tenant.tenantId, () => vatReturns.prepare(draft.id, X_ACTOR));
    expect(ok.status).toBe("READY");
    expect((ok.crossCheck as { documentSide: { inputTaxRecoverable: string } }).documentSide.inputTaxRecoverable).toBe("30.0000");

    // The drift: mutate the append-only summary row via SUPERUSER tooling
    // (the app role cannot — the grants + guard prove it below). The
    // maintenance path: replica session mode disables row triggers for the
    // tooling session only — exactly what a data-repair migration would do.
    const suClient = await su();
    await suClient.query(`SET session_replication_role = replica`);
    await suClient.query(
      `UPDATE tax_document_summaries SET tax_amount = 29.0000
        WHERE tenant_id = $1 AND document_date >= '2026-06-01' AND document_date <= '2026-06-30'`,
      [tenant.tenantId],
    );
    await suClient.query(`SET session_replication_role = DEFAULT`);
    const app = await (await import("./fixtures")).appClient();
    await expect(
      app.query(
        `UPDATE tax_document_summaries SET tax_amount = 28 WHERE tenant_id = $1`,
        [tenant.tenantId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await app.end();
    await suClient.end();

    // The VAT check records BROKEN (RC-07)...
    const run = await withTenant(tenant.tenantId, () =>
      taxReconciliation.runVatCheck({ asOf: "2026-06-30", runMode: "ON_DEMAND", checkedBy: X_ACTOR }),
    );
    expect(run.status).toBe("BROKEN");
    // ...and prepare now throws the typed cross-check error (ready blocked).
    await expect(
      withTenant(tenant.tenantId, () => vatReturns.prepare(draft.id, X_ACTOR)),
    ).rejects.toBeInstanceOf(VatReturnCrossCheckFailedError);
    // The close checklist shows the INV-012 item BROKEN (PERIOD_CLOSING §2.7).
    const { ReconciliationService } = await import(
      "../../modules/accounting/application/reconciliation-service"
    );
    const { AuditService } = await import("../../modules/audit/api/audit");
    const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
    const reconciliation = new ReconciliationService(new AuditService(new DrizzleAuditStore()));
    const periods = await withTenant(tenant.tenantId, async () => {
      const store = await import("../../modules/accounting/infrastructure/accounting.store");
      const year = await store.findFiscalYearByName("FY2026-SA");
      const rows = await store.listPeriods(year!.id);
      return rows;
    });
    const june = periods.find((row) => row.name.includes("Jun") || row.name.includes("06"))!;
    const checklist = await withTenant(tenant.tenantId, () => reconciliation.closeChecklist(june.id));
    const vatItem = checklist.items.find((item) => item.key === "reconciliation.vat")!;
    expect(vatItem.state).toBe("BROKEN");
    // PC-04: a BROKEN VAT check blocks the period lock.
    await expect(
      withTenant(tenant.tenantId, () =>
        (async () => {
          const { PeriodService } = await import("../../modules/accounting/application/period-service");
          const periods2 = new PeriodService(new AuditService(new DrizzleAuditStore()));
          await periods2.softClose(X_ACTOR, june.id);
          return periods2.lock(X_ACTOR, june.id);
        })(),
      ),
    ).rejects.toMatchObject({ code: "RECONCILIATION_BROKEN" });
  });
});

describe("registration migration — the PHASE-004 expand step", () => {
  it("migrates the provisional tax.registration.* settings into tax_registrations (idempotent)", async () => {
    // A fresh tenant with legacy settings but no rows yet.
    const suClient = await su();
    const migratedTenantId = generateUuidV7();
    await suClient.query(
      `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
         ($1, 'Migration Tenant', 'مستأجر الترحيل', 'SAR', 'SA', 'Asia/Riyadh')`,
      [migratedTenantId],
    );
    await suClient.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES
         ($1, $2, 'tax.registration.status', '"REGISTERED"'::jsonb),
         ($2, $2, 'tax.registration.number', '"310000000000003"'::jsonb),
         ($3, $2, 'tax.jurisdiction.binding', '{"country_code":"SA","pack_key":"sa","bound_at":"2026-01-01"}'::jsonb)`,
      [generateUuidV7(), migratedTenantId, generateUuidV7()],
    );
    await suClient.end();
    await withTenant(migratedTenantId, async () => {
      await registrations.ensureMigrated("SA");
      const rows = await registrations.list();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.countryCode).toBe("SA");
      expect(rows[0]!.status).toBe("REGISTERED");
      expect(rows[0]!.registrationNumber).toBe("310000000000003");
      // Idempotent: the second call does not duplicate.
      await registrations.ensureMigrated("SA");
      expect((await registrations.list())).toHaveLength(1);
    });
  });
});

describe("EInvoicingAdapter — port + fake adapter (RISK-005)", () => {
  it("the fake adapter refuses while the regime is REQUIRES_VERIFICATION (UNVERIFIED stub)", async () => {
    await withTenant(tenant.tenantId, async () => {
      await expect(
        einvoicingSubmitSA(),
      ).rejects.toMatchObject({ code: "UNVERIFIED_REGIME" });
    });
  });

  it("the fake adapter walks the full lifecycle states in tests (no external call)", async () => {
    await withTenant(tenant.tenantId, async () => {
      const store = await import("../../modules/tax/infrastructure/tax.store");
      const submissionId = await store.insertEInvoicingSubmission({
        countryCode: "SA",
        adapterId: "fake",
        sourceType: "tax_fixture",
        sourceId: generateUuidV7(),
        payloadDigest: null,
      });
      const { einvoicing } = await import("./fixtures");
      const generated = await einvoicing.walkLifecycle({ submissionId, steps: ["GENERATED"] });
      expect(generated.status).toBe("GENERATED");
      const accepted = await einvoicing.walkLifecycle({ submissionId, steps: ["SUBMITTED", "ACCEPTED"] });
      expect(accepted.status).toBe("ACCEPTED");
      // Invalid transitions are typed rejections (the state machine).
      await expect(
        einvoicing.walkLifecycle({ submissionId, steps: ["GENERATED"] }),
      ).rejects.toMatchObject({ code: "E_INVOICING_STATE_INVALID" });
    });
  });
});

async function einvoicingSubmitSA(): Promise<unknown> {
  const { einvoicing } = await import("./fixtures");
  return einvoicing.submit({
    payload: {
      countryCode: "SA",
      sourceType: "tax_fixture",
      sourceId: generateUuidV7(),
      document: { invoiceNo: "T-001" },
    },
    actorId: X_ACTOR,
  });
}

describe("pack upgrade mechanics — BR-033 (never retroactive)", () => {
  it("a version-bump rate row never rewrites a stamped snapshot; drafts spanning the boundary are warned", async () => {
    // Resolve + post a document under the CURRENT window.
    const { taxResolver } = await import("./fixtures");
    const posted = await withTenant(tenant.tenantId, () =>
      taxResolver.resolveOne({
        documentDate: "2026-02-15",
        pricingModeOverride: "EXCLUSIVE",
        line: { amount: "100.0000", taxCodeId: tenant.taxCodeIds.standard, currencyCode: "SAR" },
      }),
    );
    // Simulate the upgrade: a future-dated rate row (the versioned seed
    // path — a superuser seed migration, never the API).
    const suClient = await su();
    await suClient.query(
      `INSERT INTO jurisdiction_tax_rates (id, jurisdiction_id, treatment, rate, effective_from, effective_to, source_ref)
       VALUES ($1, '13a00000-0000-7000-8000-000000000001', 'STANDARD_RATED', 18.0000, '2027-01-01', NULL,
               'upgrade simulation — PHASE-009 BR-033 fixture')`,
      [generateUuidV7()],
    );
    await suClient.end();
    try {
      // The posted snapshot is FROZEN: the same 2026 date still resolves the
      // old window (documents never see the future row).
      const again = await withTenant(tenant.tenantId, () =>
        taxResolver.resolveOne({
          documentDate: "2026-02-15",
          pricingModeOverride: "EXCLUSIVE",
          line: { amount: "100.0000", taxCodeId: tenant.taxCodeIds.standard, currencyCode: "SAR" },
        }),
      );
      expect(JSON.stringify(again.snapshot)).toBe(JSON.stringify(posted.snapshot));
      expect(again.rate).toBe("15.0000");
      // A 2027 document resolves the NEW window (the upgrade applies
      // forward, by effective date).
      const future = await withTenant(tenant.tenantId, () =>
        taxResolver.resolveOne({
          documentDate: "2027-03-01",
          pricingModeOverride: "EXCLUSIVE",
          line: { amount: "100.0000", taxCodeId: tenant.taxCodeIds.standard, currencyCode: "SAR" },
        }),
      );
      expect(future.rate).toBe("18.0000");
      // A draft spanning the boundary is warned on open (BR-033).
      const warning = await withTenant(tenant.tenantId, () =>
        taxResolver.boundaryWarning({ countryCode: "SA", date: "2026-02-15" }),
      );
      expect(warning).toEqual({
        countryCode: "SA",
        treatment: "STANDARD_RATED",
        effectiveFrom: "2027-01-01",
        rate: "18.0000",
      });
    } finally {
      // Cleanup: the simulated upgrade row is removed (other suites on this
      // tenant expect the canonical 15% window).
      const suClient2 = await su();
      await suClient2.query(
        `DELETE FROM jurisdiction_tax_rates WHERE source_ref LIKE 'upgrade simulation%'`,
      );
      await suClient2.end();
    }
  });

  it("pack apply records the staged binding + audit", async () => {
    const binding = await withTenant(tenant.tenantId, () =>
      packs.apply({ countryCode: "SA", packVersion: "1.0.0-baseline", actorId: X_ACTOR }),
    );
    expect(binding.packVersion).toBe("1.0.0-baseline");
    const suClient = await su();
    const audit = await suClient.query(
      `SELECT COUNT(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'tax.pack_applied'`,
      [tenant.tenantId],
    );
    await suClient.end();
    expect(audit.rows[0].n).toBe(1);
  });
});

describe("global pack tables — read-only to erp_app (seed-only)", () => {
  it("INSERT/UPDATE/DELETE as erp_app are grant-denied on all three pack tables", async () => {
    // Each probe runs in its own transaction: a rejection aborts the tx, so
    // a fresh BEGIN per statement keeps the denials isolated (25P02-proof).
    const app = await (await import("./fixtures")).appClient();
    const probe = async (statement: string): Promise<void> => {
      await app.query("BEGIN");
      await app.query("SELECT set_config('erp.tenant_id', $1, true)", [tenant.tenantId]);
      try {
        await expect(app.query(statement)).rejects.toMatchObject({ code: "42501" });
      } finally {
        await app.query("ROLLBACK");
      }
    };
    await probe(
      `INSERT INTO jurisdictions (id, country_code, country_name, country_name_ar, currency_code, minor_units, vat_status, pack_version, descriptor, source_ref)
       VALUES ('99999999-0000-4000-8000-000000000001', 'ZZ', 'X', 'س', 'SAR', 2, 'NO_VAT', '1', '{}', 'x')`,
    );
    await probe(`UPDATE jurisdictions SET pack_version = '9' WHERE country_code = 'SA'`);
    await probe(`DELETE FROM jurisdiction_tax_rates WHERE rate = 15`);
    await probe(`UPDATE tax_treatments SET name = 'X' WHERE key = 'EXEMPT'`);
    await probe(`INSERT INTO tax_treatments (key, name, name_ar, taxable, sort_order) VALUES ('X', 'X', 'س', true, 9)`);
    await app.end();
    // SELECT works for every tenant (global reference data — A8-safe reads).
    const app2 = await (await import("./fixtures")).appClient();
    const reads = await app2.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM jurisdictions`);
    await app2.end();
    expect(reads.rows[0]!.n).toBe(10);
  });
});

describe("codes service — tenant-unique + reference-guarded archive", () => {
  it("duplicate code per jurisdiction is a typed conflict; cross-jurisdiction is fine; archive is reference-guarded", async () => {
    await expect(
      withTenant(tenant.tenantId, () =>
        taxCodes.create({
          code: "STD",
          name: "Dup",
          nameAr: null,
          countryCode: "SA",
          defaultTreatment: "STANDARD_RATED",
          actorId: X_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "TAX_CODE_TAKEN" });
    // Codes are tenant-unique (uq_tax_codes_tenant_code): a second
    // jurisdiction's code under the same tenant uses its own code string.
    const other = await withTenant(tenant.tenantId, () =>
      taxCodes.create({
        code: "STD-EG",
        name: "Standard (EG)",
        nameAr: null,
        countryCode: "EG",
        defaultTreatment: "STANDARD_RATED",
        actorId: X_ACTOR,
      }),
    );
    expect(other.countryCode).toBe("EG");
    // Archive with references is blocked: create the code (committed), then
    // reference it from an item on a separate connection, then assert the
    // reference-guarded rejection.
    const referenced = await withTenant(tenant.tenantId, () =>
      taxCodes.create({
        code: "REFD",
        name: "Referenced",
        nameAr: null,
        countryCode: "SA",
        defaultTreatment: "STANDARD_RATED",
        actorId: X_ACTOR,
      }),
    );
    const suClient = await su();
    await suClient.query(
      `INSERT INTO items (id, tenant_id, sku, name, kind, uom_id, tax_code_id, status)
       SELECT $1, $2, 'TAX-REF-ITEM', 'Tax ref item', 'SERVICE', u.id, $3, 'ACTIVE'
         FROM uoms u WHERE u.tenant_id = $2 AND u.code = 'PCS' LIMIT 1`,
      [generateUuidV7(), tenant.tenantId, referenced.id],
    );
    await suClient.end();
    await expect(
      withTenant(tenant.tenantId, () => taxCodes.archive(referenced.id, X_ACTOR)),
    ).rejects.toMatchObject({ code: "TAX_CODE_IN_USE" });
  });
});
