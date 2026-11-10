import { Decimal } from "@erp/domain-core";

import type { JournalLineSpec } from "../../accounting/domain/posting-engine/journal-spec";
import type { ResolvedLine, TaxTreatment } from "../domain/resolver";
import * as store from "../infrastructure/tax.store";

/**
 * PHASE-009 T6 — the tax posting adapter: the SANCTIONED bridge between
 * resolved tax lines and (a) the posting engine's VAT-purpose journal lines
 * (VAT_PAYABLE / VAT_RECOVERABLE / VAT_EXPENSED — fail-closed purposes,
 * ADR-0007: tax posts only via the engine) and (b) the INV-012 document-
 * summary substrate (the append-only tax_document_summaries rows the VAT
 * return aggregates and the RC-06/RC-07 checks reconcile).
 *
 * This is the integration seam PHASE-011/012 consume: sales/purchasing
 * compose their documents' lines, call the resolver, then hand the resolved
 * summary to these helpers inside their posting transaction. Treasury's
 * expense payout (G-11) is the first in-phase consumer.
 */

/** Deterministic summary group ordering (byte-identical re-runs). */
function groupKey(line: ResolvedLine): string {
  return `${line.treatment}|${line.rate}|${line.taxCodeId}`;
}

export interface SummaryGroup {
  readonly direction: "OUTPUT" | "INPUT";
  readonly treatment: TaxTreatment;
  readonly rate: string;
  readonly taxCodeId: string;
  readonly taxableBase: string;
  readonly taxAmount: string;
  readonly snapshot: ResolvedLine["snapshot"];
}

/**
 * Accumulate resolved lines into the document tax summary (TAX_ENGINE §2):
 * groups keyed by (direction, treatment, rate, tax code), OUTPUT before
 * INPUT, canonical treatment order within a direction — deterministic so
 * recomputation matches byte-for-byte.
 */
export function accumulateSummary(
  direction: "OUTPUT" | "INPUT",
  lines: readonly ResolvedLine[],
): { groups: SummaryGroup[]; totalTax: string } {
  const order: Record<string, number> = {
    STANDARD_RATED: 0,
    ZERO_RATED: 1,
    EXEMPT: 2,
    OUT_OF_SCOPE: 3,
    REVERSE_CHARGE: 4,
    NOT_SUBJECT: 5,
  };
  const byKey = new Map<string, SummaryGroup>();
  for (const line of lines) {
    if (line.notSubject) continue; // §2.8: no VAT fields — never summarized as VAT
    const key = groupKey(line);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, {
        direction,
        treatment: line.treatment,
        rate: line.rate,
        taxCodeId: line.taxCodeId,
        taxableBase: line.taxBase,
        taxAmount: line.taxAmount,
        snapshot: line.snapshot,
      });
    } else {
      byKey.set(key, {
        ...existing,
        taxableBase: addExact4(existing.taxableBase, line.taxBase),
        taxAmount: addExact4(existing.taxAmount, line.taxAmount),
      });
    }
  }
  const groups = [...byKey.values()].sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === "OUTPUT" ? -1 : 1;
    if (order[a.treatment] !== order[b.treatment]) return order[a.treatment]! - order[b.treatment]!;
    if (a.rate !== b.rate) return a.rate < b.rate ? -1 : 1;
    return a.taxCodeId < b.taxCodeId ? -1 : 1;
  });
  let totalTax = "0.0000";
  for (const group of groups) totalTax = addExact4(totalTax, group.taxAmount);
  return { groups, totalTax };
}

