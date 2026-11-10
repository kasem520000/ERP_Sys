import { Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import * as store from "../infrastructure/purchasing.store";
import { ApQueryInvalidError } from "../domain/purchasing-errors";

/**
 * AP query services (PHASE-011 T9; RECEIVABLES_AND_PAYABLES §2/§7;
 * BR-028): aging buckets, supplier statements, and the GRNI register as
 * DETERMINISTIC as-of recomputations from immutable entries — identical
 * inputs yield byte-identical outputs (RC-10). These are the module-owned
 * query surfaces PHASE-013's report contracts (`ap.aging`,
 * `supplier.statement`, `purchasing.grni`, `purchasing.po-status`,
 * `purchasing.matching-exceptions`) will register over.
 */

export type AgingBucket = "not_due" | "1_30" | "31_60" | "61_90" | "90_plus";

export interface AgingRow {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  supplierNameAr: string | null;
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
}

export interface SupplierStatement {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  supplierNameAr: string | null;
  asOf: string;
  currencyCode: string;
  openingBalance: string;
  entries: StatementEntry[];
  closingBalance: string;
  closingBalanceBase: string;
  aging: Record<AgingBucket, string>;
}

@Injectable()
export class ApQueriesService {
  /**
   * AP aging at an as-of date (RC-10 deterministic): open items bucketed by
   * (dueDate − asOf): not due / 1–30 / 31–60 / 61–90 / 90+ days overdue,
   * per supplier per currency, with the base-currency total.
   */
  async aging(input: { asOf: string; supplierId?: string }): Promise<AgingRow[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) {
      throw new ApQueryInvalidError(`as-of must be an ISO date: ${input.asOf}`);
    }
    const items = await store.apOpenItemsAsOf({
      supplierId: input.supplierId,
      asOf: input.asOf,
      openOnly: true,
      limit: 10000,
    });
    const asOfMs = new Date(`${input.asOf}T00:00:00Z`).getTime();

    const bySupplier = new Map<string, AgingRow>();
    for (const item of items) {
      let row = bySupplier.get(item.partnerId);
      if (row === undefined) {
        row = {
          supplierId: item.partnerId,
          supplierCode: "",
          supplierName: "",
          supplierNameAr: null,
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
        bySupplier.set(item.partnerId, row);
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
      row[key === "not_due" ? "notDue" : key === "1_30" ? "b1_30" : key === "31_60" ? "b31_60" : key === "61_90" ? "b61_90" : "b90Plus"] =
        new Decimal(row[key === "not_due" ? "notDue" : key === "1_30" ? "b1_30" : key === "31_60" ? "b31_60" : key === "61_90" ? "b61_90" : "b90Plus"])
          .plus(amount).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      row.total = new Decimal(row.total).plus(amount).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      row.baseTotal = new Decimal(row.baseTotal)
        .plus(new Decimal(item.outstanding).times(new Decimal(item.exchangeRate)))
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      row.itemCount += 1;
    }

    // Supplier identity join (deterministic order by code).
    const suppliers = await store.suppliersWithApActivity(input.asOf, 10000);
    const supplierById = new Map(suppliers.map((s) => [s.supplierId, s]));
    for (const row of bySupplier.values()) {
      const supplier = supplierById.get(row.supplierId);
      if (supplier !== undefined) {
        row.supplierCode = supplier.code;
        row.supplierName = supplier.name;
        row.supplierNameAr = supplier.nameAr;
      }
    }
    return [...bySupplier.values()].sort((a, b) =>
      a.supplierCode < b.supplierCode ? -1 : a.supplierCode > b.supplierCode ? 1 : 0,
    );
  }

  /**
   * Supplier statement as-of (BR-028): running balance over the AP subledger
   * entries (invoices +, debit notes −, payments −, on-account, adjustments),
   * document currency + base totals, aging column.
   */
  async statement(input: { supplierId: string; asOf: string }): Promise<SupplierStatement> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) {
      throw new ApQueryInvalidError(`as-of must be an ISO date: ${input.asOf}`);
    }
    const supplier = await store.findSupplierById(input.supplierId);
    if (supplier === undefined) {
      throw new ApQueryInvalidError(`supplier ${input.supplierId} does not exist in this tenant`);
    }
    const entries = await store.partnerApStatementEntries({
      supplierId: input.supplierId,
      asOf: input.asOf,
    });

    const agingRow = (await this.aging({ asOf: input.asOf, supplierId: input.supplierId }))[0];
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
      });
    }

    return {
      supplierId: input.supplierId,
      supplierCode: supplier.code,
      supplierName: supplier.name,
      supplierNameAr: supplier.nameAr,
      asOf: input.asOf,
      currencyCode: entries[0]?.currencyCode ?? "—",
      openingBalance: "0.0000",
      entries: statementEntries,
      closingBalance: balance.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      closingBalanceBase: baseBalance.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      aging,
    };
  }

  /** The GRNI register (§2.9; RC-09): per GRN line received − invoiced. */
  async grniRegister(asOf: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      throw new ApQueryInvalidError(`as-of must be an ISO date: ${asOf}`);
    }
    return store.grniRegister(asOf);
  }

  /** Open AP items (payments allocation surface). */
  async openItems(filter: { supplierId?: string; limit?: number }) {
    return store.apOpenItemsAsOf({
      supplierId: filter.supplierId,
      asOf: new Date().toISOString().slice(0, 10),
      openOnly: true,
      limit: filter.limit ?? 200,
    });
  }
}
