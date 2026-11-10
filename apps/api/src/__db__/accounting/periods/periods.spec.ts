import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ACTOR,
  ensureFiscalYear,
  manualSpec,
  newDocId,
  posting,
  reconciliation,
  resolveAccounts,
  restorePeriodsOpen,
  setupAccountingFixture,
  TENANT_A,
  withTenant,
} from "../fixtures";
import * as store from "../../../modules/accounting/infrastructure/accounting.store";
import * as journal from "../../../modules/accounting/infrastructure/journal.store";

/**
 * PHASE-007 period-close suites (ACCOUNTING_TESTS §7): PC-01..PC-04 (the
 * close/lock/reopen/checklist mechanics over live data; PC-05/06/07 are
 * proven in the G-20 golden) + reconciliation RC-01/02/03 (INV-009 with
 * seeded drift).
 */

let accounts: Awaited<ReturnType<typeof resolveAccounts>>;
let yearId: string;

beforeAll(async () => {
  await setupAccountingFixture();
  yearId = (await ensureFiscalYear()).id;
  accounts = await resolveAccounts();
});

// Order-independence restore (PHASE-008 reality-audit repair): this suite
// soft-closes September + July and locks October on the SHARED FY2026 of
// tenant A — months other suites post into (gl-perf: 2026-09-15; FX-reval
// golden: 2026-09-30 + 2026-10-01 reversal; recurring goldens: July). Restore
// the pristine all-OPEN state so vitest's file order can never couple suites.
afterAll(async () => {
  await restorePeriodsOpen(["07", "09", "10"]);
});

describe("PC-01 — lock enforcement", () => {
  it("a locked period rejects invoice-post-shaped specs, manual journals, and adjustments alike", async () => {
    const periodsList = await withTenant(TENANT_A, () => store.listPeriods(yearId));
    const october = periodsList.find((period) => period.name.endsWith("-10"))!;
    const { periods } = await import("../fixtures");
    const current = await withTenant(TENANT_A, () => store.findPeriodById(october.id));
    if (current?.status === "OPEN") {
      await withTenant(TENANT_A, () => periods.softClose(ACTOR, october.id));
    }
    if ((await withTenant(TENANT_A, () => store.findPeriodById(october.id)))?.status !== "LOCKED") {
      await withTenant(TENANT_A, () => periods.lock(ACTOR, october.id));
    }
    // Manual journal spec.
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          manualSpec({
            docId: newDocId(),
            debitAccountId: accounts.cash,
            creditAccountId: accounts.salesRevenue,
            amount: "5.0000",
            entryDate: "2026-10-15",
          }),
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
    // A draft dated in the locked period cannot post either.
    const { journals } = await import("../fixtures");
    const draft = await withTenant(TENANT_A, () =>
      journals.create(ACTOR, {
        entryDate: "2026-10-16",
        description: "locked probe",
        lines: [
          { accountId: accounts.cash, direction: "DEBIT", amount: "5.0000" },
          { accountId: accounts.salesRevenue, direction: "CREDIT", amount: "5.0000" },
        ],
      }),
    );
    const submitted = await withTenant(TENANT_A, () => journals.submit(ACTOR, draft.id));
    expect(submitted.status).toBe("APPROVED"); // default none policy auto-approves
    await expect(withTenant(TENANT_A, () => journals.post(ACTOR, draft.id))).rejects.toMatchObject({
      code: "PERIOD_LOCKED",
    });
  });
});

describe("PC-02 — soft-close discipline", () => {
  it("posting into a soft-closed period requires a reason (permission enforced at the route)", async () => {
    const periodsList = await withTenant(TENANT_A, () => store.listPeriods(yearId));
    const september = periodsList.find((period) => period.name.endsWith("-09"))!;
    const { periods } = await import("../fixtures");
    const current = await withTenant(TENANT_A, () => store.findPeriodById(september.id));
    if (current?.status !== "OPEN") {
      await withTenant(TENANT_A, () => periods.reopen(ACTOR, september.id, "soft-close fixture"));
    }
    await withTenant(TENANT_A, () => periods.softClose(ACTOR, september.id));
    // Without the reason → PERIOD_LOCKED.
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          manualSpec({
            docId: newDocId(),
            debitAccountId: accounts.cash,
            creditAccountId: accounts.salesRevenue,
            amount: "6.0000",
            entryDate: "2026-09-15",
          }),
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
    // With the reason (route-verified permission shape) → posts.
    const spec = manualSpec({
      docId: newDocId(),
      debitAccountId: accounts.cash,
      creditAccountId: accounts.salesRevenue,
      amount: "6.0000",
      entryDate: "2026-09-15",
    });
    spec.softCloseReason = "approved late audit adjustment";
    const result = await withTenant(TENANT_A, () => posting.post(spec, { postedBy: ACTOR }));
    expect(result.status).toBe("POSTED");
    const entry = await withTenant(TENANT_A, () => journal.findEntryById(result.journalEntryId));
    expect(entry?.postReason).toContain("late audit adjustment");
  });
});

