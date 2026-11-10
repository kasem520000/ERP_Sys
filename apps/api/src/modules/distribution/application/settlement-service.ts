import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import {
  absExact,
  addExact,
  compareExact,
  multiplyExact,
  subExact,
} from "../../accounting/application/decimal-strings";
import * as accountingStore from "../../accounting/infrastructure/accounting.store";
import * as treasuryStore from "../../treasury/infrastructure/treasury.store";
import { ownTenantBaseCurrency, readEffectiveSetting } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/distribution.store";
import {
  SettlementApprovalRequiredError,
  SettlementDayLockedError,
  SettlementNotFoundError,
  SettlementPendingDocumentsError,
  SettlementSelfApprovalError,
  SettlementStateError,
  SettlementVarianceReasonRequiredError,
  VanNotFoundError,
} from "../domain/distribution-errors";

/**
 * Settlement service (PHASE-017 T10; §2 item 7; industry-workflows (c)
 * step 5): the day-end rep settlement (STL-{yyyy}-{seq:5}).
 *
 *   expected cash = opening cash + cash sales + collections
 *                   − cash refunds − approved rep expenses
 *   variance      = counted − expected        (BR-021: always posts,
 *                                             approval-gated, never netted)
 *
 * - `count` recomputes the expectation from the ledgers (the read models in
 *   the store) and persists the component lines; a non-zero variance
 *   REQUIRES a reason, and a beyond-tolerance (or policy-gated) variance
 *   additionally requires a separate approver before posting.
 * - `post` books, inside the caller's ambient UoW: the variance journal
 *   (shortage: DR CASH_DIFFERENCE · CR rep cash; surplus: DR rep cash · CR
 *   CASH_DIFFERENCE — source rep_settlement/variance), the optional bank
 *   deposit leg (DR bank · CR rep cash — source rep_settlement/deposit), a
 *   cash_movements row per money leg (INV-019), the STL- number (INV-021,
 *   posting-time assignment), and locks the rep's day (POSTED is immutable;
 *   corrections are new documents).
 * - the settlement cannot count/close while DRAFT/PENDING documents remain
 *   attributed to the rep's day (at this phase everything is online, so the
 *   gate asserts the queue is empty).
 *
 * Money travels as canonical 4-dp decimal strings (ADR-0009). The rep cash
 * account is supplied at `open` and persisted as the OPENING_CASH component
 * line's source reference (rep_settlements has no cash_account_id column —
 * the line is the durable pointer; see deviation note in the task report).
 */

const STL_FORMAT = { prefix: "STL", format: "STL-{YYYY}-{SEQ:5}", docType: "rep_settlement" } as const;

/**
 * ck_rep_settlements_posted_shape demands a non-NULL variance_journal_id on
 * POSTED rows, but a zero variance has nothing to post (the engine requires
 * amount > 0). The zero-uuid sentinel — the posting service's own
 * "missing account" marker — records "no variance journal exists" without
 * inventing one; the ledger itself stays honest (no CASH_DIFFERENCE entry).
 */
export const NO_VARIANCE_JOURNAL_ID = "00000000-0000-0000-0000-000000000000";

