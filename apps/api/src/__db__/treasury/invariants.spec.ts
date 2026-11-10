import { beforeAll, describe, expect, it } from "vitest";

import {
  T_ACTOR,
  TENANT_T,
  accounts,
  allocations,
  assertZeroTreasuryResidue,
  expenses,
  newDocId,
  payments,
  receipts,
  setupTreasuryFixture,
  transfers,
  treasuryReconciliation,
  withTenant,
  type TreasuryFixture,
} from "./fixtures";
import { withTenant as withTenantRaw } from "../../infra/db/tenant-context";

/**
 * PHASE-008 invariant suites (ACCOUNTING_TESTS §4–§6):
 * - INV-016: allocations never exceed the document amount nor the open
 *   item's outstanding — including under concurrency (CC-02); on-account
 *   remainders are explicit open items (BR-027).
 * - INV-019 (RC-08): after every operation set, every cash/bank/petty
 *   account's GL balance = Σ its movements; seeded drift (a movement
 *   without its ledger effect) is detected as BROKEN, fires the audit
 *   notification record, and blocks the period LOCK (PC-04).
 */

let fixture: TreasuryFixture;

beforeAll(async () => {
  fixture = await setupTreasuryFixture();
});

/** INV-019 probe: every cash account GL base balance == Σ movements (as-of). */
async function assertInv019(asOf?: string): Promise<void> {
  const store = await import("../../modules/treasury/infrastructure/treasury.store");
  const all = await withTenant(TENANT_T, () => store.listCashAccounts({}));
  expect(all.length).toBeGreaterThanOrEqual(3);
  for (const account of all) {
    const gl = await withTenant(TENANT_T, () => store.glBaseBalanceAsOf(account.accountId, asOf));
    const movements = await withTenant(TENANT_T, () => store.movementBalance(account.id, asOf));
    expect(gl, `INV-019 on ${account.name}`).toBe(movements);
  }
}

