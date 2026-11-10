import { beforeAll, describe, expect, it } from "vitest";
import { Decimal } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { PettyCashGuard } from "../../modules/treasury/application/petty-cash-service";
import { ExpenseService } from "../../modules/treasury/application/expense-service";
import * as treasuryStore from "../../modules/treasury/infrastructure/treasury.store";
import * as accountingStore from "../../modules/accounting/infrastructure/accounting.store";
import * as journalStore from "../../modules/accounting/infrastructure/journal.store";
import { SalesRepService } from "../../modules/sales/application/reps";
import { SettlementService, NO_VARIANCE_JOURNAL_ID } from "../../modules/distribution/application/settlement-service";
import {
  S_ACTOR,
  S_SALES,
  TENANT_S,
  creditNotes,
  receipts,
  salesInvoices,
  sCoa,
  setSalesSetting,
  setupSalesFixture,
  treasuryAccounts,
  type SalesFixture,
} from "../sales/fixtures";
import { superuserClient } from "../test-db";

/**
 * PHASE-017 T10 settlement reconciliation packs (DB-backed on the real
 * sales fixture, tenant S): the seeded rep day of §6 — cash sales, credit
 * sales, a cash return, collections, an approved rep expense — settles
 * with expected = opening + cash sales + collections − refunds − expenses;
 * the variance ALWAYS posts with a reason (BR-021: never netted); the
 * beyond-tolerance path demands reason + separate approver (BR-034) and the
 * bank deposit leg; POSTED locks the rep's day; INV-019 holds exactly
 * (rep cash = Σ movements = GL balance).
 */

const DAY_1 = "2026-03-05"; // expected-cash math (perfect count)
const DAY_2 = "2026-03-06"; // shortage variance + deposit + day lock
const DAY_3 = "2026-03-07"; // pending-documents gate
const DAY_4 = "2026-03-08"; // self-approval block
const DAY_5 = "2026-03-09"; // surplus + within-tolerance skip-approve

let fixture: SalesFixture;
let settlements: SettlementService;
let expenseService: ExpenseService;
let repId = "";
let repCashId = "";
let repCashGl = "";
let bankTreasuryId = "";
let bankGl = "";
let cashDifferenceGl = "";
let expenseCategoryId = "";

beforeAll(async () => {
  fixture = await setupSalesFixture();
  const audit = new AuditService(new DrizzleAuditStore());
  const posting = new PostingService(audit, new PartnerSubledgerService());
  const numbering = new NumberingService(audit);
  settlements = new SettlementService(audit, posting, numbering);
  expenseService = new ExpenseService(
    audit,
    posting,
    numbering,
    new PettyCashGuard(audit),
    new TaxResolverService(),
  );

  await setSalesSetting("treasury.expense_receipt_threshold", "10000.0000");
  // A cash-return credit note references a CASH invoice — whose AR
  // outstanding is 0 by design (it settled at the counter) — so the
  // INV-016 standalone-credit policy must be on for the refund fixture
  // (the sanctioned tenant setting for exactly this shape).
  await setSalesSetting("sales.credit_note_standalone_allowed", true);

  await withTenant(TENANT_S, async () => {
    // CASH_DIFFERENCE → 5900 (the BR-021 host — mirrors the treasury fixture).
    if ((await accountingStore.findActivePurpose("CASH_DIFFERENCE")) === undefined) {
      const account = await accountingStore.findAccountByCode("5900");
      if (account === undefined) throw new Error("fixture account 5900 missing");
      await accountingStore.mapPurpose({
        purposeKey: "CASH_DIFFERENCE",
        accountId: account.id,
        activeFrom: "2025-12-01",
      });
    }
    cashDifferenceGl = (await accountingStore.findActivePurpose("CASH_DIFFERENCE"))!.accountId;

    // The rep (idempotent).
    const repService = new SalesRepService(audit);
    const existing = await repService.list({ limit: 100 });
    repId =
      existing.find((r) => r.code === "STL-REP-01")?.id ??
      (
        await repService.create({
          code: "STL-REP-01",
          name: "Settlement rep",
          nameAr: "مندوب التسوية",
          email: null,
          phone: null,
          note: null,
          noteAr: null,
          actorId: S_ACTOR,
        })
      ).id;

    // Novel GL codes (1113 under cash-on-hand, 1122 under banks) so no
    // other suite's treasury account collides with ours.
    const ensureGl = async (
      code: string,
      name: string,
      nameAr: string,
      parentCode: string,
    ): Promise<string> => {
      const found = await accountingStore.findAccountByCode(code);
      if (found !== undefined) return found.id;
      const parent = await accountingStore.findAccountByCode(parentCode);
      if (parent === undefined) throw new Error(`fixture parent ${parentCode} missing`);
      const created = await sCoa.create(S_ACTOR, {
        code,
        name,
        nameAr,
        type: "ASSET",
        parentId: parent.id,
        currencyCode: null,
        isGroup: false,
      });
      return created.id;
    };
    repCashGl = await ensureGl("1113", "Rep cash", "صندوق المندوب", "1110");
    bankGl = await ensureGl("1122", "Bank — deposits", "البنك — الإيداعات", "1120");

    // Treasury accounts: the rep cash drawer + the deposit bank.
    const accounts = await treasuryAccounts.list({});
    const repCash =
      accounts.find((a) => a.name === "Rep cash (STL)") ??
      (await treasuryAccounts.open({
        name: "Rep cash (STL)",
        nameAr: "صندوق المندوب",
        type: "CASH",
        accountId: repCashGl,
        branchId: null,
        currencyCode: "SAR",
        actorId: S_ACTOR,
      }));
    repCashId = repCash.id;
    const bank =
      accounts.find((a) => a.name === "Distribution bank (STL)") ??
      (await treasuryAccounts.open({
        name: "Distribution bank (STL)",
        nameAr: "بنك التوزيع",
        type: "BANK",
        accountId: bankGl,
        branchId: null,
        currencyCode: "SAR",
        actorId: S_ACTOR,
      }));
    bankTreasuryId = bank.id;

    // The rep-expense category (approval_mode none → submit lands APPROVED).
    const categories = await expenseService.listCategories(true);
    expenseCategoryId =
      categories.find((c) => c.code === "STL-REP-EXP")?.id ??
      (
        await expenseService.createCategory({
          code: "STL-REP-EXP",
          name: "Rep field expense",
          nameAr: "مصروف ميداني المندوب",
          accountId: (await accountingStore.findAccountByCode("5220"))!.id,
          approvalMode: "none",
          actorId: S_ACTOR,
        })
      ).id;
  });
});

