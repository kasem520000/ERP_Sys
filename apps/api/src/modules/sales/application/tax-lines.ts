import { Decimal } from "@erp/domain-core";

import type { JournalLineSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { TaxResolverService } from "../../tax/application/tax-resolver-service";
import { accumulateSummary } from "../../tax/application/posting-adapter";
import type { ResolvedLine } from "../../tax/domain/resolver";

/**
 * PHASE-012 T6 — output-VAT wiring (TAX_ENGINE §1/§2; ADR-0010): the
 * sanctioned bridge between resolved sales-document tax lines and the
 * posting engine's output-side purposes. Resolution is per pack + tenant
 * registration — never hard-coded:
 *
 *   - NOT_SUBJECT (unregistered tenant, NO_VAT/VAT_PLANNED jurisdiction, or
 *     NOT_SUBJECT code): no VAT journal line — the line's taxAmount is 0 by
 *     the resolver (documents show no VAT; the later registration
 *     transition is clean — honest books).
 *   - ZERO_RATED / EXEMPT / OUT_OF_SCOPE: no VAT line (an exempt supply is
 *     simply outside the VAT net — revenue carries the gross).
 *   - REVERSE_CHARGE: the self-accounted pair (DR VAT_PAYABLE · CR
 *     VAT_RECOVERABLE), mirroring the purchasing input-side RC pair.
 *   - STANDARD_RATED: CR VAT_PAYABLE (the G-01/G-02 output leg).
 *
 * The stamped snapshots (BR-033) travel on the returned line records; the
 * caller persists them on the sales-invoice/credit-note lines and
 * accumulates the document tax_summary by (treatment, rate, tax code) for
 * the INV-012 tie.
 */

export interface SalesTaxLine {
  readonly resolved: ResolvedLine;
  /** The output-side journal VAT lines for this line (0–2 entries). */
  readonly vatLines: JournalLineSpec[];
}

export interface ResolveOutputTaxResult {
  readonly lines: readonly SalesTaxLine[];
  /** Σ resolved taxAmount over all lines (document currency, 4-dp). */
  readonly totalTax: string;
  /** The deterministic document summary groups (INV-012 substrate). */
  readonly summaryGroups: ReturnType<typeof accumulateSummary>["groups"];
}

export async function resolveOutputTaxLines(input: {
  resolver: TaxResolverService;
  documentDate: string;
  currencyCode: string;
  lines: readonly { taxCodeId: string; amount: string }[];
}): Promise<ResolveOutputTaxResult> {
  const resolvedLines: SalesTaxLine[] = [];
  for (const line of input.lines) {
    const resolved = await input.resolver.resolveOne({
      documentDate: input.documentDate,
      line: {
        taxCodeId: line.taxCodeId,
        amount: line.amount,
        currencyCode: input.currencyCode,
      },
    });
    resolvedLines.push({
      resolved,
      vatLines: outputVatJournalLines(resolved),
    });
  }

  const relevant = resolvedLines.map((line) => line.resolved);
  const { groups, totalTax } = accumulateSummary("OUTPUT", relevant);
  return { lines: resolvedLines, totalTax, summaryGroups: groups };
}

/**
 * The output-VAT journal lines per resolved line (the G-01/G-02/G-04 tax
 * legs). Zero-tax resolutions carry no line — the honest shapes.
 */
export function outputVatJournalLines(resolved: ResolvedLine): JournalLineSpec[] {
  if (resolved.notSubject) return [];
  if (
    resolved.treatment === "ZERO_RATED" ||
    resolved.treatment === "EXEMPT" ||
    resolved.treatment === "OUT_OF_SCOPE"
  ) {
    return [];
  }
  if (resolved.taxAmount === "0.0000" || Number(resolved.taxAmount) === 0) return [];
  const memo = {
    en: `Output VAT ${resolved.code}`,
    ar: `ضريبة مخرجات ${resolved.code}`,
  };
  if (resolved.treatment === "REVERSE_CHARGE") {
    return [
      { purpose: "VAT_PAYABLE", direction: "DEBIT", amount: resolved.taxAmount, taxCodeId: resolved.taxCodeId, memo },
      { purpose: "VAT_RECOVERABLE", direction: "CREDIT", amount: resolved.taxAmount, taxCodeId: resolved.taxCodeId, memo },
    ];
  }
  return [
    {
      purpose: "VAT_PAYABLE",
      direction: "CREDIT",
      amount: resolved.taxAmount,
      taxCodeId: resolved.taxCodeId,
      memo,
    },
  ];
}

/** Σ of the output VAT lines that post as payable (asserts G-01 legs). */
export function outputTaxTotal(lines: readonly SalesTaxLine[]): string {
  let total = new Decimal(0);
  for (const line of lines) {
    for (const vatLine of line.vatLines) {
      if (vatLine.purpose === "VAT_PAYABLE" && vatLine.direction === "CREDIT") {
        total = total.plus(new Decimal(vatLine.amount));
      }
    }
  }
  return total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}