describe("INV-016 — allocation bounds (row: treasury)", () => {
  it("over-allocation on the DOCUMENT is rejected with zero residue (500-on-300)", async () => {
    const created = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.customerA.id,
        method: "CASH",
        payerName: null,
        currencyCode: "SAR",
        amount: "300.0000",
        exchangeRate: null,
        valueDate: "2026-04-01",
        reference: null,
        description: "INV-016 doc bound",
        descriptionAr: null,
        actorId: T_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_T, () =>
        allocations.setAllocations({
          docType: "receipt",
          docId: created.id,
          allocations: [{ openItemId: fixture.items.customerA, amount: "500.0000" }],
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ALLOCATION_EXCEEDS_DOCUMENT" });
    // The post-time bound fires too when rows bypass setAllocations.
    const rows = await withTenant(TENANT_T, () => allocations.listForDoc("receipt", created.id));
    expect(rows).toHaveLength(0);
  });

  it("over-allocation on the OPEN ITEM is rejected at post with zero residue on BOTH sides", async () => {
    const created = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.customerB.id,
        method: "CASH",
        payerName: null,
        currencyCode: "SAR",
        amount: "1500.0000",
        exchangeRate: null,
        valueDate: "2026-04-02",
        reference: null,
        description: "INV-016 item bound",
        descriptionAr: null,
        actorId: T_ACTOR,
      }),
    );
    // The open item is 1000; allocating 1500 against it exceeds the item
    // (the document bound is fine — 1500 ≤ 1500).
    await withTenant(TENANT_T, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: created.id,
        allocations: [{ openItemId: fixture.items.customerB, amount: "1000.0000" }],
        actorId: T_ACTOR,
      }),
    );
    // Sneak past the soft bound: post-time recomputes under the row lock.
    const suClient = await (await import("./fixtures")).su();
    await suClient.query(
      `UPDATE treasury_allocations SET amount = 1500
        WHERE tenant_id = $1 AND receipt_id = $2`,
      [TENANT_T, created.id],
    );
    await suClient.end();
    await expect(withTenant(TENANT_T, () => receipts.post(created.id, T_ACTOR))).rejects.toMatchObject({
      code: "ALLOCATION_EXCEEDS_OPEN_ITEM",
    });
    // Zero residue: no journal, no movement; both sides unchanged.
    await assertZeroTreasuryResidue({ docType: "receipt", docId: created.id });
    const store = await import("../../modules/treasury/infrastructure/treasury.store");
    const item = await withTenant(TENANT_T, () => store.findOpenItemById(fixture.items.customerB));
    expect(item!.settledAmount).toBe("0.0000");
    const doc = await withTenant(TENANT_T, () => receipts.find(created.id));
    expect(doc.status).toBe("DRAFT");
    // Cleanup the smuggled row so later suites see a clean DRAFT.
    const suClient2 = await (await import("./fixtures")).su();
    await suClient2.query(
      `UPDATE treasury_allocations SET amount = 1000
        WHERE tenant_id = $1 AND receipt_id = $2`,
      [TENANT_T, created.id],
    );
    await suClient2.end();
  });

  it("partial allocation bookkeeping is exact; the on-account remainder is an allocatable open item (BR-027)", async () => {
    const created = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.customerB.id,
        method: "CASH",
        payerName: null,
        currencyCode: "SAR",
        amount: "400.0000",
        exchangeRate: null,
        valueDate: "2026-04-03",
        reference: null,
        description: "INV-016 partial",
        descriptionAr: null,
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: created.id,
        allocations: [{ openItemId: fixture.items.customerB, amount: "250.0000" }],
        actorId: T_ACTOR,
      }),
    );
    const result = await withTenant(TENANT_T, () => receipts.post(created.id, T_ACTOR));
    expect(result.allocatedAmount).toBe("250.0000");
    const store = await import("../../modules/treasury/infrastructure/treasury.store");
    const item = await withTenant(TENANT_T, () => store.findOpenItemById(fixture.items.customerB));
    expect(item!.settledAmount).toBe("250.0000");
    expect(item!.outstanding).toBe("750.0000");
    // FIFO suggestion over the partner's open DEBIT items: exactly the
    // 750 available (the on-account CREDIT row is not an allocation target
    // for receipts — receipts settle receivables; the credit nets in the
    // partner balance and is consumed by future invoices, PHASE-012).
    const suggestion = await withTenant(TENANT_T, () =>
      allocations.suggest({ partnerId: fixture.partners.customerB.id, side: "AR", amount: "800.0000" }),
    );
    const total = suggestion.reduce((sum, row) => (Number(sum) + Number(row.amount)).toFixed(4), "0.0000");
    expect(total).toBe("750.0000");
    // BR-027: the on-account remainder IS an explicit open subledger row —
    // the receipt's own credit leg, visible on the partner's AR record.
    const suClient = await (await import("./fixtures")).su();
    const onAccount = await suClient.query(
      `SELECT direction, amount::text AS amount FROM partner_subledger_entries
        WHERE tenant_id = $1 AND partner_id = $2 AND source_type = 'receipt'
        ORDER BY amount`,
      [TENANT_T, fixture.partners.customerB.id],
    );
    await suClient.end();
    const creditRows = onAccount.rows as { direction: string; amount: string }[];
    expect(creditRows.some((row) => row.amount === "250.0000")).toBe(true);
    expect(creditRows.some((row) => row.amount === "150.0000")).toBe(true);
  });
});