// -- day-fixture helpers -------------------------------------------------------

function serviceLine(unitPrice: string) {
  return {
    itemId: null,
    accountId: fixture.gl.serviceAccount,
    deliveryLineId: null,
    description: "settlement day service",
    descriptionAr: null,
    qty: "1",
    unitPrice,
    discountAmount: null,
    taxCodeId: fixture.taxCodeIds.notSubject,
    batchId: null,
    serialIds: null,
    note: null,
  };
}

async function postedInvoice(
  date: string,
  kind: "CASH" | "CREDIT",
  unitPrice: string,
): Promise<string> {
  const invoice = await withTenant(TENANT_S, () =>
    salesInvoices.create({
      branchId: fixture.branchId,
      customerId: fixture.customerId,
      salesRepId: repId,
      kind,
      invoiceDate: date,
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: null,
      cashAccountId: kind === "CASH" ? repCashId : null,
      note: "stl day fixture",
      noteAr: null,
      actorId: S_SALES,
      lines: [serviceLine(unitPrice)],
    }),
  );
  await withTenant(TENANT_S, () => salesInvoices.submit(invoice.id, S_SALES));
  await withTenant(TENANT_S, () => salesInvoices.approve(invoice.id, S_ACTOR, false));
  const posted = await withTenant(TENANT_S, () => salesInvoices.post(invoice.id, S_ACTOR));
  return posted.invoice.id;
}

async function draftCashInvoice(date: string): Promise<string> {
  const invoice = await withTenant(TENANT_S, () =>
    salesInvoices.create({
      branchId: fixture.branchId,
      customerId: fixture.customerId,
      salesRepId: repId,
      kind: "CASH",
      invoiceDate: date,
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: null,
      cashAccountId: repCashId,
      note: "unsynced draft",
      noteAr: null,
      actorId: S_SALES,
      lines: [serviceLine("75.000000")],
    }),
  );
  return invoice.id;
}

