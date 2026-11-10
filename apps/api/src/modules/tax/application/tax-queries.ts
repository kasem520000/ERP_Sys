import { Injectable } from "@nestjs/common";

import * as store from "../infrastructure/tax.store";
import * as submissionsStore from "../submissions/store";

/**
 * PHASE-013 · tax report queries (REPORT_CATALOG §6): the VAT return v2
 * (rich) — both sides (document summaries vs GL movements) side-by-side
 * with treatment/rate buckets — plus the by-treatment summary. Wraps the
 * tax store aggregates (the module-owned authorized query surface);
 * INV-012 is the binding tie.
 *
 * PHASE-035 T-06 · the e-invoicing submission log (REPORT_CATALOG §6
 * `tax.e-invoicing-log`, the documented-but-missing 86th contract): a
 * read-only register over e_invoicing_submissions via the module-owned
 * submissions store (ADR-0011 — reports never write, never raw-SQL across
 * modules; the store is the authorized surface the funnel screens share).
 */

export interface VatBothSides {
  documentSide: { outputTax: string; inputTaxRecoverable: string; inputTaxExpensed: string };
  glSide: { vatPayableNetCredit: string; vatRecoverableNetDebit: string; vatExpensedNetDebit: string };
  byTreatment: readonly {
    direction: string;
    treatment: string;
    rate: string;
    taxableBase: string;
    taxAmount: string;
  }[];
}

/** One e-invoicing submission-log row (PHASE-035 T-06 — the flattened
 * register view the report renders; status/attempts/timestamps only, no
 * secrets: payload digests and file ids stay in the operational funnel). */
export interface EInvoicingLogRow {
  readonly id: string;
  readonly countryCode: string;
  readonly adapterId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly status: string;
  readonly attempts: number;
  readonly authorityReference: string | null;
  readonly lastErrorCode: string | null;
  readonly submittedAt: string | null;
  readonly respondedAt: string | null;
  readonly reportedAt: string | null;
  readonly createdAt: string;
}

@Injectable()
export class TaxQueriesService {
  /** VAT return v2: both sides + per-treatment/rate buckets for a window. */
  async vatReturnBothSides(input: {
    countryCode: string;
    fromDate: string;
    toDate: string;
  }): Promise<VatBothSides> {
    const summaries = await store.aggregateSummaries({
      countryCode: input.countryCode,
      fromDate: input.fromDate,
      toDate: input.toDate,
    });
    const gl = await store.glTaxMovements({
      fromDate: input.fromDate,
      toDate: input.toDate,
    });
    const sumFor = (direction: string): string =>
      summaries
        .filter((row) => row.direction === direction)
        .reduce((acc, row) => acc + Number(row.taxAmount), 0)
        .toFixed(4);
    const glFor = (purposeKey: string): string =>
      gl
        .filter((row) => row.purposeKey === purposeKey)
        .reduce((acc, row) => acc + Number(row.netMovement), 0)
        .toFixed(4);
    return {
      documentSide: {
        outputTax: sumFor("SALES"),
        inputTaxRecoverable: sumFor("PURCHASE"),
        inputTaxExpensed: "0.0000",
      },
      glSide: {
        vatPayableNetCredit: glFor("VAT_PAYABLE"),
        vatRecoverableNetDebit: glFor("VAT_RECOVERABLE"),
        vatExpensedNetDebit: glFor("VAT_EXPENSED"),
      },
      byTreatment: summaries.map((row) => ({
        direction: row.direction,
        treatment: row.treatment,
        rate: row.rate,
        taxableBase: row.taxableBase,
        taxAmount: row.taxAmount,
      })),
    };
  }

  /** PHASE-035 T-06 · the e-invoicing submission log for a window: the
   * registry's operational read surface (status/adapter/country filters,
   * created_at window, newest first) — REPORT_CATALOG §6 tax.e-invoicing-log. */
  async submissionLog(input: {
    dateFrom?: string;
    dateTo?: string;
    status?: string;
    adapterId?: string;
    countryCode?: string;
  }): Promise<readonly EInvoicingLogRow[]> {
    const rows = await submissionsStore.listSubmissions({
      createdFrom: input.dateFrom,
      createdTo: input.dateTo,
      status: input.status,
      adapterId: input.adapterId,
      countryCode: input.countryCode,
      limit: 500,
    });
    return rows.map((row) => ({
      id: row.id,
      countryCode: row.countryCode,
      adapterId: row.adapterId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      status: row.status,
      attempts: row.attempts,
      authorityReference: row.authorityReference,
      lastErrorCode: row.lastErrorCode,
      submittedAt: row.submittedAt,
      respondedAt: row.respondedAt,
      reportedAt: row.reportedAt,
      createdAt: row.createdAt,
    }));
  }
}