describe("CC-02 — concurrent receipts allocating to one open item", () => {
  it("two parallel posts serialize on the row lock: final ≤ item total, never negative, zero loser residue", async () => {
    // A fresh open item of 1000 for customerB via a manual journal.
    const sourceKey = newDocId();
    await withTenant(TENANT_T, async () => {
      await (await import("./fixtures")).tPosting.post(
        {
          source: { docType: "journal_entry", docId: sourceKey, operation: "post" },
          entryDate: "2026-04-05",
          description: { en: "CC-02 item", ar: "بند CC-02" },
          currency: "SAR",
          lines: [
            { purpose: "AR_CONTROL", direction: "DEBIT", amount: "1000.0000", partnerId: fixture.partners.customerB.id },
            { purpose: "SALES_REVENUE", direction: "CREDIT", amount: "1000.0000" },
          ],
        },
        { postedBy: T_ACTOR },
      );
    });
    const store = await import("../../modules/treasury/infrastructure/treasury.store");
    const items = await withTenant(TENANT_T, () =>
      store.listOpenItems({ partnerId: fixture.partners.customerB.id, side: "AR", openOnly: true, limit: 50 }),
    );
    const ccItem = items.find((row) => row.outstanding === "1000.0000")!;

    const mkReceipt = (valueDate: string) =>
      withTenant(TENANT_T, async () => {
        const created = await receipts.create({
          cashAccountId: fixture.accountIds.cash,
          partnerId: fixture.partners.customerB.id,
          method: "CASH",
          payerName: null,
          currencyCode: "SAR",
          amount: "600.0000",
          exchangeRate: null,
          valueDate,
          reference: null,
          description: "CC-02 racer",
          descriptionAr: null,
          actorId: T_ACTOR,
        });
        await allocations.setAllocations({
          docType: "receipt",
          docId: created.id,
          allocations: [{ openItemId: ccItem.id, amount: "600.0000" }],
          actorId: T_ACTOR,
        });
        return receipts.post(created.id, T_ACTOR);
      });

    const outcomes = await Promise.allSettled([mkReceipt("2026-04-10"), mkReceipt("2026-04-11")]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    if (rejected[0]!.status === "rejected") {
      expect((rejected[0]!.reason as { code?: string }).code).toBe("ALLOCATION_EXCEEDS_OPEN_ITEM");
    }
    // Final state: settled 600 ≤ 1000; outstanding never negative.
    const item = await withTenant(TENANT_T, () => store.findOpenItemById(ccItem.id));
    expect(item!.settledAmount).toBe("600.0000");
    expect(item!.outstanding).toBe("400.0000");
  });
});

describe("INV-019 / RC-08 — every cash account proves itself against its movements", () => {
  it("after receipts, payments, transfers with fees, expenses, and shift variance: GL = Σ movements", async () => {
    // A full operation set on the fixture tenant (dates in open periods).
    const receipt = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.customerA.id,
        method: "CASH",
        payerName: null,
        currencyCode: "SAR",
        amount: "120.0000",
        exchangeRate: null,
        valueDate: "2026-05-02",
        reference: null,
        description: "INV-019 op receipt",
        descriptionAr: null,
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () => receipts.post(receipt.id, T_ACTOR));

    const payment = await withTenant(TENANT_T, () =>
      payments.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.supplierA.id,
        method: "CASH",
        payeeName: null,
        currencyCode: "SAR",
        amount: "80.0000",
        exchangeRate: null,
        valueDate: "2026-05-03",
        reference: null,
        description: "INV-019 op payment",
        descriptionAr: null,
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () => payments.post(payment.id, T_ACTOR));

    const transfer = await withTenant(TENANT_T, () =>
      transfers.create({
        fromAccountId: fixture.accountIds.cash,
        toAccountId: fixture.accountIds.bank,
        currencyCode: "SAR",
        amount: "200.0000",
        feeAmount: "3.0000",
        exchangeRate: null,
        valueDate: "2026-05-04",
        reference: null,
        description: "INV-019 op transfer",
        descriptionAr: null,
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () => transfers.post(transfer.id, T_ACTOR));

    const categories = await withTenant(TENANT_T, () => expenses.listCategories(false));
    const category =
      categories.find((row) => row.code === "T-RENT") ??
      (await withTenant(TENANT_T, () =>
        expenses.createCategory({
          code: "T-RENT",
          name: "Rent (T)",
          nameAr: "إيجار (ت)",
          accountId: fixture.accountIds.rentExpense,
          approvalMode: "none",
          actorId: T_ACTOR,
        }),
      ));
    const suFile = await (await import("./fixtures")).su();
    const file = await suFile.query<{ id: string }>(
      `INSERT INTO file_objects (id, tenant_id, owner_type, owner_id, storage_key, name, size_bytes, content_type)
       VALUES (gen_random_uuid(), $1, 'EXPENSE', gen_random_uuid(), 'treasury/inv019.pdf', 'inv019.pdf', 10, 'application/pdf')
       RETURNING id`,
      [TENANT_T],
    );
    await suFile.end();
    const expense = await withTenant(TENANT_T, () =>
      expenses.create({
        categoryId: category.id,
        cashAccountId: fixture.accountIds.cash,
        payeeName: "Ops",
        currencyCode: "SAR",
        amount: "30.0000",
        exchangeRate: null,
        taxCodeId: null,
        receiptFileId: file.rows[0]!.id,
        valueDate: "2026-05-05",
        description: "INV-019 op expense",
        descriptionAr: null,
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () => expenses.submit(expense.id, T_ACTOR));
    await withTenant(TENANT_T, () => expenses.post(expense.id, T_ACTOR));

    // Shift variance (within tolerance path — see the rules suite for the
    // full BR-021 packs): set the tolerance first via settings.
    const suClient = await (await import("./fixtures")).su();
    await suClient.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value)
       VALUES (gen_random_uuid(), $1, 'treasury.shift_variance_tolerance', '"5.0000"'::jsonb)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [TENANT_T],
    );
    await suClient.end();
    const { shifts } = await import("./fixtures");
    const shift = await withTenant(TENANT_T, () =>
      shifts.open({ cashAccountId: fixture.accountIds.cash, openingAmount: "100.0000", actorId: T_ACTOR }),
    );
    await withTenant(TENANT_T, () =>
      shifts.capture({ id: shift.id, cashIn: "50.0000", cashOut: "0.0000", actorId: T_ACTOR }),
    );
    const closed = await withTenant(TENANT_T, () =>
      shifts.close({
        id: shift.id,
        countedAmount: "147.0000", // expected 150 → −3.00 within tolerance 5
        reason: "short by 3",
        actorId: T_ACTOR,
      }),
    );
    expect(closed.status).toBe("CLOSED");
    expect(closed.difference).toBe("-3.0000");
    expect(closed.variancePostedJournalId).not.toBeNull();

    // THE invariant, as-of mid-year and full-history.
    await assertInv019("2026-05-31");
    await assertInv019();

    // The RC-08 framework run is OK and carries the account census.
    const run = await withTenant(TENANT_T, () =>
      treasuryReconciliation.runCashCheck({ asOf: "2026-05-31", runMode: "ON_DEMAND", checkedBy: T_ACTOR }),
    );
    expect(run.status).toBe("OK");
    expect((run.diff as { accounts: number }).accounts).toBeGreaterThanOrEqual(3);
  });

  it("seeded drift (movement without ledger effect) → BROKEN with the offending id + notification + PC-04 lock block", async () => {
    // Seed drift as the app role inside the tenant scope: an orphan movement.
    const app = await (await import("./fixtures")).appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_T]);
    const accountId = fixture.accountIds.petty;
    const driftId = await app.query<{ id: string }>(
      `INSERT INTO cash_movements (id, tenant_id, cash_account_id, direction, amount, currency_code,
                                    exchange_rate, base_amount, source_type, source_id, value_date)
       VALUES (gen_random_uuid(), $1, $2, 'IN', 77, 'SAR', 1, 77, 'receipt',
               gen_random_uuid(), '2026-05-10')
       RETURNING id`,
      [TENANT_T, accountId],
    );
    await app.query("COMMIT");
    await app.end();
    void driftId;

    try {
      const run = await withTenant(TENANT_T, () =>
        treasuryReconciliation.runCashCheck({ asOf: "2026-05-31", runMode: "ON_DEMAND", checkedBy: T_ACTOR }),
      );
      expect(run.status).toBe("BROKEN");
      const diff = run.diff as { offending: { accountId: string }[] };
      expect(diff.offending.length).toBeGreaterThanOrEqual(1);

      // The notification record (RC-03's durable surface): audit event.
      const suClient = await (await import("./fixtures")).su();
      const audit = await suClient.query(
        `SELECT 1 FROM audit_events WHERE tenant_id = $1 AND action = 'treasury.reconciliation_broken'
           AND entity_id = $2`,
        [TENANT_T, run.id],
      );
      await suClient.end();
      expect(audit.rows.length).toBe(1);

      // PC-04: a BROKEN core check blocks the period LOCK.
      const accountingStore = await import("../../modules/accounting/infrastructure/accounting.store");
      const periods = await withTenant(TENANT_T, () => accountingStore.listPeriods(fixture.fiscalYearId));
      const november = periods.find((period) => period.name.endsWith("-11"))!;
      const { tPeriods } = await import("./fixtures");
      await withTenant(TENANT_T, () => tPeriods.softClose(T_ACTOR, november.id));
      await expect(withTenant(TENANT_T, () => tPeriods.lock(T_ACTOR, november.id))).rejects.toMatchObject({
        code: "RECONCILIATION_BROKEN",
      });
      await withTenant(TENANT_T, () => tPeriods.reopen(T_ACTOR, november.id, "PC-04 pack reset"));
    } finally {
      // Ops cleanup (append-only guard: disable the trigger for the
      // maintenance delete, then re-enable — the drift row must not poison
      // later suites).
      const superuser = await (await import("./fixtures")).su();
      await superuser.query(`ALTER TABLE cash_movements DISABLE TRIGGER trg_cash_movements_guard`);
      await superuser.query(
        `DELETE FROM cash_movements WHERE tenant_id = $1 AND cash_account_id = $2
           AND source_type = 'receipt' AND amount = 77 AND value_date = '2026-05-10'`,
        [TENANT_T, fixture.accountIds.petty],
      );
      await superuser.query(`ALTER TABLE cash_movements ENABLE TRIGGER trg_cash_movements_guard`);
      await superuser.end();
    }

    // After cleanup the check is OK again and the lock proceeds (PC-04 green).
    const okRun = await withTenant(TENANT_T, () =>
      treasuryReconciliation.runCashCheck({ asOf: "2026-05-31", runMode: "ON_DEMAND", checkedBy: T_ACTOR }),
    );
    expect(okRun.status).toBe("OK");
    await assertInv019();
  });
});

