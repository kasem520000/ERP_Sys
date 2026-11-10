import { Decimal } from "@erp/domain-core";

import type { JournalLineSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { TaxResolverService } from "../../tax/application/tax-resolver-service";
import { accumulateSummary } from "../../tax/application/posting-adapter";
import type { ResolvedLine } from "../../tax/domain/resolver";
import * as store from "../infrastructure/purchasing.store";

/**
 * PHASE-011 T6 — input-VAT recoverability wiring (TAX_ENGINE §1/§2; ADR-0010):
 * the sanctioned bridge between resolved supplier-invoice tax lines and the
 * posting engine's input-side purposes. Resolution is per pack + tenant
 * registration — never hard-coded:
 *
 *   - NOT_SUBJECT (unregistered tenant, NO_VAT/VAT_PLANNED jurisdiction, or
 *     NOT_SUBJECT code): no VAT journal line — the line's taxAmount is 0 by
 *     the resolver (documents show no VAT; the later registration
 *     transition is clean).
 *   - ZERO_RATED / EXEMPT / OUT_OF_SCOPE: no VAT line (an exempt input is
 *     outside recovery by law — its cost is the gross paid).
 *   - REVERSE_CHARGE: the self-accounted pair (DR VAT_RECOVERABLE · CR
 *     VAT_PAYABLE), mirroring the treasury expense G-11 leg.
 *   - STANDARD_RATED: VAT_RECOVERABLE when eligible (default per the
 *     purchasing.input_vat_default setting or the per-line flag) else
 *     VAT_EXPENSED (inputs related to exempt supplies are expensed).
 *
 * The stamped snapshots (BR-033) travel on the returned line records; the
 * caller persists them on the supplier-invoice lines and accumulates the
 * document tax_summary by (treatment, rate, tax code) for the INV-012 tie.
 */

export interface PurchasingTaxLine {
  readonly resolved: ResolvedLine;
  /** The input-side journal VAT lines for this line (0–2 entries). */
  readonly vatLines: JournalLineSpec[];
  /** True when the line's input VAT posts to VAT_RECOVERABLE. */
  readonly recoverable: boolean;
}

export interface ResolveInputTaxResult {
  readonly lines: readonly PurchasingTaxLine[];
  /** Σ resolved taxAmount over all lines (document currency, 4-dp). */
  readonly totalTax: string;
  /** The deterministic document summary groups (INV-012 substrate). */
  readonly summaryGroups: ReturnType<typeof accumulateSummary>["groups"];
}

export async function resolveInputTaxLines(input: {
  resolver: TaxResolverService;
  documentDate: string;
  currencyCode: string;
  lines: readonly {
    taxCodeId: string;
    amount: string;
    vatRecoverable: boolean | null;
  }[];
}): Promise<ResolveInputTaxResult> {
  const defaultMode = (await store.readSetting<"recoverable" | "expensed">(
    "purchasing.input_vat_default",
  )) ?? "recoverable";

  const resolvedLines: PurchasingTaxLine[] = [];
  for (const line of input.lines) {
    const resolved = await input.resolver.resolveOne({
      documentDate: input.documentDate,
      line: {
        taxCodeId: line.taxCodeId,
        amount: line.amount,
        currencyCode: input.currencyCode,
      },
    });
    const recoverable = line.vatRecoverable ?? (defaultMode === "recoverable");
    resolvedLines.push({
      resolved,
      recoverable,
      vatLines: inputVatJournalLines(resolved, recoverable),
    });
  }

  const relevant = resolvedLines.map((line) => line.resolved);
  const { groups, totalTax } = accumulateSummary("INPUT", relevant);
  return { lines: resolvedLines, totalTax, summaryGroups: groups };
}

/**
 * The input-VAT journal lines per resolved line (the G-08/G-09 tax legs).
 * Zero-tax resolutions carry no line — the honest shapes.
 */
export function inputVatJournalLines(resolved: ResolvedLine, recoverable: boolean): JournalLineSpec[] {
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
    en: `Input VAT ${resolved.code}`,
    ar: `ضريبة مدخلات ${resolved.code}`,
  };
  if (resolved.treatment === "REVERSE_CHARGE") {
    return [
      { purpose: "VAT_RECOVERABLE", direction: "DEBIT", amount: resolved.taxAmount, taxCodeId: resolved.taxCodeId, memo },
      { purpose: "VAT_PAYABLE", direction: "CREDIT", amount: resolved.taxAmount, taxCodeId: resolved.taxCodeId, memo },
    ];
  }
  return [
    {
      purpose: recoverable ? "VAT_RECOVERABLE" : "VAT_EXPENSED",
      direction: "DEBIT",
      amount: resolved.taxAmount,
      taxCodeId: resolved.taxCodeId,
      memo,
    },
  ];
}

/** Σ of the input VAT lines that post as recoverable (asserts G-08 legs). */
export function recoverableTaxTotal(lines: readonly PurchasingTaxLine[]): string {
  let total = new Decimal(0);
  for (const line of lines) {
    for (const vatLine of line.vatLines) {
      if (vatLine.purpose === "VAT_RECOVERABLE" && vatLine.direction === "DEBIT") {
        total = total.plus(new Decimal(vatLine.amount));
      }
    }
  }
  return total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}