describe("RC-01/RC-02 — AR/AP reconciliation over live data", () => {
  it("after randomized AR/AP postings the job reports OK with exact equality", async () => {
    const { PartnerService } = await import("../../../modules/partners/application/partner-service");
    const audit = new (await import("../../../modules/audit/application/audit.service")).AuditService(
      new (await import("../../../modules/audit/infrastructure/drizzle-audit.store")).DrizzleAuditStore(),
    );
    const partners = new PartnerService(audit);
    const customer = await withTenant(TENANT_A, () =>
      partners.create(ACTOR, {
        kind: "CUSTOMER", code: undefined, name: "مطابقة عملاء", nameAr: "مطابقة عملاء",
        taxNumber: null, creditLimit: null, creditTermsId: null, priceListId: null,
      }),
    );
    // Several randomized-amount AR postings.
    for (const amount of ["10.0000", "25.5000", "130.2500"]) {
      await withTenant(TENANT_A, () =>
        posting.post(
          {
            source: { docType: "journal_entry", docId: newDocId(), operation: "post" },
            entryDate: "2026-08-05",
            currency: "SAR",
            lines: [
              { purpose: "AR_CONTROL", direction: "DEBIT", amount, partnerId: customer.id },
              { purpose: "SALES_REVENUE", direction: "CREDIT", amount },
            ],
          },
          { postedBy: ACTOR },
        ),
      );
    }
    const ar = await withTenant(TENANT_A, () =>
      reconciliation.runArCheck({ asOf: "2026-08-31", runMode: "NIGHTLY", checkedBy: null }),
    );
    expect(ar.status).toBe("OK");
    expect(ar.controlBalance).toBe(ar.subledgerBalance);
    expect(Number(ar.controlBalance)).toBeGreaterThan(0);
    const ap = await withTenant(TENANT_A, () =>
      reconciliation.runApCheck({ asOf: "2026-08-31", runMode: "NIGHTLY", checkedBy: null }),
    );
    expect(ap.status).toBe("OK");
  });
});