async function postedCashRefund(date: string, invoiceId: string): Promise<string> {
  const invoice = await withTenant(TENANT_S, () => salesInvoices.findWithLines(invoiceId));
  const note = await withTenant(TENANT_S, () =>
    creditNotes.create({
      branchId: fixture.branchId,
      salesRepId: repId,
      invoiceId,
      noteDate: date,
      note: "stl cash refund",
      noteAr: null,
      actorId: S_SALES,
      lines: [
        {
          invoiceLineId: invoice.lines[0]!.id,
          qty: "1",
          unitPrice: null,
          discountAmount: null,
          taxCodeId: null,
          returnToStock: false,
          batchId: null,
          serialIds: null,
          description: null,
          descriptionAr: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(TENANT_S, () => creditNotes.submit(note.id, S_SALES));
  await withTenant(TENANT_S, () => creditNotes.approve(note.id, S_ACTOR));
  const posted = await withTenant(TENANT_S, () => creditNotes.post(note.id, S_ACTOR));
  return posted.note.id;
}

async function postedCollection(date: string, amount: string): Promise<string> {
  const receipt = await withTenant(TENANT_S, () =>
    receipts.create({
      cashAccountId: repCashId,
      partnerId: fixture.customerId,
      method: "CASH",
      payerName: null,
      currencyCode: "SAR",
      amount,
      exchangeRate: null,
      valueDate: date,
      reference: null,
      description: "route collection",
      descriptionAr: null,
      actorId: S_SALES,
    }),
  );
  await withTenant(TENANT_S, () => receipts.post(receipt.id, S_ACTOR));
  return receipt.id;
}

async function postedRepExpense(date: string, amount: string): Promise<string> {
  const expense = await withTenant(TENANT_S, () =>
    expenseService.create({
      categoryId: expenseCategoryId,
      cashAccountId: repCashId,
      payeeName: "Van fuel",
      currencyCode: "SAR",
      amount,
      exchangeRate: null,
      taxCodeId: null,
      receiptFileId: null,
      valueDate: date,
      description: "route fuel",
      descriptionAr: null,
      actorId: S_SALES,
    }),
  );
  await withTenant(TENANT_S, () => expenseService.submit(expense.id, S_SALES));
  await withTenant(TENANT_S, () => expenseService.post(expense.id, S_ACTOR));
  return expense.id;
}

function openDay(date: string, openingCash: string, actorId: string = S_SALES) {
  return withTenant(TENANT_S, () =>
    settlements.open({
      salesRepId: repId,
      cashAccountId: repCashId,
      settlementDate: date,
      openingCash,
      actorId,
    }),
  );
}

/** INV-019: Σ signed movements on the rep cash == its GL base balance. */
async function inv019Tie(): Promise<void> {
  const movements = await withTenant(TENANT_S, () => treasuryStore.movementBalance(repCashId));
  const gl = await withTenant(TENANT_S, () => treasuryStore.glBaseBalanceAsOf(repCashGl));
  expect(new Decimal(movements).toFixed(4)).toBe(new Decimal(gl).toFixed(4));
}

// -- packs ----------------------------------------------------------------------

describe("PHASE-017 T10 settlements: expected-cash math and the perfect count", () => {
  it("seeds the §6 rep day and settles it exactly: components, expected_cash, no variance journal, POSTED with an STL- number", async () => {
    // The seeded rep day: 3 cash sales, 2 credit sales, 1 cash return,
    // 2 collections, 1 approved rep expense.
    const cashSale1 = await postedInvoice(DAY_1, "CASH", "100.000000");
    await postedInvoice(DAY_1, "CASH", "200.000000");
    await postedInvoice(DAY_1, "CASH", "50.000000");
    await postedInvoice(DAY_1, "CREDIT", "300.000000");
    await postedInvoice(DAY_1, "CREDIT", "400.000000");
    await postedCashRefund(DAY_1, cashSale1);
    await postedCollection(DAY_1, "80.0000");
    await postedCollection(DAY_1, "120.0000");
    await postedRepExpense(DAY_1, "30.0000");

    const opened = await openDay(DAY_1, "100.0000");
    expect(opened.status).toBe("DRAFT");
    expect(opened.openingCash).toBe("100.0000");
    expect(opened.salesRepCode).toBe("STL-REP-01");
    expect(opened.settlementNo).toBeNull();

    // expected = 100 + 350 + 200 − 100 − 30 = 520.
    const counted = await withTenant(TENANT_S, () =>
      settlements.count(opened.id, { countedCash: "520.0000", actorId: S_SALES }),
    );
    expect(counted.status).toBe("COUNTED");
    expect(counted.cashSales).toBe("350.0000");
    expect(counted.collections).toBe("200.0000");
    expect(counted.cashRefunds).toBe("100.0000");
    expect(counted.repExpenses).toBe("30.0000");
    expect(counted.expectedCash).toBe("520.0000");
    expect(counted.countedCash).toBe("520.0000");
    expect(counted.variance).toBe("0.0000");
    expect(counted.varianceDirection).toBe("NONE");
    expect((counted as { approvalRequired: boolean }).approvalRequired).toBe(false);

    // Component lines (signed): Σ = expected cash. The CREDIT sales never
    // appear — they carry no cash.
    const withLines = await withTenant(TENANT_S, () => settlements.findWithLines(opened.id));
    expect(withLines.lines.map((line) => [line.component, line.amount])).toEqual([
      ["OPENING_CASH", "100.0000"],
      ["CASH_SALE", "100.0000"],
      ["CASH_SALE", "200.0000"],
      ["CASH_SALE", "50.0000"],
      ["COLLECTION", "80.0000"],
      ["COLLECTION", "120.0000"],
      ["CASH_REFUND", "-100.0000"],
      ["REP_EXPENSE", "-30.0000"],
    ]);
    const lineSum = withLines.lines.reduce((sum, line) => sum.plus(new Decimal(line.amount)), new Decimal(0));
    expect(lineSum.toFixed(4)).toBe("520.0000");
    expect(withLines.lines.every((line) => line.sourceId !== null)).toBe(true);

    // A perfect count within the default tolerance 0 posts straight from
    // COUNTED — variance 0 books NO variance journal (nothing to post).
    const posted = await withTenant(TENANT_S, () =>
      settlements.post(opened.id, { actorId: S_ACTOR }),
    );
    expect(posted.status).toBe("POSTED");
    expect(posted.settlementNo).toMatch(/^STL-\d{4}-\d{5}$/);
    expect(posted.postedAt).not.toBeNull();
    expect(posted.varianceJournalId).toBe(NO_VARIANCE_JOURNAL_ID);
    expect(posted.depositJournalId).toBeNull();
    const varianceEntry = await withTenant(TENANT_S, () =>
      journalStore.findEntryBySourceKey("rep_settlement", opened.id, "variance"),
    );
    expect(varianceEntry).toBeUndefined();

    // INV-019: rep cash = Σ movements = GL balance (350 sales + 200
    // collections − 30 expense; the refund posts AR-side only).
    await inv019Tie();
  });
});

describe("PHASE-017 T10 settlements: variance always posts, approval-gated, never netted", () => {
  it("shortage 5 demands a reason + separate approver; posts DR CASH_DIFFERENCE · CR rep cash AND the deposit legs; locks the day", async () => {
    await postedInvoice(DAY_2, "CASH", "200.000000");
    await postedCollection(DAY_2, "100.0000");

    const opened = await openDay(DAY_2, "50.0000");

    // expected = 50 + 200 + 100 = 350; counted 345 → shortage 5.
    // Beyond the default tolerance 0 → the reason is required.
    await expect(
      withTenant(TENANT_S, () =>
        settlements.count(opened.id, { countedCash: "345.0000", actorId: S_SALES }),
      ),
    ).rejects.toMatchObject({ code: "SETTLEMENT_VARIANCE_REASON_REQUIRED" });

    const counted = await withTenant(TENANT_S, () =>
      settlements.count(opened.id, {
        countedCash: "345.0000",
        varianceReason: "short 5 — damaged note rejected",
        actorId: S_SALES,
      }),
    );
    expect(counted.status).toBe("COUNTED");
    expect(counted.variance).toBe("-5.0000");
    expect(counted.varianceDirection).toBe("SHORTAGE");
    expect(counted.varianceReason).toBe("short 5 — damaged note rejected");
    expect((counted as { approvalRequired: boolean }).approvalRequired).toBe(true);

    // BR-034: the creator cannot approve their own settlement.
    await expect(
      withTenant(TENANT_S, () => settlements.approve(opened.id, { approverId: S_SALES })),
    ).rejects.toMatchObject({ code: "SETTLEMENT_SELF_APPROVAL" });

    const approved = await withTenant(TENANT_S, () =>
      settlements.approve(opened.id, { approverId: S_ACTOR }),
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy).toBe(S_ACTOR);
    expect(approved.approvedAt).not.toBeNull();

    // Posting without the approval hop is the typed rejection (proved on
    // the APPROVED row's inverse — a COUNTED beyond-tolerance row):
    const second = await openDay(DAY_4, "0.0000");
    await withTenant(TENANT_S, () =>
      settlements.count(second.id, {
        countedCash: "5.0000",
        varianceReason: "float change found",
        actorId: S_SALES,
      }),
    );
    await expect(
      withTenant(TENANT_S, () => settlements.post(second.id, { actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "SETTLEMENT_APPROVAL_REQUIRED" });

    // Post with the bank deposit leg (deposit = the counted 345).
    const posted = await withTenant(TENANT_S, () =>
      settlements.post(opened.id, {
        depositAccountId: bankTreasuryId,
        depositAmount: "345.0000",
        actorId: S_ACTOR,
      }),
    );
    expect(posted.status).toBe("POSTED");
    expect(posted.settlementNo).toMatch(/^STL-\d{4}-\d{5}$/);

    // (1) The variance journal: DR CASH_DIFFERENCE 5 · CR rep cash 5.
    const varianceEntry = await withTenant(TENANT_S, () =>
      journalStore.findEntryBySourceKey("rep_settlement", opened.id, "variance"),
    );
    expect(varianceEntry).toBeDefined();
    const varianceLines = await withTenant(TENANT_S, () =>
      journalStore.listLines(varianceEntry!.id),
    );
    expect(varianceLines.map((line) => [line.accountId, line.direction, line.amount])).toEqual([
      [cashDifferenceGl, "DEBIT", "5.0000"],
      [repCashGl, "CREDIT", "5.0000"],
    ]);
    expect(posted.varianceJournalId).toBe(varianceEntry!.id);

    // (2) The deposit journal: DR bank 345 · CR rep cash 345.
    const depositEntry = await withTenant(TENANT_S, () =>
      journalStore.findEntryBySourceKey("rep_settlement", opened.id, "deposit"),
    );
    expect(depositEntry).toBeDefined();
    const depositLines = await withTenant(TENANT_S, () =>
      journalStore.listLines(depositEntry!.id),
    );
    expect(depositLines.map((line) => [line.accountId, line.direction, line.amount])).toEqual([
      [bankGl, "DEBIT", "345.0000"],
      [repCashGl, "CREDIT", "345.0000"],
    ]);
    expect(posted.depositJournalId).toBe(depositEntry!.id);
    expect(posted.depositAmount).toBe("345.0000");

    // (3) A cash_movements row per money leg (INV-019): variance OUT 5 on
    // the settlement source + deposit OUT 345 (the deposit journal source —
    // uq_cash_movements_source_side's one-movement-per-source-side rule)
    // + the bank-side IN 345.
    const movements = await withTenant(TENANT_S, () =>
      treasuryStore.listMovements({ cashAccountId: repCashId, limit: 500 }),
    );
    const varianceMovement = movements.find(
      (row) => row.sourceType === "rep_settlement" && row.sourceId === opened.id,
    );
    expect(varianceMovement).toMatchObject({ direction: "OUT", amount: "5.0000" });
    const depositOut = movements.find(
      (row) => row.sourceType === "rep_settlement" && row.sourceId === depositEntry!.id,
    );
    expect(depositOut).toMatchObject({ direction: "OUT", amount: "345.0000" });
    const bankMovements = await withTenant(TENANT_S, () =>
      treasuryStore.listMovements({ cashAccountId: bankTreasuryId, limit: 500 }),
    );
    expect(bankMovements).toHaveLength(1);
    expect(bankMovements[0]).toMatchObject({ direction: "IN", amount: "345.0000" });

    // INV-019 exact: rep cash = Σ movements = GL balance.
    await inv019Tie();

    // Posted legs as component lines: Σ all lines = counted − deposit = 0.
    const withLines = await withTenant(TENANT_S, () => settlements.findWithLines(opened.id));
    expect(withLines.lines.map((line) => [line.component, line.amount])).toEqual([
      ["OPENING_CASH", "50.0000"],
      ["CASH_SALE", "200.0000"],
      ["COLLECTION", "100.0000"],
      ["VARIANCE", "-5.0000"],
      ["BANK_DEPOSIT", "-345.0000"],
    ]);
    const lineSum = withLines.lines.reduce((sum, line) => sum.plus(new Decimal(line.amount)), new Decimal(0));
    expect(lineSum.toFixed(4)).toBe("0.0000");

    // The risky-approval audit trail exists (the audit IS the trail).
    const su = await superuserClient();
    const audited = await su.query(
      `SELECT action FROM audit_events
        WHERE tenant_id = $1 AND entity_id = $2
          AND action IN ('distribution.settlement_approved', 'distribution.settlement_posted')
        ORDER BY action`,
      [TENANT_S, opened.id],
    );
    await su.end();
    expect(audited.rows.map((row: { action: string }) => row.action)).toEqual([
      "distribution.settlement_approved",
      "distribution.settlement_posted",
    ]);

    // The day lock: a second settlement for (rep, date) is rejected.
    await expect(openDay(DAY_2, "0.0000")).rejects.toMatchObject({ code: "SETTLEMENT_DAY_LOCKED" });

    // POSTED is immutable: count/cancel hit the day lock, re-post is the
    // typed state rejection.
    await expect(
      withTenant(TENANT_S, () =>
        settlements.count(opened.id, { countedCash: "345.0000", actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "SETTLEMENT_DAY_LOCKED" });
    await expect(
      withTenant(TENANT_S, () =>
        settlements.cancel(opened.id, { reason: "mistake", actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "SETTLEMENT_DAY_LOCKED" });
    await expect(
      withTenant(TENANT_S, () => settlements.post(opened.id, { actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "SETTLEMENT_STATE" });
  });
});

describe("PHASE-017 T10 settlements: the pending-documents close gate", () => {
  it("a DRAFT document attributed to the rep's day blocks the count with the typed error", async () => {
    const opened = await openDay(DAY_3, "0.0000");
    await draftCashInvoice(DAY_3);
    await expect(
      withTenant(TENANT_S, () =>
        settlements.count(opened.id, { countedCash: "0.0000", actorId: S_SALES }),
      ),
    ).rejects.toMatchObject({
      code: "SETTLEMENT_PENDING_DOCUMENTS",
      details: { salesInvoices: 1, creditNotes: 0, receipts: 0 },
    });
    // The settlement stays DRAFT — nothing was counted.
    const untouched = await withTenant(TENANT_S, () => settlements.find(opened.id));
    expect(untouched.status).toBe("DRAFT");
    expect(untouched.countedCash).toBeNull();
  });
});

describe("PHASE-017 T10 settlements: surplus posts the inverse journal", () => {
  it("within-tolerance surplus skips the approval hop and posts DR rep cash · CR CASH_DIFFERENCE", async () => {
    await setSalesSetting("distribution.settlement_variance_tolerance", "10.0000");
    await postedInvoice(DAY_5, "CASH", "100.000000");

    const opened = await openDay(DAY_5, "20.0000");
    // expected = 20 + 100 = 120; counted 125 → surplus 5 (within 10).
    const counted = await withTenant(TENANT_S, () =>
      settlements.count(opened.id, {
        countedCash: "125.0000",
        varianceReason: "rounding accumulation",
        actorId: S_SALES,
      }),
    );
    expect(counted.status).toBe("COUNTED");
    expect(counted.variance).toBe("5.0000");
    expect(counted.varianceDirection).toBe("SURPLUS");
    expect((counted as { approvalRequired: boolean }).approvalRequired).toBe(false);

    // Within tolerance → posts straight from COUNTED (no approve hop).
    const posted = await withTenant(TENANT_S, () =>
      settlements.post(opened.id, { actorId: S_ACTOR }),
    );
    expect(posted.status).toBe("POSTED");
    expect(posted.settlementNo).toMatch(/^STL-\d{4}-\d{5}$/);

    const varianceEntry = await withTenant(TENANT_S, () =>
      journalStore.findEntryBySourceKey("rep_settlement", opened.id, "variance"),
    );
    expect(varianceEntry).toBeDefined();
    const varianceLines = await withTenant(TENANT_S, () =>
      journalStore.listLines(varianceEntry!.id),
    );
    expect(varianceLines.map((line) => [line.accountId, line.direction, line.amount])).toEqual([
      [repCashGl, "DEBIT", "5.0000"],
      [cashDifferenceGl, "CREDIT", "5.0000"],
    ]);

    // The surplus lands as an IN movement on the rep cash; Σ lines = counted.
    const movements = await withTenant(TENANT_S, () =>
      treasuryStore.listMovements({ cashAccountId: repCashId, limit: 500 }),
    );
    const varianceMovement = movements.find(
      (row) => row.sourceType === "rep_settlement" && row.sourceId === opened.id,
    );
    expect(varianceMovement).toMatchObject({ direction: "IN", amount: "5.0000" });
    await inv019Tie();

    const withLines = await withTenant(TENANT_S, () => settlements.findWithLines(opened.id));
    const lineSum = withLines.lines.reduce((sum, line) => sum.plus(new Decimal(line.amount)), new Decimal(0));
    expect(lineSum.toFixed(4)).toBe("125.0000");
  });
});