describe("INV-019 append-only substrate — cash_movements are immutable", () => {
  it("UPDATE and DELETE are grant-denied as erp_app (A4 denial) and the guard fires for superuser misuse", async () => {
    const app = await (await import("./fixtures")).appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_T]);
    const store = await import("../../modules/treasury/infrastructure/treasury.store");
    const movements = await withTenant(TENANT_T, () =>
      store.listMovements({ cashAccountId: fixture.accountIds.cash, limit: 1 }),
    );
    const target = movements[0]!;
    await expect(
      app.query("UPDATE cash_movements SET amount = 999 WHERE id = $1", [target.id]),
    ).rejects.toMatchObject({ code: "42501" });
    // A failed statement aborts the tx — each probe runs in its own tx.
    await app.query("ROLLBACK");
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_T]);
    await expect(app.query("DELETE FROM cash_movements WHERE id = $1", [target.id])).rejects.toMatchObject({
      code: "42501",
    });
    await app.query("ROLLBACK");
    await app.end();
    // Defense in depth: even the superuser path trips the guard trigger.
    const superuser = await (await import("./fixtures")).su();
    await expect(
      superuser.query("UPDATE cash_movements SET amount = 999 WHERE id = $1", [target.id]),
    ).rejects.toThrow(/append-only/);
    await superuser.end();
    void accounts;
  });
});

void withTenantRaw;
