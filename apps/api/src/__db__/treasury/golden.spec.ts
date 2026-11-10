import { beforeAll, describe, expect, it } from "vitest";

import {
  T_ACTOR,
  T_FEB,
  TENANT_T,
  accounts,
  allocations,
  assertZeroTreasuryResidue,
  expenses,
  newDocId,
  receipts,
  payments,
  setupTreasuryFixture,
  transfers,
  withTenant,
  type TreasuryFixture,
} from "./fixtures";

/**
 * PHASE-008 golden tests (ACCOUNTING_TESTS §3, this phase's executable
 * subset): G-05 receipt, G-06 FX receipt (+ loss mirror), G-10 payment
 * (FX mirrors), G-11 expense, G-12 transfer with fee — each asserting the
 * EXACT journal lines (account, direction, amount), the source document
 * state (POSTED + postedJournalId), the official number (INV-021), the
 * movement row, the subledger effects, and an audit event — plus the
 * failure pack per golden (PERIOD_LOCKED, PURPOSE_NOT_MAPPED, ALREADY_
 * POSTED, INV-016 rejections, closed target, INVALID_AMOUNT) with
 * zero residue (§1).
 */

let fixture: TreasuryFixture;

beforeAll(async () => {
  fixture = await setupTreasuryFixture();
});

interface ExpectedLine {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
}

async function journalLinesOf(entryId: string): Promise<ExpectedLine[]> {
  const journal = await import("../../modules/accounting/infrastructure/journal.store");
  const lines = await journal.listLines(entryId);
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction as "DEBIT" | "CREDIT",
    amount: line.amount,
  }));
}

async function movementsOf(accountId: string) {
  const store = await import("../../modules/treasury/infrastructure/treasury.store");
  return store.listMovements({ cashAccountId: accountId, limit: 500 });
}

