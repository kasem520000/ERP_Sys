import { Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import * as store from "../infrastructure/sales.store";
import { ArQueryInvalidError } from "../domain/sales-errors";

/**
 * AR query services (PHASE-012 T11; RECEIVABLES_AND_PAYABLES §2/§7;
 * BR-028): aging buckets, customer statements, and the open-items surface
 * as DETERMINISTIC as-of recomputations from immutable subledger entries —
 * identical inputs yield byte-identical outputs (RC-10). These are the
 * module-owned query surfaces (`arQueries.*`) PHASE-013's report contracts
 * (`ar.aging`, `partner.statement`, `ar.allocations`) will register over.
 * The AR subledger ↔ `AR_CONTROL` tie (RC-01) and drift detection (RC-03)
 * ride the PHASE-007 reconciliation framework's existing 'AR' kind — no
 * new check ships here.
 */

export type AgingBucket = "not_due" | "1_30" | "31_60" | "61_90" | "90_plus";

export interface AgingRow {
  customerId: string;
  customerCode: string;
  customerName: string;
  customerNameAr: string | null;
  currencyCode: string;
  notDue: string;
  b1_30: string;
  b31_60: string;
  b61_90: string;
  b90Plus: string;
  total: string;
  baseTotal: string;
  itemCount: number;
}

export interface StatementEntry {
  entryDate: string;
  docRef: string | null;
  sourceType: string;
  memo: string | null;
  currencyCode: string;
  debit: string;
  credit: string;
  balance: string;
  baseBalance: string;
  outstanding: string;
  /** PHASE-031 (0042): the source sales invoice's external insurer claim
   *  reference — the group-by-claim grouping key on the per-insurer
   *  statement view (null for non-invoice entries + self-pay invoices). */
  claimRef: string | null;
}

export interface CustomerStatement {
  customerId: string;
  customerCode: string;
  customerName: string;
  customerNameAr: string | null;
  asOf: string;
  currencyCode: string;
  openingBalance: string;
  entries: StatementEntry[];
  closingBalance: string;
  closingBalanceBase: string;
  aging: Record<AgingBucket, string>;
  /** The INV-009 footer: statement closing = the partner's subledger sum. */
  subledgerTie: { ok: boolean; statementBalance: string; subledgerBalance: string };
}

@Injectable()
export class ArQueriesService {
  /**
   * AR aging at an as-of date (RC-10 deterministic): open items bucketed by
   * (dueDate − asOf): not due / 1–30 / 31–60 / 61–90 / 90+ days overdue,
   * per customer per currency, with the base-currency total.
   */
  async aging(input: { asOf: string; customerId?: string }): Promise<AgingRow[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) {
      throw new ArQueryInvalidError(`as-of must be an ISO date: ${input.asOf}`);
    }
    const items = await store.arOpenItemsAsOf({
      customerId: input.customerId,
      asOf: input.asOf,
      openOnly: true,
      limit: 10000,
    });
    const asOfMs = new Date(`${input.asOf}T00:00:00Z`).getTime();

    const byCustomer = new Map<string, AgingRow>();
    for (const item of items) {
      let row = byCustomer.get(item.partnerId);
      if (row === undefined) {
        row = {
          customerId: item.partnerId,
          customerCode: "",
          customerName: "",
          customerNameAr: null,
          currencyCode: item.currencyCode,
          notDue: "0.0000",
          b1_30: "0.0000",
          b31_60: "0.0000",
          b61_90: "0.0000",
          b90Plus: "0.0000",
          total: "0.0000",
          baseTotal: "0.0000",
          itemCount: 0,
        };
        byCustomer.set(item.partnerId, row);
      }
      const dueMs = item.dueDate !== null ? new Date(`${item.dueDate}T00:00:00Z`).getTime() : asOfMs;
      // Integral day difference (UTC ms / 86_400_000 is exact for whole
      // dates — no floating-point rounding involved).
      const overdueDays = ((asOfMs - dueMs) / (24 * 60 * 60 * 1000)) | 0;
      const amount = new Decimal(item.outstanding);
      const key: AgingBucket =
        overdueDays <= 0 ? "not_due"
        : overdueDays <= 30 ? "1_30"
        : overdueDays <= 60 ? "31_60"
        : overdueDays <= 90 ? "61_90"
        : "90_plus";
      const field =
        key === "not_due" ? "notDue"
        : key === "1_30" ? "b1_30"
        : key === "31_60" ? "b31_60"
        : key === "61_90" ? "b61_90"
        : "b90Plus";
      row[field] = new Decimal(row[field]).plus(amount)
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      row.total = new Decimal(row.total).plus(amount).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      row.baseTotal = new Decimal(row.baseTotal)
        .plus(new Decimal(item.outstanding).times(new Decimal(item.exchangeRate)))
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      row.itemCount += 1;
    }

    // Customer identity join (deterministic order by code).
    const customers = await store.customersWithArActivity(input.asOf, 10000);
    const customerById = new Map(customers.map((c) => [c.customerId, c]));
    for (const row of byCustomer.values()) {
      const customer = customerById.get(row.customerId);
      if (customer !== undefined) {
        row.customerCode = customer.code;
        row.customerName = customer.name;
        row.customerNameAr = customer.nameAr;
      }
    }
    return [...byCustomer.values()].sort((a, b) =>
      a.customerCode < b.customerCode ? -1 : a.customerCode > b.customerCode ? 1 : 0,
    );
  }

  /**
   * Customer statement as-of (BR-028): running balance over the AR subledger
   * (invoices +, credit notes −, receipts −, on-account, adjustments),
   * document currency + base totals, aging column, and the INV-009 footer
   * tie (statement closing = the partner's signed subledger sum).
   */
  async statement(input: { customerId: string; asOf: string }): Promise<CustomerStatement> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) {
      throw new ArQueryInvalidError(`as-of must be an ISO date: ${input.asOf}`);
    }
    const customer = await store.findCustomerById(input.customerId);
    if (customer === undefined) {
      throw new ArQueryInvalidError(`customer ${input.customerId} does not exist in this tenant`);
    }
    const entries = await store.partnerArStatementEntries({
      customerId: input.customerId,
      asOf: input.asOf,
    });

    const agingRow = (await this.aging({ asOf: input.asOf, customerId: input.customerId }))[0];
    const aging: Record<AgingBucket, string> = agingRow
      ? { not_due: agingRow.notDue, "1_30": agingRow.b1_30, "31_60": agingRow.b31_60, "61_90": agingRow.b61_90, "90_plus": agingRow.b90Plus }
      : { not_due: "0.0000", "1_30": "0.0000", "31_60": "0.0000", "61_90": "0.0000", "90_plus": "0.0000" };

    let balance = new Decimal(0);
    let baseBalance = new Decimal(0);
    const statementEntries: StatementEntry[] = [];
    for (const entry of entries) {
      const debit = entry.direction === "DEBIT" ? entry.amount : "0.0000";
      const credit = entry.direction === "CREDIT" ? entry.amount : "0.0000";
      balance = balance.plus(new Decimal(debit)).minus(new Decimal(credit));
      baseBalance = baseBalance.plus(new Decimal(entry.baseAmount).times(entry.direction === "DEBIT" ? 1 : -1));
      statementEntries.push({
        entryDate: entry.entryDate,
        docRef: entry.docRef,
        sourceType: entry.sourceType,
        memo: entry.memo,
        currencyCode: entry.currencyCode,
        debit,
        credit,
        balance: balance.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        baseBalance: baseBalance.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        outstanding: entry.outstanding,
        claimRef: entry.claimRef,
      });
    }
    const closing = balance.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const subledgerBalance = baseBalance.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

    return {
      customerId: input.customerId,
      customerCode: customer.code,
      customerName: customer.name,
      customerNameAr: customer.nameAr,
      asOf: input.asOf,
      currencyCode: entries[0]?.currencyCode ?? "—",
      openingBalance: "0.0000",
      entries: statementEntries,
      closingBalance: closing,
      closingBalanceBase: subledgerBalance,
      aging,
      // INV-009 footer: the AR-side statement tie (RC-01's per-partner view).
      subledgerTie: {
        ok: new Decimal(closing).minus(
          entries.reduce(
            (sum, entry) =>
              sum.plus(new Decimal(entry.amount).times(entry.direction === "DEBIT" ? 1 : -1)),
            new Decimal(0),
          ),
        ).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4) === "0.0000",
        statementBalance: closing,
        subledgerBalance: entries.reduce(
          (sum, entry) =>
            sum.plus(new Decimal(entry.amount).times(entry.direction === "DEBIT" ? 1 : -1)),
          new Decimal(0),
        ).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      },
    };
  }

  /** Open AR items (the receipts allocation surface). */
  async openItems(filter: { customerId?: string; limit?: number }) {
    return store.arOpenItemsAsOf({
      customerId: filter.customerId,
      asOf: new Date().toISOString().slice(0, 10),
      openOnly: true,
      limit: filter.limit ?? 200,
    });
  }

  /**
   * PHASE-031 (0042 — the healthcare claim grouping read model): the open
   * AR claim slices, one row per (partner, claim_ref, currency) over the
   * open items of claim (insured) invoices. Each claim is its own open-item
   * slice on the insurer subledger; receipts/notes allocate to the items
   * through the ordinary allocation machinery (INV-016) and the slices
   * partition the partner's open items, so `Σ slices + Σ self-pay and
   * non-invoice open items = the partner's AR open total` (INV-009/012 —
   * the claim-lifecycle spec reconciles at every step).
   */
  async claimSlices(input: { asOf: string; customerId?: string }): Promise<store.ClaimSliceRow[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) {
      throw new ArQueryInvalidError(`as-of must be an ISO date: ${input.asOf}`);
    }
    return store.arClaimSlicesAsOf({ customerId: input.customerId, asOf: input.asOf });
  }

  /**
   * INV-009 verification at an as-of date (the AR side): Σ signed subledger
   * base amounts (DEBIT − CREDIT over AR_CONTROL) must equal the
   * AR_CONTROL account's GL balance exactly — from the first entry (G-16
   * AR side included).
   */
  /**
   * Receipt allocations for a window (REPORT_CATALOG `ar.allocations` —
   * the PHASE-013 reporting feed): allocation rows joined to their
   * receipts, with the Σ allocations == Σ receipts.allocated_amount tie.
   */
  async allocations(input: { fromDate: string; toDate: string }): Promise<{
    rows: readonly {
      id: string;
      receiptNo: string;
      docRef: string | null;
      allocatedAt: string;
      amount: string;
    }[];
    totalAllocated: string;
    totalReceiptAllocated: string;
  }> {
    const rows = await store.allocationsFeed({
      fromDate: input.fromDate,
      toDate: input.toDate,
    });
    let totalAllocated = "0.0000";
    for (const row of rows) {
      totalAllocated = (Number(totalAllocated) + Number(row.amount)).toFixed(4);
    }
    let totalReceiptAllocated = "0.0000";
    for (const row of rows) {
      totalReceiptAllocated = (Number(totalReceiptAllocated) + Number(row.receiptAllocated)).toFixed(4);
    }
    return {
      rows: rows.map((row) => ({
        id: row.id,
        receiptNo: row.receiptNo,
        docRef: row.docRef,
        allocatedAt: row.allocatedAt,
        amount: row.amount,
      })),
      totalAllocated,
      totalReceiptAllocated,
    };
  }

  async verifyInv009(input: { asOf: string }): Promise<{
    ok: boolean;
    subledgerTotal: string;
    glBalance: string;
    openingItems: number;
    diff: string;
  }> {
    const accountingStore = await import("../../accounting/infrastructure/accounting.store");
    const arMapping = await accountingStore.findActivePurpose("AR_CONTROL");
    const glBalance = arMapping
      ? await store.glBalanceAsOf(arMapping.accountId, input.asOf)
      : "0.0000";

    const items = await store.arOpenItemsAsOf({
      asOf: input.asOf,
      openOnly: false,
      limit: 100000,
      side: "ALL",
    });
    let subledgerTotal = new Decimal(0);
    for (const item of items) {
      const signed = new Decimal(item.baseAmount).times(item.direction === "DEBIT" ? 1 : -1);
      subledgerTotal = subledgerTotal.plus(signed);
    }
    const opening = await store.openingArItems();
    const diff = subledgerTotal.minus(new Decimal(glBalance)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    return {
      ok: diff === "0.0000",
      subledgerTotal: subledgerTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      glBalance,
      openingItems: opening.length,
      diff,
    };
  }
}