/** Canonical 4-dp money string, half-up (document-support's money rule). */
function canonicalMoney(raw: string, label: string): string {
  const value = new Decimal(raw === "" ? "0" : raw);
  if (!value.isFinite()) {
    throw new SettlementStateError(`${label} must be a decimal string, got "${raw}"`);
  }
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate !== null && candidate !== undefined; depth += 1) {
    if (typeof candidate === "object" && (candidate as { code?: string }).code === "23505") {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

/** BR-021 settlement tolerance (document-support's shiftSettings pattern). */
async function settlementTolerance(): Promise<string> {
  const tolerance = await readEffectiveSetting<string>("distribution.settlement_variance_tolerance");
  return tolerance ?? "0.0000";
}

@Injectable()
export class SettlementService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  async find(id: string) {
    const settlement = await store.findSettlementById(id);
    if (settlement === undefined) throw new SettlementNotFoundError(id);
    return decorateRow(settlement, await settlementTolerance());
  }

  async findWithLines(id: string) {
    const settlement = await store.findSettlementById(id);
    if (settlement === undefined) throw new SettlementNotFoundError(id);
    const tolerance = await settlementTolerance();
    return {
      ...decorateRow(settlement, tolerance),
      lines: await store.listSettlementLines(id),
    };
  }

  async list(filter: { status?: string; repId?: string; date?: string; limit?: number } = {}) {
    const rows = await store.listSettlements({
      status: filter.status,
      repId: filter.repId,
      date: filter.date,
      limit: filter.limit ?? 100,
    });
    const tolerance = await settlementTolerance();
    return rows.map((row) => decorateRow(row, tolerance));
  }

  /**
   * Open the day's settlement (DRAFT — nothing computed yet; `count`
   * recomputes from the ledgers). One live settlement per (rep, date)
   * (uq_rep_settlements_rep_day — the day lock). The rep cash account is
   * required up front (every money leg lands on it) and is recorded as the
   * OPENING_CASH line's source; an open cashier shift on that account is
   * linked when one exists (the shift and the float stay independent).
   */
  async open(input: {
    salesRepId: string;
    cashAccountId: string;
    vanWarehouseId?: string | null;
    settlementDate: string;
    openingCash: string;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }) {
    const rep = await store.findSalesRepRef(input.salesRepId);
    if (rep === undefined) {
      throw new SettlementStateError(`sales rep ${input.salesRepId} does not exist in this tenant`);
    }
    if (rep.status !== "ACTIVE") {
      throw new SettlementStateError(`sales rep ${rep.code} is ${rep.status} — settlements need an ACTIVE rep`);
    }
    const cash = await treasuryStore.findCashAccountById(input.cashAccountId);
    if (cash === undefined) {
      throw new SettlementStateError(`cash account ${input.cashAccountId} does not exist in this tenant`);
    }
    if (cash.status !== "ACTIVE") {
      throw new SettlementStateError(`cash account ${cash.name} is ${cash.status} — rep settlements need an ACTIVE account`);
    }
    if (cash.type !== "CASH") {
      throw new SettlementStateError(
        `rep settlements run on CASH accounts — ${cash.name} is ${cash.type}`,
      );
    }
    if (input.vanWarehouseId !== undefined && input.vanWarehouseId !== null) {
      const van = await store.findVanByWarehouseId(input.vanWarehouseId);
      if (van === undefined || van.type !== "VAN") throw new VanNotFoundError(input.vanWarehouseId);
    }
    const opening = canonicalMoney(input.openingCash === "" ? "0" : input.openingCash, "openingCash");
    if (compareExact(opening, "0.0000") < 0) {
      throw new SettlementStateError("opening cash cannot be negative");
    }
    const live = await store.findLiveSettlementForRepDay(input.salesRepId, input.settlementDate);
    if (live !== undefined) {
      throw new SettlementDayLockedError({
        salesRepId: input.salesRepId,
        settlementDate: input.settlementDate,
        settlementId: live.id,
        status: live.status,
      });
    }
    const openShift = await treasuryStore.findOpenShiftForAccount(cash.id);
    let created;
    try {
      created = await store.insertSettlement({
        salesRepId: input.salesRepId,
        vanWarehouseId: input.vanWarehouseId ?? null,
        shiftId: openShift?.id ?? null,
        settlementDate: input.settlementDate,
        openingCash: opening,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        createdBy: input.actorId,
      });
    } catch (error) {
      // uq_rep_settlements_rep_day raced the pre-check → the day is locked.
      if (isUniqueViolation(error)) {
        throw new SettlementDayLockedError({
          salesRepId: input.salesRepId,
          settlementDate: input.settlementDate,
        });
      }
      throw error;
    }
    // The durable rep-cash-account pointer: the OPENING_CASH component
    // line's source (rep_settlements carries no cash_account_id column).
    await store.upsertSettlementLine({
      settlementId: created.id,
      lineNo: 1,
      component: "OPENING_CASH",
      amount: opening,
      sourceType: "cash_account",
      sourceId: cash.id,
      description: "Opening cash float",
      descriptionAr: "رصيد النقدية الافتتاحي",
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "distribution.settlement_opened",
      entityType: "rep_settlement",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        salesRepId: input.salesRepId,
        salesRepCode: rep.code,
        settlementDate: input.settlementDate,
        openingCash: opening,
        cashAccount: cash.name,
        shiftId: openShift?.id ?? null,
      },
    });
    return this.find(created.id);
  }

  /**
   * Count the drawer: recompute expected cash from the ledgers, persist the
   * component lines, and record the variance. DRAFT/COUNTED only (a recount
   * replaces the lines); POSTED days are locked, APPROVED counts are frozen
   * (a different count would stale the approval — cancel instead).
   */
  async count(id: string, input: { countedCash: string; varianceReason?: string; actorId: string | null }) {
    const settlement = await this.requireSettlement(id);
    if (settlement.status === "POSTED") {
      throw new SettlementDayLockedError({
        salesRepId: settlement.salesRepId,
        settlementDate: settlement.settlementDate,
        settlementId: settlement.id,
        status: "POSTED",
      });
    }
    if (settlement.status !== "DRAFT" && settlement.status !== "COUNTED") {
      throw new SettlementStateError(
        `settlement ${id} is ${settlement.status} — only DRAFT/COUNTED settlements count`,
      );
    }
    const repCash = await this.resolveRepCashAccount(id);
    const counted = canonicalMoney(input.countedCash === "" ? "0" : input.countedCash, "countedCash");
    if (compareExact(counted, "0.0000") < 0) {
      throw new SettlementStateError("counted cash cannot be negative");
    }

    // The close gate: nothing draft/pending may remain on the rep's day.
    const pending = await store.repPendingDocuments(
      settlement.salesRepId,
      repCash.id,
      settlement.settlementDate,
    );
    if (pending.salesInvoices + pending.creditNotes + pending.receipts > 0) {
      throw new SettlementPendingDocumentsError(pending);
    }

    // Expected cash from the ledgers (§2 item 7 / workflows (c) step 5).
    const [cashSales, collections, refunds, expenses] = await Promise.all([
      store.repDayCashSales(settlement.salesRepId, settlement.settlementDate),
      store.repDayCollections(repCash.id, settlement.settlementDate),
      store.repDayCashRefunds(settlement.salesRepId, settlement.settlementDate),
      store.repDayExpenses(repCash.id, settlement.settlementDate),
    ]);
    const sum = (rows: { amount: string }[]) =>
      rows.reduce((total, row) => addExact(total, row.amount), "0.0000");
    const cashSalesTotal = sum(cashSales);
    const collectionsTotal = sum(collections);
    const refundsTotal = sum(refunds);
    const expensesTotal = sum(expenses);
    const expected = subExact(
      addExact(settlement.openingCash, addExact(cashSalesTotal, collectionsTotal)),
      addExact(refundsTotal, expensesTotal),
    );

    const variance = subExact(counted, expected);
    const sign = compareExact(variance, "0.0000");
    const direction = sign < 0 ? "SHORTAGE" : sign > 0 ? "SURPLUS" : "NONE";
    const tolerance = await settlementTolerance();
    const withinTolerance = compareExact(absExact(variance), tolerance) <= 0;
    const reason = input.varianceReason?.trim() ?? "";
    if (direction !== "NONE" && reason === "") {
      throw new SettlementVarianceReasonRequiredError({
        variance,
        direction,
        tolerance,
        withinTolerance,
      });
    }

    // Component lines (signed): Σ lines = expected cash.
    type LineInput = Parameters<typeof store.replaceSettlementLines>[1][number];
    const lines: LineInput[] = [
      {
        lineNo: 1,
        component: "OPENING_CASH",
        amount: settlement.openingCash,
        sourceType: "cash_account",
        sourceId: repCash.id,
        description: "Opening cash float",
        descriptionAr: "رصيد النقدية الافتتاحي",
      },
    ];
    let lineNo = 1;
    for (const sale of cashSales) {
      if (compareExact(sale.amount, "0.0000") === 0) continue; // fully-card POS tender
      lineNo += 1;
      lines.push({
        lineNo,
        component: "CASH_SALE",
        amount: sale.amount,
        sourceType: "sales_invoice",
        sourceId: sale.invoiceId,
        description: `Cash sale ${sale.invoiceNo ?? sale.invoiceId}`,
        descriptionAr: `بيع نقدي ${sale.invoiceNo ?? sale.invoiceId}`,
      });
    }
    for (const collection of collections) {
      lineNo += 1;
      lines.push({
        lineNo,
        component: "COLLECTION",
        amount: collection.amount,
        sourceType: "receipt",
        sourceId: collection.receiptId,
        description: `Collection ${collection.receiptNo ?? collection.receiptId}`,
        descriptionAr: `تحصيل ${collection.receiptNo ?? collection.receiptId}`,
      });
    }
    for (const refund of refunds) {
      lineNo += 1;
      lines.push({
        lineNo,
        component: "CASH_REFUND",
        amount: subExact("0.0000", refund.amount),
        sourceType: "credit_note",
        sourceId: refund.creditNoteId,
        description: `Cash refund ${refund.noteNo ?? refund.creditNoteId}`,
        descriptionAr: `رد نقدي ${refund.noteNo ?? refund.creditNoteId}`,
      });
    }
    for (const expense of expenses) {
      lineNo += 1;
      lines.push({
        lineNo,
        component: "REP_EXPENSE",
        amount: subExact("0.0000", expense.amount),
        sourceType: "expense",
        sourceId: expense.expenseId,
        description: `Rep expense ${expense.expenseNo ?? expense.expenseId}`,
        descriptionAr: `مصروف المندوب ${expense.expenseNo ?? expense.expenseId}`,
      });
    }
    await store.replaceSettlementLines(id, lines, input.actorId);

    await store.patchSettlement(id, {
      status: "COUNTED",
      cashSales: cashSalesTotal,
      collections: collectionsTotal,
      cashRefunds: refundsTotal,
      repExpenses: expensesTotal,
      expectedCash: expected,
      countedCash: counted,
      variance,
      varianceDirection: direction,
      varianceReason: direction === "NONE" ? null : reason,
    });
    await this.audit.record({
      action: "distribution.settlement_counted",
      entityType: "rep_settlement",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: settlement.status, expectedCash: settlement.expectedCash },
      after: {
        status: "COUNTED",
        expectedCash: expected,
        countedCash: counted,
        variance,
        direction,
        withinTolerance,
        components: {
          openingCash: settlement.openingCash,
          cashSales: cashSalesTotal,
          collections: collectionsTotal,
          cashRefunds: refundsTotal,
          repExpenses: expensesTotal,
        },
      },
    });
    return this.find(id);
  }

  /** The SoD-guarded approval hop (COUNTED → APPROVED): the creator can
   * never approve their own settlement (BR-034). The audit IS the trail. */
  async approve(id: string, input: { approverId: string }) {
    const settlement = await this.requireSettlement(id);
    if (settlement.status === "POSTED") {
      throw new SettlementDayLockedError({
        salesRepId: settlement.salesRepId,
        settlementDate: settlement.settlementDate,
        settlementId: settlement.id,
        status: "POSTED",
      });
    }
    if (settlement.status !== "COUNTED") {
      throw new SettlementStateError(
        `settlement ${id} is ${settlement.status} — only COUNTED settlements approve`,
      );
    }
    if (settlement.createdBy !== null && settlement.createdBy === input.approverId) {
      throw new SettlementSelfApprovalError(id);
    }
    await store.patchSettlement(id, { status: "APPROVED", actorId: input.approverId });
    await this.audit.record({
      action: "distribution.settlement_approved",
      entityType: "rep_settlement",
      entityId: id,
      actorId: input.approverId,
      before: { status: "COUNTED" },
      after: {
        status: "APPROVED",
        variance: settlement.variance,
        varianceDirection: settlement.varianceDirection,
      },
    });
    return this.find(id);
  }

  /**
   * Post the settlement: APPROVED required — or COUNTED with a
   * within-tolerance variance and no forcing approval policy. Books the
   * variance journal (always, when variance ≠ 0 — never netted), the
   * optional bank deposit leg, a cash_movements row per money leg (INV-019),
   * the STL- number (INV-021 posting-time), and locks the day. A re-post of
   * a POSTED settlement is the typed SETTLEMENT_STATE rejection (documented
   * choice over a silent no-op — corrections are new documents).
   */
  async post(
    id: string,
    input: { depositAccountId?: string | null; depositAmount?: string | null; actorId: string | null },
  ) {
    const settlement = await this.requireSettlement(id);
    if (settlement.status === "POSTED") {
      throw new SettlementStateError(
        `settlement ${id} is already POSTED — the day is locked (corrections are new documents)`,
      );
    }
    if (settlement.status === "CANCELLED" || settlement.status === "DRAFT") {
      throw new SettlementStateError(
        `settlement ${id} is ${settlement.status} — count (and approve when required) precedes posting`,
      );
    }
    const tolerance = await settlementTolerance();
    const variance = settlement.variance ?? "0.0000";
    const withinTolerance = compareExact(absExact(variance), tolerance) <= 0;
    const policy = await accountingStore.findActivePolicy("rep_settlement", settlement.settlementDate);
    const policyRequired = policy !== undefined && policy.policy.mode === "single-approver";
    if (settlement.status !== "APPROVED" && (!withinTolerance || policyRequired)) {
      throw new SettlementApprovalRequiredError({ variance, tolerance, policyRequired });
    }

    const repCash = await this.resolveRepCashAccount(id);
    const base = await ownTenantBaseCurrency();
    const currency = repCash.currencyCode;
    const rate =
      currency === base
        ? "1"
        : await (async () => {
            const row = await accountingStore.findRateForDate(currency, settlement.settlementDate);
            if (row === undefined) {
              throw new SettlementStateError(
                `no exchange rate for ${currency} on or before ${settlement.settlementDate} — the settlement legs cannot post`,
              );
            }
            return row.rate;
          })();

    // (1) The variance journal — BR-021: always posts, never netted.
    let varianceJournalId: string | null = null;
    let varianceAbs = "0.0000";
    const shortage = compareExact(variance, "0.0000") < 0;
    if (compareExact(variance, "0.0000") !== 0) {
      varianceAbs = absExact(variance);
      const lines: JournalLineSpec[] = shortage
        ? [
            {
              purpose: "CASH_DIFFERENCE",
              direction: "DEBIT",
              amount: varianceAbs,
              memo: { en: "Rep settlement shortage", ar: "عجز تسوية المندوب" },
            },
            {
              accountId: repCash.accountId,
              direction: "CREDIT",
              amount: varianceAbs,
              memo: { en: `Settlement ${id} count`, ar: "فرق جرد التسوية" },
            },
          ]
        : [
            {
              accountId: repCash.accountId,
              direction: "DEBIT",
              amount: varianceAbs,
              memo: { en: `Settlement ${id} count`, ar: "فرق جرد التسوية" },
            },
            {
              purpose: "CASH_DIFFERENCE",
              direction: "CREDIT",
              amount: varianceAbs,
              memo: { en: "Rep settlement surplus", ar: "زيادة تسوية المندوب" },
            },
          ];
      const spec: JournalSpec = {
        source: { docType: "rep_settlement", docId: id, operation: "variance" },
        entryDate: settlement.settlementDate,
        description: {
          en: `Rep settlement variance ${variance}`,
          ar: `فرق تسوية المندوب ${variance}`,
        },
        currency,
        exchangeRate: currency === base ? undefined : rate,
        lines,
      };
      const result = await this.posting.post(spec, { postedBy: input.actorId });
      varianceJournalId = result.journalEntryId;
      await treasuryStore.insertCashMovement({
        cashAccountId: repCash.id,
        direction: shortage ? "OUT" : "IN",
        amount: varianceAbs,
        currencyCode: currency,
        exchangeRate: rate,
        baseAmount: multiplyExact(varianceAbs, rate),
        sourceType: "rep_settlement",
        sourceId: id,
        valueDate: settlement.settlementDate,
        memo: `settlement variance ${variance}`,
      });
    }

    // (2) The bank deposit leg: DR bank · CR rep cash.
    let depositJournalId: string | null = null;
    let depositAmount: string | null = null;
    let depositAccountId: string | null = null;
    if (input.depositAccountId !== undefined && input.depositAccountId !== null) {
      if (input.depositAmount === undefined || input.depositAmount === null || input.depositAmount === "") {
        throw new SettlementStateError("depositAccountId requires depositAmount");
      }
      depositAmount = canonicalMoney(input.depositAmount, "depositAmount");
      if (compareExact(depositAmount, "0.0000") <= 0) {
        throw new SettlementStateError("depositAmount must be positive");
      }
      const counted = settlement.countedCash ?? "0.0000";
      if (compareExact(depositAmount, counted) > 0) {
        throw new SettlementStateError(
          `depositAmount ${depositAmount} exceeds the counted cash ${counted}`,
        );
      }
      const depositAccount = await treasuryStore.findCashAccountById(input.depositAccountId);
      if (depositAccount === undefined) {
        throw new SettlementStateError(
          `deposit account ${input.depositAccountId} does not exist in this tenant`,
        );
      }
      if (depositAccount.status !== "ACTIVE") {
        throw new SettlementStateError(
          `deposit account ${depositAccount.name} is ${depositAccount.status}`,
        );
      }
      if (depositAccount.currencyCode !== currency) {
        throw new SettlementStateError(
          `deposit account ${depositAccount.name} runs on ${depositAccount.currencyCode} — the settlement deposits ${currency}`,
        );
      }
      depositAccountId = depositAccount.id;
      const spec: JournalSpec = {
        source: { docType: "rep_settlement", docId: id, operation: "deposit" },
        entryDate: settlement.settlementDate,
        description: {
          en: `Rep settlement bank deposit ${depositAmount}`,
          ar: `إيداع بنكي لتسوية المندوب ${depositAmount}`,
        },
        currency,
        exchangeRate: currency === base ? undefined : rate,
        lines: [
          {
            accountId: depositAccount.accountId,
            direction: "DEBIT",
            amount: depositAmount,
            memo: { en: `Deposit from ${repCash.name}`, ar: `إيداع من ${repCash.name}` },
          },
          {
            accountId: repCash.accountId,
            direction: "CREDIT",
            amount: depositAmount,
            memo: { en: `Deposit to ${depositAccount.name}`, ar: `إيداع إلى ${depositAccount.name}` },
          },
        ],
      };
      const result = await this.posting.post(spec, { postedBy: input.actorId });
      depositJournalId = result.journalEntryId;
      // INV-019 both sides. uq_cash_movements_source_side ("a source
      // document never yields two movements on the same account side")
      // forces the deposit legs' source_id to differ from the settlement
      // body's: the deposit JOURNAL entry id — still sourceType
      // rep_settlement, still traceable via deposit_journal_id.
      await treasuryStore.insertCashMovement({
        cashAccountId: repCash.id,
        direction: "OUT",
        amount: depositAmount,
        currencyCode: currency,
        exchangeRate: rate,
        baseAmount: multiplyExact(depositAmount, rate),
        sourceType: "rep_settlement",
        sourceId: depositJournalId,
        valueDate: settlement.settlementDate,
        memo: `settlement deposit to ${depositAccount.name}`,
      });
      await treasuryStore.insertCashMovement({
        cashAccountId: depositAccount.id,
        direction: "IN",
        amount: depositAmount,
        currencyCode: currency,
        exchangeRate: rate,
        baseAmount: multiplyExact(depositAmount, rate),
        sourceType: "rep_settlement",
        sourceId: depositJournalId,
        valueDate: settlement.settlementDate,
        memo: `settlement deposit from ${repCash.name}`,
      });
    }

    // (3) The STL- number (INV-021 — posting-time assignment).
    const year = settlement.settlementDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: STL_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: STL_FORMAT.format,
      prefix: STL_FORMAT.prefix,
      year,
    });
    await this.numbering.bind(STL_FORMAT.docType, acquired.number, id);

    // (4) The posted legs as component lines: Σ all lines = counted − deposit.
    const existing = await store.listSettlementLines(id);
    let lineNo = existing.reduce((max, line) => Math.max(max, line.lineNo), 0);
    if (varianceJournalId !== null) {
      lineNo += 1;
      await store.upsertSettlementLine({
        settlementId: id,
        lineNo,
        component: "VARIANCE",
        amount: variance,
        sourceType: "journal_entry",
        sourceId: varianceJournalId,
        description: `Variance ${settlement.varianceDirection}`,
        descriptionAr: `الفرق ${settlement.varianceDirection}`,
        createdBy: input.actorId,
      });
    }
    if (depositJournalId !== null && depositAmount !== null) {
      lineNo += 1;
      await store.upsertSettlementLine({
        settlementId: id,
        lineNo,
        component: "BANK_DEPOSIT",
        amount: subExact("0.0000", depositAmount),
        sourceType: "journal_entry",
        sourceId: depositJournalId,
        description: "Bank deposit",
        descriptionAr: "إيداع بنكي",
        createdBy: input.actorId,
      });
    }

    // (5) POSTED — the day locks (ck_rep_settlements_posted_shape wants a
    // non-NULL variance_journal_id; the sentinel records "none exists").
    await store.patchSettlement(id, {
      status: "POSTED",
      settlementNo: acquired.number,
      varianceJournalId: varianceJournalId ?? NO_VARIANCE_JOURNAL_ID,
      depositAccountId,
      depositAmount,
      depositJournalId,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "distribution.settlement_posted",
      entityType: "rep_settlement",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: settlement.status },
      after: {
        status: "POSTED",
        settlementNo: acquired.number,
        varianceJournalId,
        depositJournalId,
        depositAmount,
        variance,
        countedCash: settlement.countedCash,
        expectedCash: settlement.expectedCash,
      },
    });
    return this.find(id);
  }

  /** Cancel (DRAFT/COUNTED/APPROVED only — a POSTED day is locked; the
   * correction path is a new settlement document). */
  async cancel(id: string, input: { reason: string; actorId: string | null }) {
    const settlement = await this.requireSettlement(id);
    if (settlement.status === "POSTED") {
      throw new SettlementDayLockedError({
        salesRepId: settlement.salesRepId,
        settlementDate: settlement.settlementDate,
        settlementId: settlement.id,
        status: "POSTED",
      });
    }
    if (settlement.status === "CANCELLED") {
      throw new SettlementStateError(`settlement ${id} is already CANCELLED`);
    }
    const reason = input.reason.trim();
    if (reason === "") {
      throw new SettlementStateError("a cancel reason is required");
    }
    await store.patchSettlement(id, { status: "CANCELLED", cancelReason: reason });
    await this.audit.record({
      action: "distribution.settlement_cancelled",
      entityType: "rep_settlement",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: settlement.status },
      after: { status: "CANCELLED", reason },
    });
    return this.find(id);
  }

  // -- internals ------------------------------------------------------------------

  private async requireSettlement(id: string) {
    const settlement = await store.findSettlementById(id);
    if (settlement === undefined) throw new SettlementNotFoundError(id);
    return settlement;
  }

  /** The rep cash account, recovered from the OPENING_CASH line's source
   * reference (the pointer persisted at open — see the class docblock). */
  private async resolveRepCashAccount(settlementId: string) {
    const lines = await store.listSettlementLines(settlementId);
    const opening = lines.find((line) => line.component === "OPENING_CASH" && line.sourceId !== null);
    if (opening === undefined) {
      throw new SettlementStateError(
        `settlement ${settlementId} has no rep cash account reference (missing OPENING_CASH line)`,
      );
    }
    const account = await treasuryStore.findCashAccountById(opening.sourceId!);
    if (account === undefined || account.status !== "ACTIVE" || account.type !== "CASH") {
      throw new SettlementStateError(
        `the settlement's rep cash account is no longer an ACTIVE CASH account`,
      );
    }
    return account;
  }
}

/** The derived approval-required flag: a COUNTED settlement whose variance
 * is beyond tolerance (or under a forcing approval policy) needs a separate
 * approver before it can post. */
function decorateRow(row: store.SettlementRow, tolerance: string) {
  const variance = row.variance ?? "0.0000";
  return {
    ...row,
    approvalRequired:
      row.status === "COUNTED" && compareExact(absExact(variance), tolerance) > 0,
  };
}