describe("RC-03 — seeded subledger drift → BROKEN + notification record + lock blocked (PC-04)", () => {
  it("deleting a subledger row (test tooling) makes the job BROKEN with the partner diff; period LOCK refuses; restore heals", async () => {
    const { PartnerService } = await import("../../../modules/partners/application/partner-service");
    const audit = new (await import("../../../modules/audit/application/audit.service")).AuditService(
      new (await import("../../../modules/audit/infrastructure/drizzle-audit.store")).DrizzleAuditStore(),
    );
    const partners = new PartnerService(audit);
    const customer = await withTenant(TENANT_A, () =>
      partners.create(ACTOR, {
        kind: "CUSTOMER", code: undefined, name: "انحراف مطابقة", nameAr: "انحراف مطابقة",
        taxNumber: null, creditLimit: null, creditTermsId: null, priceListId: null,
      }),
    );
    const result = await withTenant(TENANT_A, () =>
      posting.post(
        {
          source: { docType: "journal_entry", docId: newDocId(), operation: "post" },
          entryDate: "2026-07-10",
          currency: "SAR",
          lines: [
            { purpose: "AR_CONTROL", direction: "DEBIT", amount: "99.0000", partnerId: customer.id },
            { purpose: "SALES_REVENUE", direction: "CREDIT", amount: "99.0000" },
          ],
        },
        { postedBy: ACTOR },
      ),
    );
    // Seed drift: delete the subledger row via test tooling (superuser +
    // trigger disabled — impossible through the app role).
    const suClient = await (await import("../fixtures")).superuserClient();
    const lines = await withTenant(TENANT_A, () => journal.listLines(result.journalEntryId));
    const arLine = lines.find((line) => line.accountId === accounts.arControl)!;
    await suClient.query(`ALTER TABLE partner_subledger_entries DISABLE TRIGGER trg_partner_subledger_guard`);
    await suClient.query(`DELETE FROM partner_subledger_entries WHERE journal_line_id = $1`, [arLine.id]);
    await suClient.query(`ALTER TABLE partner_subledger_entries ENABLE TRIGGER trg_partner_subledger_guard`);
    await suClient.end();
    // The job reports BROKEN with the diff.
    const broken = await withTenant(TENANT_A, () =>
      reconciliation.runArCheck({ asOf: "2026-07-31", runMode: "ON_DEMAND", checkedBy: ACTOR }),
    );
    expect(broken.status).toBe("BROKEN");
    expect(broken.diffCount).toBeGreaterThan(0);
    expect(broken.controlBalance).not.toBe(broken.subledgerBalance);
    // The notification record exists (audit event carries the diff).
    const su2 = await (await import("../fixtures")).superuserClient();
    const events = await su2.query(
      `SELECT after FROM audit_events WHERE action = 'accounting.reconciliation_broken' AND entity_id = $1`,
      [broken.id],
    );
    await su2.end();
    expect(events.rowCount).toBe(1);
    // PC-04: period LOCK is refused while a core check is BROKEN.
    const periodsList = await withTenant(TENANT_A, () => store.listPeriods(yearId));
    const july = periodsList.find((period) => period.name.endsWith("-07"))!;
    const { periods } = await import("../fixtures");
    const julyState = await withTenant(TENANT_A, () => store.findPeriodById(july.id));
    if (julyState?.status === "OPEN") {
      await withTenant(TENANT_A, () => periods.softClose(ACTOR, july.id));
    }
    if ((await withTenant(TENANT_A, () => store.findPeriodById(july.id)))?.status === "SOFT_CLOSED") {
      await expect(withTenant(TENANT_A, () => periods.lock(ACTOR, july.id))).rejects.toMatchObject({
        code: "RECONCILIATION_BROKEN",
      });
    }
    // Restore the row (test tooling) → the job heals to OK.
    const su3 = await (await import("../fixtures")).superuserClient();
    await su3.query(`ALTER TABLE partner_subledger_entries DISABLE TRIGGER trg_partner_subledger_guard`);
    await su3.query(
      `INSERT INTO partner_subledger_entries (id, tenant_id, partner_id, journal_entry_id, journal_line_id,
                                              entry_date, direction, amount, base_amount, currency_code, source_type)
       VALUES ($1, $2, $3, $4, $5, '2026-07-10', 'DEBIT', '99.0000', '99.0000', 'SAR', 'journal_entry')`,
      [newDocId(), TENANT_A, customer.id, result.journalEntryId, arLine.id],
    );
    await su3.query(`ALTER TABLE partner_subledger_entries ENABLE TRIGGER trg_partner_subledger_guard`);
    await su3.end();
    const healed = await withTenant(TENANT_A, () =>
      reconciliation.runArCheck({ asOf: "2026-07-31", runMode: "ON_DEMAND", checkedBy: ACTOR }),
    );
    expect(healed.status).toBe("OK");
  });
});