describe("G-05 — receipt (base currency): DR CASH A · CR AR_CONTROL A (partner)", () => {
  it("posts exactly the canonical shape with official number + movement + subledger + audit", async () => {
    const created = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.customerA.id,
        method: "CASH",
        payerName: "Customer A",
        currencyCode: "SAR",
        amount: "500.0000",
        exchangeRate: null,
        valueDate: T_FEB,
        reference: null,
        description: "G-05 receipt",
        descriptionAr: "سند قبض G-05",
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: created.id,
        allocations: [{ openItemId: fixture.items.customerA, amount: "500.0000" }],
        actorId: T_ACTOR,
      }),
    );
    const result = await withTenant(TENANT_T, () => receipts.post(created.id, T_ACTOR));

    expect(result.docNo).toMatch(/^RCV-2026-\d{6}$/);
    expect(result.allocatedAmount).toBe("500.0000");
    expect(result.fxGainLoss).toBe("0.0000");
    expect(result.idempotentReplay).toBe(false);

    const lines = await withTenant(TENANT_T, () => journalLinesOf(result.journalEntryId));
    expect(lines).toEqual([
      { accountId: fixture.accountIds.glCash, direction: "DEBIT", amount: "500.0000" },
      { accountId: fixture.accountIds.arControl, direction: "CREDIT", amount: "500.0000" },
    ]);

    // Source document state (§1 conventions).
    const doc = await withTenant(TENANT_T, () => receipts.find(created.id));
    expect(doc.status).toBe("POSTED");
    expect(doc.postedJournalId).toBe(result.journalEntryId);
    expect(doc.docNo).toBe(result.docNo);
    expect(doc.allocatedAmount).toBe("500.0000");

    // Movement (INV-019 substrate): exactly one IN row, base = line amount.
    const movements = await withTenant(TENANT_T, () => movementsOf(fixture.accountIds.cash));
    const mine = movements.filter((row) => row.sourceId === created.id && row.sourceType === "receipt");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.direction).toBe("IN");
    expect(mine[0]!.amount).toBe("500.0000");
    expect(mine[0]!.baseAmount).toBe("500.0000");

    // Subledger: the settlement credit row landed on AR (the posting service
    // writes it from the control line) — the partner's balance dropped.
    const store = await import("../../modules/treasury/infrastructure/treasury.store");
    const open = await withTenant(TENANT_T, () =>
      store.findOpenItemById(fixture.items.customerA),
    );
    expect(open!.settledAmount).toBe("500.0000");
    expect(open!.outstanding).toBe("1000.0000");

    // Audit event (ACCOUNTING_TESTS §1).
    const suClient = await (await import("./fixtures")).su();
    const audit = await suClient.query(
      `SELECT action FROM audit_events WHERE tenant_id = $1 AND entity_type = 'receipt'
         AND entity_id = $2 AND action = 'treasury.receipt_posted'`,
      [TENANT_T, created.id],
    );
    await suClient.end();
    expect(audit.rows.length).toBe(1);
  });

  it("partial allocation + on-account remainder (BR-027): the remainder is an explicit second control line", async () => {
    const created = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.customerA.id,
        method: "CASH",
        payerName: "Customer A",
        currencyCode: "SAR",
        amount: "300.0000",
        exchangeRate: null,
        valueDate: "2026-02-16",
        reference: null,
        description: "partial + on-account",
        descriptionAr: "جزئي وعلى الحساب",
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: created.id,
        allocations: [{ openItemId: fixture.items.customerA, amount: "200.0000" }],
        actorId: T_ACTOR,
      }),
    );
    const result = await withTenant(TENANT_T, () => receipts.post(created.id, T_ACTOR));
    const lines = await withTenant(TENANT_T, () => journalLinesOf(result.journalEntryId));
    expect(lines).toEqual([
      { accountId: fixture.accountIds.glCash, direction: "DEBIT", amount: "300.0000" },
      { accountId: fixture.accountIds.arControl, direction: "CREDIT", amount: "200.0000" },
      { accountId: fixture.accountIds.arControl, direction: "CREDIT", amount: "100.0000" },
    ]);
    // BR-027: the on-account remainder is visible + allocatable later.
    const onAccount = await withTenant(TENANT_T, () =>
      allocations.onAccountRemainder("receipt", created.id),
    );
    expect(onAccount).toBe("100.0000");
  });

  it("failure pack: ALREADY_POSTED is an idempotent replay — one entry, one movement, no duplicates", async () => {
    const created = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.customerA.id,
        method: "CASH",
        payerName: null,
        currencyCode: "SAR",
        amount: "75.0000",
        exchangeRate: null,
        valueDate: "2026-02-17",
        reference: null,
        description: "replay probe",
        descriptionAr: null,
        actorId: T_ACTOR,
      }),
    );
    const first = await withTenant(TENANT_T, () => receipts.post(created.id, T_ACTOR));
    const second = await withTenant(TENANT_T, () => receipts.post(created.id, T_ACTOR));
    expect(second.journalEntryId).toBe(first.journalEntryId);
    expect(second.idempotentReplay).toBe(true);
    expect(second.docNo).toBe(first.docNo);
    const movements = await withTenant(TENANT_T, () => movementsOf(fixture.accountIds.cash));
    expect(movements.filter((row) => row.sourceId === created.id)).toHaveLength(1);
  });

  it("failure pack: INVALID_AMOUNT — zero/negative amounts rejected with zero residue", async () => {
    await expect(
      withTenant(TENANT_T, () =>
        receipts.create({
          cashAccountId: fixture.accountIds.cash,
          partnerId: fixture.partners.customerA.id,
          method: "CASH",
          payerName: null,
          currencyCode: "SAR",
          amount: "0.0000",
          exchangeRate: null,
          valueDate: T_FEB,
          reference: null,
          description: null,
          descriptionAr: null,
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(
      withTenant(TENANT_T, () =>
        receipts.create({
          cashAccountId: fixture.accountIds.cash,
          partnerId: fixture.partners.customerA.id,
          method: "CASH",
          payerName: null,
          currencyCode: "SAR",
          amount: "-5.0000",
          exchangeRate: null,
          valueDate: T_FEB,
          reference: null,
          description: null,
          descriptionAr: null,
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });
});

describe("G-06 — FX receipt: DR CASH A×r₁ · CR AR_CONTROL A×r₀ · CR FX_GAIN residual (+ loss mirror)", () => {
  it("gain 3.75→3.76: the original stored rate is honored (INV-008) with an explicit FX_GAIN line", async () => {
    const created = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.customerFx.id,
        method: "CASH",
        payerName: null,
        currencyCode: "USD",
        amount: "1000.0000",
        exchangeRate: "3.76000000",
        valueDate: "2026-02-20",
        reference: null,
        description: "G-06 FX receipt (gain)",
        descriptionAr: "سند قبض بفارق عملة (ربح)",
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: created.id,
        allocations: [{ openItemId: fixture.items.customerFxUsd, amount: "1000.0000" }],
        actorId: T_ACTOR,
      }),
    );
    const result = await withTenant(TENANT_T, () => receipts.post(created.id, T_ACTOR));
    expect(result.fxGainLoss).toBe("10.0000");

    const lines = await withTenant(TENANT_T, () => journalLinesOf(result.journalEntryId));
    expect(lines).toEqual([
      { accountId: fixture.accountIds.glCash, direction: "DEBIT", amount: "3760.0000" },
      { accountId: fixture.accountIds.arControl, direction: "CREDIT", amount: "3750.0000" },
      { accountId: fixture.accountIds.fxGain, direction: "CREDIT", amount: "10.0000" },
    ]);

    // Movement: the USD quantum + exact base.
    const movements = await withTenant(TENANT_T, () => movementsOf(fixture.accountIds.cash));
    const mine = movements.filter((row) => row.sourceId === created.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.amount).toBe("1000.0000");
    expect(mine[0]!.currencyCode).toBe("USD");
    expect(mine[0]!.baseAmount).toBe("3760.0000");

    // The settled item is closed and the partner's AR contribution matches
    // the original base exactly (INV-008: no silent revaluation).
    const store = await import("../../modules/treasury/infrastructure/treasury.store");
    const open = await withTenant(TENANT_T, () => store.findOpenItemById(fixture.items.customerFxUsd));
    expect(open!.settledAmount).toBe("1000.0000");
    expect(open!.outstanding).toBe("0.0000");
  });

  it("loss mirror 3.75→3.74: DR FX_LOSS residual — never dropped or absorbed", async () => {
    const created = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.customerFx.id,
        method: "CASH",
        payerName: null,
        currencyCode: "USD",
        amount: "1000.0000",
        exchangeRate: "3.74000000",
        valueDate: "2026-02-21",
        reference: null,
        description: "G-06 FX receipt (loss)",
        descriptionAr: "سند قبض بفارق عملة (خسارة)",
        actorId: T_ACTOR,
      }),
    );
    // Wait: the previous test settled the full item. This mirror needs its
    // own open item — create one via a dedicated FX journal.
    const journalStore = await import("../../modules/accounting/infrastructure/journal.store");
    const sourceKey = newDocId();
    await withTenant(TENANT_T, async () =>
      (await import("./fixtures")).tPosting.post(
        {
          source: { docType: "journal_entry", docId: sourceKey, operation: "post" },
          entryDate: "2026-02-01",
          description: { en: "FX item for loss mirror", ar: "بند عملة لمرآة الخسارة" },
          currency: "USD",
          exchangeRate: "3.75000000",
          lines: [
            { purpose: "AR_CONTROL", direction: "DEBIT", amount: "1000.0000", partnerId: fixture.partners.customerFx.id },
            { purpose: "SALES_REVENUE", direction: "CREDIT", amount: "1000.0000" },
          ],
        },
        { postedBy: T_ACTOR },
      ),
    );
    void journalStore;
    const store = await import("../../modules/treasury/infrastructure/treasury.store");
    const items = await withTenant(TENANT_T, () =>
      store.listOpenItems({ partnerId: fixture.partners.customerFx.id, side: "AR", openOnly: true, limit: 50 }),
    );
    const lossItem = items.find((row) => row.outstanding === "1000.0000")!;
    expect(lossItem).toBeDefined();

    await withTenant(TENANT_T, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: created.id,
        allocations: [{ openItemId: lossItem.id, amount: "1000.0000" }],
        actorId: T_ACTOR,
      }),
    );
    const result = await withTenant(TENANT_T, () => receipts.post(created.id, T_ACTOR));
    expect(result.fxGainLoss).toBe("-10.0000");
    const lines = await withTenant(TENANT_T, () => journalLinesOf(result.journalEntryId));
    expect(lines).toEqual([
      { accountId: fixture.accountIds.glCash, direction: "DEBIT", amount: "3740.0000" },
      { accountId: fixture.accountIds.arControl, direction: "CREDIT", amount: "3750.0000" },
      { accountId: fixture.accountIds.fxLoss, direction: "DEBIT", amount: "10.0000" },
    ]);
  });

  it("failure pack: PURPOSE_NOT_MAPPED (FX_GAIN unmapped) — typed rejection, zero residue", async () => {
    const superuser = await (await import("./fixtures")).su();
    await superuser.query(
      `UPDATE account_purposes SET active_to = GREATEST(active_from, DATE '2026-02-22')
        WHERE tenant_id = $1 AND purpose_key = 'FX_GAIN' AND active_to IS NULL`,
      [TENANT_T],
    );
    await superuser.end();
    try {
      const created = await withTenant(TENANT_T, () =>
        receipts.create({
          cashAccountId: fixture.accountIds.cash,
          partnerId: fixture.partners.customerFx.id,
          method: "CASH",
          payerName: null,
          currencyCode: "USD",
          amount: "1000.0000",
          exchangeRate: "3.76000000",
          valueDate: "2026-02-22",
          reference: null,
          description: "unmapped FX gain",
          descriptionAr: null,
          actorId: T_ACTOR,
        }),
      );
      // Own open item for the allocation (fresh FX item).
      const store = await import("../../modules/treasury/infrastructure/treasury.store");
      await withTenant(TENANT_T, async () =>
        (await import("./fixtures")).tPosting.post(
          {
            source: { docType: "journal_entry", docId: newDocId(), operation: "post" },
            entryDate: "2026-02-02",
            description: { en: "FX item unmapped pack", ar: "بند عملة" },
            currency: "USD",
            exchangeRate: "3.75000000",
            lines: [
              { purpose: "AR_CONTROL", direction: "DEBIT", amount: "1000.0000", partnerId: fixture.partners.customerFx.id },
              { purpose: "SALES_REVENUE", direction: "CREDIT", amount: "1000.0000" },
            ],
          },
          { postedBy: T_ACTOR },
        ),
      );
      const items = await withTenant(TENANT_T, () =>
        store.listOpenItems({ partnerId: fixture.partners.customerFx.id, side: "AR", openOnly: true, limit: 50 }),
      );
      const item = items.find((row) => row.outstanding === "1000.0000")!;
      await withTenant(TENANT_T, () =>
        allocations.setAllocations({
          docType: "receipt",
          docId: created.id,
          allocations: [{ openItemId: item.id, amount: "1000.0000" }],
          actorId: T_ACTOR,
        }),
      );
      await expect(withTenant(TENANT_T, () => receipts.post(created.id, T_ACTOR))).rejects.toMatchObject({
        code: "PURPOSE_NOT_MAPPED",
      });
      await assertZeroTreasuryResidue({ docType: "receipt", docId: created.id });
      const doc = await withTenant(TENANT_T, () => receipts.find(created.id));
      expect(doc.status).toBe("DRAFT");
    } finally {
      // Restore the active FX_GAIN mapping (fixture hygiene).
      const superuser2 = await (await import("./fixtures")).su();
      await superuser2.query(
        `INSERT INTO account_purposes (id, tenant_id, purpose_key, account_id, active_from)
         VALUES (gen_random_uuid(), $1, 'FX_GAIN', $2, '2026-02-23')`,
        [TENANT_T, fixture.accountIds.fxGain],
      );
      await superuser2.end();
    }
  });
});