function addExact4(a: string, b: string): string {
  return new Decimal(a).plus(new Decimal(b)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/**
 * The G-11 expense tax leg: input VAT extracted from the gross payout.
 * STANDARD_RATED: the claim includes recoverable VAT →
 *   DR EXPENSE (gross − tax) · DR VAT_RECOVERABLE tax · CR CASH gross.
 * REVERSE_CHARGE: the payout is net (supplier charges no VAT) and the
 * buyer self-accounts the pair additionally:
 *   DR EXPENSE gross · DR VAT_RECOVERABLE tax · CR VAT_PAYABLE tax · CR CASH gross.
 * Zero-rated / exempt / out-of-scope / NOT_SUBJECT: no VAT line (t = 0) —
 * the honest shapes (absence of VAT ≠ absence of obligations).
 */
export function expenseTaxLeg(line: ResolvedLine): {
  netExpenseAmount: string;
  vatLines: JournalLineSpec[];
  taxAmount: string;
} {
  if (line.notSubject || line.treatment === "ZERO_RATED" || line.treatment === "EXEMPT" || line.treatment === "OUT_OF_SCOPE") {
    return { netExpenseAmount: line.gross, vatLines: [], taxAmount: "0.0000" };
  }
  const memo = {
    en: `Input VAT ${line.code}`,
    ar: `ضريبة مدخلات ${line.code}`,
  };
  if (line.treatment === "REVERSE_CHARGE") {
    return {
      netExpenseAmount: line.gross,
      vatLines: [
        { purpose: "VAT_RECOVERABLE", direction: "DEBIT", amount: line.taxAmount, taxCodeId: line.taxCodeId, memo },
        { purpose: "VAT_PAYABLE", direction: "CREDIT", amount: line.taxAmount, taxCodeId: line.taxCodeId, memo },
      ],
      taxAmount: line.taxAmount,
    };
  }
  // STANDARD_RATED input: recoverable by default (VAT_EXPENSED wiring per
  // pack/registration is PHASE-011 T6 — NEXT_ACTION records the seam).
  return {
    netExpenseAmount: line.taxBase,
    vatLines: [
      { purpose: "VAT_RECOVERABLE", direction: "DEBIT", amount: line.taxAmount, taxCodeId: line.taxCodeId, memo },
    ],
    taxAmount: line.taxAmount,
  };
}

/**
 * Write the INV-012 document-side rows (append-only) inside the posting
 * transaction — the VAT return + RC-06/RC-07 read these. NOT_SUBJECT lines
 * are never summarized (§2.8: no VAT fields).
 */
export async function recordDocumentTaxSummary(input: {
  sourceType: string;
  sourceId: string;
  documentDate: string;
  fiscalPeriodId: string | null;
  lines: readonly ResolvedLine[];
  direction: "OUTPUT" | "INPUT";
}): Promise<void> {
  const relevant = input.lines.filter((line) => !line.notSubject);
  const { groups } = accumulateSummary(input.direction, relevant);
  const countryCode = relevant[0]?.snapshot.countryCode ?? null;
  if (countryCode === null || groups.length === 0) return;
  await store.insertTaxDocumentSummaries(
    groups.map((group) => ({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      documentDate: input.documentDate,
      fiscalPeriodId: input.fiscalPeriodId,
      countryCode,
      direction: group.direction,
      treatment: group.treatment,
      rate: group.rate,
      taxCodeId: group.taxCodeId,
      taxableBase: group.taxableBase,
      taxAmount: group.taxAmount,
      snapshot: group.snapshot as unknown as Record<string, unknown>,
    })),
  );
}

/**
 * OUTPUT-side journal lines for a resolved summary (the seam PHASE-012's
 * sales invoices consume): VAT_PAYABLE credits per tax-carrying group.
 * RC self-accounted output posts alongside its INPUT pair (both recorded).
 */
export function outputTaxLines(summary: { groups: readonly SummaryGroup[] }): JournalLineSpec[] {
  const lines: JournalLineSpec[] = [];
  for (const group of summary.groups) {
    if (group.treatment === "NOT_SUBJECT" || group.treatment === "OUT_OF_SCOPE") continue;
    if (group.taxAmount === "0.0000") continue; // zero-rated/exempt carry no VAT line
    lines.push({
      purpose: "VAT_PAYABLE",
      direction: "CREDIT",
      amount: group.taxAmount,
      taxCodeId: group.taxCodeId,
      memo: { en: `Output VAT (${group.treatment})`, ar: `ضريبة مخرجات (${group.treatment})` },
    });
  }
  return lines;
}
