import { Injectable } from "@nestjs/common";

import * as store from "../infrastructure/tax.store";

/**
 * PHASE-013 · tax report queries (REPORT_CATALOG §6): the VAT return v2
 * (rich) — both sides (document summaries vs GL movements) side-by-side
 * with treatment/rate buckets — plus the by-treatment summary. Wraps the
 * tax store aggregates (the module-owned authorized query surface);
 * INV-012 is the binding tie.
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
}