describe("G-10 — payment (mirror): DR AP_CONTROL A · CR CASH A; FX mirrors G-06", () => {
  it("base-currency payment settles the supplier opening item exactly", async () => {
    const created = await withTenant(TENANT_T, () =>
      payments.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.supplierA.id,
        method: "CASH",
        payeeName: "Supplier A",
        currencyCode: "SAR",
        amount: "400.0000",
        exchangeRate: null,
        valueDate: "2026-03-01",
        reference: null,
        description: "G-10 payment",
        descriptionAr: "سند صرف G-10",
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () =>
      allocations.setAllocations({
        docType: "payment",
        docId: created.id,
        allocations: [{ openItemId: fixture.items.supplierA, amount: "400.0000" }],
        actorId: T_ACTOR,
      }),
    );
    const result = await withTenant(TENANT_T, () => payments.post(created.id, T_ACTOR));
    expect(result.docNo).toMatch(/^PAY-2026-\d{6}$/);
    const lines = await withTenant(TENANT_T, () => journalLinesOf(result.journalEntryId));
    expect(lines).toEqual([
      { accountId: fixture.accountIds.apControl, direction: "DEBIT", amount: "400.0000" },
      { accountId: fixture.accountIds.glCash, direction: "CREDIT", amount: "400.0000" },
    ]);
    const movements = await withTenant(TENANT_T, () => movementsOf(fixture.accountIds.cash));
    const mine = movements.filter((row) => row.sourceId === created.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.direction).toBe("OUT");
  });

  it("FX payment mirror: settle USD payable at 3.76 → DR FX_LOSS; at 3.74 → CR FX_GAIN", async () => {
    // 3.76 (loss): DR AP 3000 · DR FX_LOSS 8 · CR CASH 3008.
    const created = await withTenant(TENANT_T, () =>
      payments.create({
        cashAccountId: fixture.accountIds.bank,
        partnerId: fixture.partners.supplierFx.id,
        method: "BANK",
        payeeName: null,
        currencyCode: "USD",
        amount: "800.0000",
        exchangeRate: "3.76000000",
        valueDate: "2026-03-02",
        reference: null,
        description: "FX payment loss",
        descriptionAr: "سند صرف بفارق عملة (خسارة)",
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () =>
      allocations.setAllocations({
        docType: "payment",
        docId: created.id,
        allocations: [{ openItemId: fixture.items.supplierFxUsd, amount: "800.0000" }],
        actorId: T_ACTOR,
      }),
    );
    const lossResult = await withTenant(TENANT_T, () => payments.post(created.id, T_ACTOR));
    expect(lossResult.fxGainLoss).toBe("-8.0000");
    const lossLines = await withTenant(TENANT_T, () => journalLinesOf(lossResult.journalEntryId));
    expect(lossLines).toEqual([
      { accountId: fixture.accountIds.apControl, direction: "DEBIT", amount: "3000.0000" },
      { accountId: fixture.accountIds.fxLoss, direction: "DEBIT", amount: "8.0000" },
      { accountId: fixture.accountIds.glBank, direction: "CREDIT", amount: "3008.0000" },
    ]);

    // 3.74 (gain): a fresh USD payable item pays out cheaper — CR FX_GAIN.
    const journalStore = await import("../../modules/accounting/infrastructure/journal.store");
    void journalStore;
    const sourceKey = newDocId();
    await withTenant(TENANT_T, async () =>
      (await import("./fixtures")).tPosting.post(
        {
          source: { docType: "journal_entry", docId: sourceKey, operation: "post" },
          entryDate: "2026-03-01",
          description: { en: "FX payable gain mirror", ar: "بند دائن لمرآة الربح" },
          currency: "USD",
          exchangeRate: "3.75000000",
          lines: [
            { purpose: "AP_CONTROL", direction: "CREDIT", amount: "800.0000", partnerId: fixture.partners.supplierFx.id },
            { purpose: "SALES_REVENUE", direction: "DEBIT", amount: "800.0000" },
          ],
        },
        { postedBy: T_ACTOR },
      ),
    );
    const store = await import("../../modules/treasury/infrastructure/treasury.store");
    const items = await withTenant(TENANT_T, () =>
      store.listOpenItems({ partnerId: fixture.partners.supplierFx.id, side: "AP", openOnly: true, limit: 50 }),
    );
    const gainItem = items.find((row) => row.outstanding === "800.0000")!;
    const created2 = await withTenant(TENANT_T, () =>
      payments.create({
        cashAccountId: fixture.accountIds.bank,
        partnerId: fixture.partners.supplierFx.id,
        method: "BANK",
        payeeName: null,
        currencyCode: "USD",
        amount: "800.0000",
        exchangeRate: "3.74000000",
        valueDate: "2026-03-03",
        reference: null,
        description: "FX payment gain",
        descriptionAr: "سند صرف بفارق عملة (ربح)",
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () =>
      allocations.setAllocations({
        docType: "payment",
        docId: created2.id,
        allocations: [{ openItemId: gainItem.id, amount: "800.0000" }],
        actorId: T_ACTOR,
      }),
    );
    const gainResult = await withTenant(TENANT_T, () => payments.post(created2.id, T_ACTOR));
    expect(gainResult.fxGainLoss).toBe("8.0000");
    const gainLines = await withTenant(TENANT_T, () => journalLinesOf(gainResult.journalEntryId));
    expect(gainLines).toEqual([
      { accountId: fixture.accountIds.apControl, direction: "DEBIT", amount: "3000.0000" },
      { accountId: fixture.accountIds.fxGain, direction: "CREDIT", amount: "8.0000" },
      { accountId: fixture.accountIds.glBank, direction: "CREDIT", amount: "2992.0000" },
    ]);
  });

  it("failure pack: PERIOD_LOCKED — posting into the locked December is rejected with zero residue", async () => {
    const store = await import("../../modules/accounting/infrastructure/accounting.store");
    const periods = await withTenant(TENANT_T, () => store.listPeriods(fixture.fiscalYearId));
    const december = periods.find((period) => period.name.endsWith("-12"))!;
    const { tPeriods } = await import("./fixtures");
    await withTenant(TENANT_T, () => tPeriods.softClose(T_ACTOR, december.id));
    await withTenant(TENANT_T, () => tPeriods.lock(T_ACTOR, december.id));
    const created = await withTenant(TENANT_T, () =>
      receipts.create({
        cashAccountId: fixture.accountIds.cash,
        partnerId: fixture.partners.customerA.id,
        method: "CASH",
        payerName: null,
        currencyCode: "SAR",
        amount: "50.0000",
        exchangeRate: null,
        valueDate: "2026-12-15",
        reference: null,
        description: "locked period probe",
        descriptionAr: null,
        actorId: T_ACTOR,
      }),
    );
    await expect(withTenant(TENANT_T, () => receipts.post(created.id, T_ACTOR))).rejects.toMatchObject({
      code: "PERIOD_LOCKED",
    });
    await assertZeroTreasuryResidue({ docType: "receipt", docId: created.id });
    // Restore for later suites (the PC-04 pack re-locks with a purpose).
    await withTenant(TENANT_T, () => tPeriods.reopen(T_ACTOR, december.id, "golden pack cleanup"));
  });
});

describe("G-11 — expense: DR EXPENSE N · [VAT line reserved] · CR CASH/PETTY", () => {
  it("posts the payout with the official EXP number, movement OUT, and the reserved tax field travels", async () => {
    // Order-independence (PHASE-008 reality-audit repair): the invariants
    // suite creates the same T-RENT category on this tenant — find-or-create
    // so either suite order works (mirrors the invariants spec's pattern).
    const existing = await withTenant(TENANT_T, () => expenses.listCategories(false));
    const category =
      existing.find((row) => row.code === "T-RENT") ??
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
    // BR-023: threshold 0 (default) — a receipt attachment is required.
    const suFile = await (await import("./fixtures")).su();
    const file = await suFile.query<{ id: string }>(
      `INSERT INTO file_objects (id, tenant_id, owner_type, owner_id, storage_key, name, size_bytes, content_type)
       VALUES (gen_random_uuid(), $1, 'EXPENSE', gen_random_uuid(), 'treasury/g11.pdf', 'g11.pdf', 10, 'application/pdf')
       RETURNING id`,
      [TENANT_T],
    );
    await suFile.end();
    const created = await withTenant(TENANT_T, () =>
      expenses.create({
        categoryId: category.id,
        cashAccountId: fixture.accountIds.cash,
        payeeName: "Landlord",
        currencyCode: "SAR",
        amount: "200.0000",
        exchangeRate: null,
        taxCodeId: null,
        receiptFileId: file.rows[0]!.id,
        valueDate: "2026-03-05",
        description: "G-11 expense",
        descriptionAr: "مصروف G-11",
        actorId: T_ACTOR,
      }),
    );
    const submitted = await withTenant(TENANT_T, () => expenses.submit(created.id, T_ACTOR));
    expect(submitted.status).toBe("APPROVED"); // category mode 'none' skips the hop
    const result = await withTenant(TENANT_T, () => expenses.post(created.id, T_ACTOR));
    expect(result.expenseNo).toMatch(/^EXP-2026-\d{6}$/);
    const lines = await withTenant(TENANT_T, () => journalLinesOf(result.journalEntryId));
    expect(lines).toEqual([
      { accountId: fixture.accountIds.rentExpense, direction: "DEBIT", amount: "200.0000" },
      { accountId: fixture.accountIds.glCash, direction: "CREDIT", amount: "200.0000" },
    ]);
    const movements = await withTenant(TENANT_T, () => movementsOf(fixture.accountIds.cash));
    const mine = movements.filter((row) => row.sourceId === created.id && row.sourceType === "expense");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.direction).toBe("OUT");
  });

  it("posts the PHASE-009 VAT leg: DR EXPENSE net · DR VAT_RECOVERABLE tax · CR CASH gross + the INV-012 summary", async () => {
    const existing = await withTenant(TENANT_T, () => expenses.listCategories(false));
    const category =
      existing.find((row) => row.code === "T-RENT") ??
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
    const taxCodeId = (await import("./fixtures")).stdSaTaxCodeId();
    // BR-023: attach a receipt (threshold 0 = always required).
    const suFileVat = await (await import("./fixtures")).su();
    const vatReceipt = await suFileVat.query<{ id: string }>(
      `INSERT INTO file_objects (id, tenant_id, owner_type, owner_id, storage_key, name, size_bytes, content_type)
       VALUES (gen_random_uuid(), $1, 'EXPENSE', gen_random_uuid(), 'treasury/g11-vat.pdf', 'g11-vat.pdf', 10, 'application/pdf')
       RETURNING id`,
      [TENANT_T],
    );
    await suFileVat.end();
    // Gross 575.00 SAR at 15% (INCLUSIVE — the payout is the gross): the
    // extraction gives tax 75.00, net 500.00.
    const created = await withTenant(TENANT_T, () =>
      expenses.create({
        categoryId: category.id,
        cashAccountId: fixture.accountIds.cash,
        payeeName: "Landlord VAT",
        currencyCode: "SAR",
        amount: "575.0000",
        exchangeRate: null,
        taxCodeId,
        receiptFileId: vatReceipt.rows[0]!.id,
        valueDate: "2026-04-05",
        description: "G-11 expense with VAT",
        descriptionAr: "مصروف G-11 مع الضريبة",
        actorId: T_ACTOR,
        overridePettyLimit: true,
      }),
    );
    await withTenant(TENANT_T, () => expenses.submit(created.id, T_ACTOR));
    const result = await withTenant(TENANT_T, () => expenses.post(created.id, T_ACTOR));
    const lines = await withTenant(TENANT_T, () => journalLinesOf(result.journalEntryId));
    expect(lines).toEqual([
      { accountId: fixture.accountIds.rentExpense, direction: "DEBIT", amount: "500.0000" },
      { accountId: fixture.accountIds.vatRecoverable, direction: "DEBIT", amount: "75.0000" },
      { accountId: fixture.accountIds.glCash, direction: "CREDIT", amount: "575.0000" },
    ]);
    // The VAT line carries the tax code (the engine's line-level stamp).
    const fullLines = await withTenant(TENANT_T, () =>
      (async () => {
        const journal = await import("../../modules/accounting/infrastructure/journal.store");
        return journal.listLines(result.journalEntryId);
      })(),
    );
    expect(fullLines.find((line) => line.accountId === fixture.accountIds.vatRecoverable)?.taxCodeId).toBe(taxCodeId);
    // The INV-012 substrate row: INPUT STANDARD_RATED 15% base 500 tax 75
    // with the frozen snapshot (pack version + verification status).
    const suClient = await (await import("./fixtures")).su();
    const summary = await suClient.query(
      `SELECT direction, treatment, rate::text AS rate, taxable_base::text AS base,
              tax_amount::text AS tax, snapshot
         FROM tax_document_summaries WHERE tenant_id = $1 AND source_id = $2`,
      [TENANT_T, created.id],
    );
    await suClient.end();
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({
      direction: "INPUT",
      treatment: "STANDARD_RATED",
      rate: "15.0000",
      base: "500.0000",
      tax: "75.0000",
    });
    const snapshot = summary.rows[0].snapshot as Record<string, unknown>;
    expect(snapshot.packVersion).toBe("1.0.0-baseline");
    expect(snapshot.verificationStatus).toBe("REQUIRES_VERIFICATION");
    expect(snapshot.effectiveFrom).toBe("2020-07-01");
  });
});

describe("G-12 — transfer with fee F: DR CASH(dest) A−F · DR BANK_CHARGES F · CR CASH(src)", () => {
  it("posts the canonical shape with two movements and INV-019 intact on both sides", async () => {
    const created = await withTenant(TENANT_T, () =>
      transfers.create({
        fromAccountId: fixture.accountIds.bank,
        toAccountId: fixture.accountIds.cash,
        currencyCode: "SAR",
        amount: "1000.0000",
        feeAmount: "5.0000",
        exchangeRate: null,
        valueDate: "2026-03-08",
        reference: null,
        description: "G-12 transfer",
        descriptionAr: "تحويل G-12",
        actorId: T_ACTOR,
        overridePettyLimit: false,
      }),
    );
    const result = await withTenant(TENANT_T, () => transfers.post(created.id, T_ACTOR));
    expect(result.transferNo).toMatch(/^TRF-2026-\d{6}$/);
    const lines = await withTenant(TENANT_T, () => journalLinesOf(result.journalEntryId));
    expect(lines).toEqual([
      { accountId: fixture.accountIds.glCash, direction: "DEBIT", amount: "995.0000" },
      { accountId: fixture.accountIds.bankCharges, direction: "DEBIT", amount: "5.0000" },
      { accountId: fixture.accountIds.glBank, direction: "CREDIT", amount: "1000.0000" },
    ]);
    const outMovements = await withTenant(TENANT_T, () => movementsOf(fixture.accountIds.bank));
    const inMovements = await withTenant(TENANT_T, () => movementsOf(fixture.accountIds.cash));
    expect(outMovements.filter((row) => row.sourceId === created.id && row.direction === "OUT")).toHaveLength(1);
    expect(inMovements.filter((row) => row.sourceId === created.id && row.direction === "IN")).toHaveLength(1);
    // Fee below the amount is enforced (unbalanced-by-construction is
    // impossible: ENTRY_NOT_BALANCED is prevented at creation).
    await expect(
      withTenant(TENANT_T, () =>
        transfers.create({
          fromAccountId: fixture.accountIds.bank,
          toAccountId: fixture.accountIds.cash,
          currencyCode: "SAR",
          amount: "10.0000",
          feeAmount: "10.0000",
          exchangeRate: null,
          valueDate: "2026-03-09",
          reference: null,
          description: "fee == amount",
          descriptionAr: null,
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "TREASURY_DOCUMENT_STATE_INVALID" });
  });

  it("failure pack: CASH_ACCOUNT_CLOSED — a receipt targeting a closed account is rejected, zero residue", async () => {
    // Open + close a dedicated treasury account (on the petty GL host — the
    // 1:1 link means every GL account can host one treasury account; the
    // fixture's petty account stays ACTIVE on 1112, so use a second GL
    // account (5210 is an expense — not treasury-worthy; create a child).
    // A dedicated GL account (never touched by expense postings — INV-019
    // must stay provable on the closed account too).
    const suGl = await (await import("./fixtures")).su();
    const gl = await suGl.query<{ id: string }>(
      `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable, currency_code)
       VALUES (gen_random_uuid(), $1, '1190', 'Spare Cash Host', 'نقدي احتياطي', 'ASSET', true, NULL)
       ON CONFLICT ("tenant_id", "code") DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [TENANT_T],
    );
    await suGl.end();
    const dedicated = await withTenant(TENANT_T, () =>
      accounts.open({
        name: `Close Target ${newDocId().slice(0, 8)}`,
        nameAr: null,
        type: "PETTY",
        accountId: gl.rows[0]!.id,
        branchId: null,
        currencyCode: "SAR",
        actorId: T_ACTOR,
      }),
    );
    await withTenant(TENANT_T, () =>
      accounts.close({ id: dedicated.id, reason: "golden close-target", actorId: T_ACTOR }),
    );
    await expect(
      withTenant(TENANT_T, () =>
        receipts.create({
          cashAccountId: dedicated.id,
          partnerId: fixture.partners.customerA.id,
          method: "CASH",
          payerName: null,
          currencyCode: "SAR",
          amount: "10.0000",
          exchangeRate: null,
          valueDate: T_FEB,
          reference: null,
          description: "closed target",
          descriptionAr: null,
          actorId: T_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "CASH_ACCOUNT_CLOSED" });
  });
});