describe("close checklist — live checks with explicit NOT_APPLICABLE states", () => {
  it("renders the checklist from live data; PHASE-008's cash check is live (RC-08) and unshipped modules display 'not yet applicable'", async () => {
    const periodsList = await withTenant(TENANT_A, () => store.listPeriods(yearId));
    const august = periodsList.find((period) => period.name.endsWith("-08"))!;
    // PHASE-008: before any CASH run, the treasury check surfaces NOT_RUN —
    // never a silent pass.
    const before = await withTenant(TENANT_A, () => reconciliation.closeChecklist(august.id));
    const beforeKeys = new Map(before.items.map((item) => [item.key, item]));
    expect(beforeKeys.get("reconciliation.cash")?.state).toBe("NOT_RUN");
    expect(beforeKeys.get("reconciliation.bank_rec")?.state).toBe("NOT_RUN");

    // Run the treasury INV-019 check (tenant A has no treasury accounts):
    // an OK run with accounts=0 → the checklist flips both PHASE-008 items
    // to their explicit NOT_APPLICABLE state (nothing to reconcile).
    const TreasuryReconciliationService = (await import("../../../modules/treasury/application/treasury-reconciliation-service")).TreasuryReconciliationService;
    const AuditService = (await import("../../../modules/audit/api/audit")).AuditService;
    const DrizzleAuditStore = (await import("../../../modules/audit/infrastructure/drizzle-audit.store")).DrizzleAuditStore;
    const treasuryCheck = new TreasuryReconciliationService(new AuditService(new DrizzleAuditStore()));
    const run = await withTenant(TENANT_A, () =>
      treasuryCheck.runCashCheck({ asOf: "2026-08-31", runMode: "ON_DEMAND", checkedBy: ACTOR }),
    );
    expect(run.status).toBe("OK");
    expect((run.diff as { accounts: number }).accounts).toBe(0);

    const checklist = await withTenant(TENANT_A, () => reconciliation.closeChecklist(august.id));
    const byKey = new Map(checklist.items.map((item) => [item.key, item]));
    expect(byKey.get("reconciliation.ar")?.state).toBe("OK");
    expect(byKey.get("reconciliation.ap")?.state).toBe("OK");
    expect(byKey.get("reconciliation.cash")?.state).toBe("NOT_APPLICABLE");
    expect(byKey.get("reconciliation.cash")?.detail).toContain("no treasury accounts");
    expect(byKey.get("reconciliation.bank_rec")?.state).toBe("NOT_APPLICABLE");
    expect(byKey.get("reconciliation.bank_rec")?.detail).toContain("no bank accounts");
    // PHASE-009: the INV-012 check (RC-06) is live — before any VAT run it
    // surfaces NOT_RUN (never a silent pass); running the tax check with no
    // tax activity flips it to its explicit NOT_APPLICABLE state.
    expect(byKey.get("reconciliation.vat")?.state).toBe("NOT_RUN");
    const TaxReconciliationService = (await import("../../../modules/tax/application/tax-reconciliation-service")).TaxReconciliationService;
    const taxCheck = new TaxReconciliationService(new AuditService(new DrizzleAuditStore()));
    const vatRun = await withTenant(TENANT_A, () =>
      taxCheck.runVatCheck({ asOf: "2026-08-31", runMode: "ON_DEMAND", checkedBy: ACTOR }),
    );
    expect(vatRun.status).toBe("OK");
    const checklistAfterVat = await withTenant(TENANT_A, () => reconciliation.closeChecklist(august.id));
    const byKeyAfterVat = new Map(checklistAfterVat.items.map((item) => [item.key, item]));
    expect(byKeyAfterVat.get("reconciliation.vat")?.state).toBe("NOT_APPLICABLE");
    expect(byKeyAfterVat.get("reconciliation.vat")?.detail).toContain("no tax activity");
    // PHASE-010: the INV-010 check (RC-04) is live — before any stock run it
    // surfaces NOT_RUN (never a silent pass); running the inventory check
    // with no stock activity flips it to its explicit NOT_APPLICABLE state.
    expect(byKeyAfterVat.get("reconciliation.inventory")?.state).toBe("NOT_RUN");
    const InventoryReconciliationService = (await import("../../../modules/inventory/application/reconciliation-service")).InventoryReconciliationService;
    const inventoryCheck = new InventoryReconciliationService(new AuditService(new DrizzleAuditStore()));
    const stockRun = await withTenant(TENANT_A, () =>
      inventoryCheck.runStockCheck({ asOf: "2026-08-31", runMode: "ON_DEMAND", checkedBy: ACTOR }),
    );
    expect(stockRun.status).toBe("OK");
    const checklistAfterStock = await withTenant(TENANT_A, () => reconciliation.closeChecklist(august.id));
    const byKeyAfterStock = new Map(checklistAfterStock.items.map((item) => [item.key, item]));
    expect(byKeyAfterStock.get("reconciliation.inventory")?.state).toBe("NOT_APPLICABLE");
    expect(byKeyAfterStock.get("reconciliation.inventory")?.detail).toContain("no stock movement activity");
    // PHASE-018: the WIP check (MASTER-PLAN §11, the INV-010 manufacturing
    // extension) is live — before any WIP run it surfaces NOT_RUN (never the
    // old "manufacturing module ships PHASE-018" stub); running the
    // manufacturing check with no production activity flips it to its
    // explicit NOT_APPLICABLE state.
    expect(byKeyAfterStock.get("reconciliation.wip")?.state).toBe("NOT_RUN");
    const ManufacturingReconciliationService = (
      await import("../../../modules/manufacturing/application/wip-reconciliation-service")
    ).ManufacturingReconciliationService;
    const InboxService = (await import("../../../modules/notifications/application/inbox-service"))
      .InboxService;
    const wipCheck = new ManufacturingReconciliationService(
      new AuditService(new DrizzleAuditStore()),
      new InboxService(),
    );
    const wipRun = await withTenant(TENANT_A, () =>
      wipCheck.runWipCheck({ asOf: "2026-08-31", runMode: "ON_DEMAND", checkedBy: ACTOR }),
    );
    expect(wipRun.status).toBe("OK");
    const checklistAfterWip = await withTenant(TENANT_A, () =>
      reconciliation.closeChecklist(august.id),
    );
    const byKeyAfterWip = new Map(checklistAfterWip.items.map((item) => [item.key, item]));
    expect(byKeyAfterWip.get("reconciliation.wip")?.state).toBe("NOT_APPLICABLE");
    expect(byKeyAfterWip.get("reconciliation.wip")?.detail).toContain("nothing to reconcile");
    expect(typeof checklistAfterWip.allSatisfied).toBe("boolean");
  });
});
