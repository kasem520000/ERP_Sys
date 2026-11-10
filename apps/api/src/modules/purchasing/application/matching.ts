import { Decimal } from "@erp/domain-core";

import * as store from "../infrastructure/purchasing.store";
import {
  MatchDispositionInvalidError,
  MatchExceptionUndisposedError,
  MatchOutcomeMissingError,
  MatchRequiresLinesError,
  SupplierInvoiceNotFoundError,
} from "../domain/purchasing-errors";

/**
 * Three-way matching (PHASE-011 T4/T5; BR-009; ACCOUNTING_TESTS §2): PO ↔
 * GRN ↔ invoice consistency with tenant tolerances
 * (`purchasing.match.qty_tolerance_pct` / `purchasing.match.price_tolerance_pct`,
 * both 0 = exact by default). The per-line outcome triple (PO qty/price,
 * GRN received qty, invoice qty/price) computes from immutable posted
 * rows; variances within tolerance auto-pass WITH the variance recorded;
 * above-tolerance lines require an explicit buyer disposition
 * (ACCEPT_WITH_REASON / DEBIT_NOTE / GRN_AMENDMENT) before approval.
 *
 * The `match_result` jsonb (per-line outcomes + dispositions + summary)
 * persists on the supplier invoice BEFORE approval and is audit-visible;
 * `purchasing.matching.override` (risky) may widen tolerances per match
 * run — every override lands in the recorded result.
 */

export type MatchLineOutcome =
  | "MATCHED"
  | "QTY_VARIANCE_WITHIN_TOLERANCE"
  | "PRICE_VARIANCE_WITHIN_TOLERANCE"
  | "QTY_EXCEPTION"
  | "PRICE_EXCEPTION"
  | "UNMATCHED";

export type MatchDispositionType = "ACCEPT_WITH_REASON" | "DEBIT_NOTE" | "GRN_AMENDMENT";

export interface MatchLineResult {
  invoiceLineNo: number;
  grnLineId: string | null;
  poLineId: string | null;
  itemId: string | null;
  accountId: string | null;
  /** PO data (null for direct lines). */
  poQty: string | null;
  poUnitPrice: string | null;
  /** GRN data (null for direct lines). */
  grnQty: string | null;
  grnUnitCost: string | null;
  /** Invoice data. */
  invoiceQty: string;
  invoiceUnitPrice: string;
  qtyVariancePct: string | null;
  priceVariancePct: string | null;
  outcome: MatchLineOutcome;
  disposition: { type: MatchDispositionType; reason: string; by: string | null; at: string } | null;
}

export interface MatchResult {
  matchedAt: string;
  matchedBy: string | null;
  tolerances: { qtyPct: string; pricePct: string };
  overrideApplied: boolean;
  lines: MatchLineResult[];
  summary: { outcome: "MATCHED" | "EXCEPTION" | "DISPOSITIONED"; exceptions: number; undisposed: number };
}

export interface MatchDispositionInput {
  invoiceLineNo: number;
  type: MatchDispositionType;
  reason: string;
}

function pct(variance: Decimal, base: Decimal): string | null {
  if (base.isZero()) return null;
  return variance.abs().div(base).times(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

export class MatchingService {
  /**
   * Compute the three-way match for an invoice's lines (preview + the
   * recorded run share this path). Pure computation over immutable rows —
   * deterministic, side-effect free.
   */
  async computeMatch(input: {
    invoiceId: string;
    tolerancesOverride?: { qtyPct: string; pricePct: string } | null;
    dispositions?: readonly MatchDispositionInput[];
    actorId: string | null;
  }): Promise<MatchResult> {
    const invoice = await store.findSupplierInvoiceById(input.invoiceId);
    if (invoice === undefined) throw new SupplierInvoiceNotFoundError(input.invoiceId);
    const invoiceLines = await store.listSupplierInvoiceLines(input.invoiceId);
    if (invoiceLines.length === 0) {
      throw new MatchRequiresLinesError(`supplier invoice ${input.invoiceId} has no lines to match`);
    }

    const qtyPct =
      input.tolerancesOverride?.qtyPct ??
      (await store.readSetting<string>("purchasing.match.qty_tolerance_pct")) ??
      "0";
    const pricePct =
      input.tolerancesOverride?.pricePct ??
      (await store.readSetting<string>("purchasing.match.price_tolerance_pct")) ??
      "0";
    const qtyTolerance = new Decimal(qtyPct);
    const priceTolerance = new Decimal(pricePct);

    // GRN lines + PO lines lookup (posted GRNs only — direct id lookups).
    const grnLineById = new Map<string, { qty: string; unitCost: string; poLineId: string | null; receiptSupplier: string }>();
    const grnLineIds = invoiceLines
      .map((line) => line.grnLineId)
      .filter((id): id is string => id !== null);
    const grnRows = await store.findGrnLinesByIds([...new Set(grnLineIds)]);
    for (const row of grnRows) {
      if (row.receiptStatus !== "POSTED") {
        throw new MatchRequiresLinesError(
          `GRN line ${row.id} is not on a POSTED goods receipt — match requires posted receipts`,
        );
      }
      grnLineById.set(row.id, {
        qty: row.qty,
        unitCost: row.unitCost,
        poLineId: row.poLineId,
        receiptSupplier: row.receiptSupplier,
      });
    }
    for (const line of invoiceLines) {
      if (line.grnLineId !== null && !grnLineById.has(line.grnLineId)) {
        throw new MatchRequiresLinesError(
          `GRN line ${line.grnLineId} does not exist in this tenant`,
        );
      }
    }
    const poLineIds = [...grnLineById.values()]
      .map((grn) => grn.poLineId)
      .filter((id): id is string => id !== null);
    const poLineById = new Map<string, { qty: string; unitPrice: string }>(
      (await store.findPoLinesByIds([...new Set(poLineIds)])).map((pl) => [
        pl.id,
        { qty: pl.qty, unitPrice: pl.unitPrice },
      ]),
    );

    const dispositions = new Map<number, MatchDispositionInput>(
      (input.dispositions ?? []).map((d) => [d.invoiceLineNo, d]),
    );
    const lines: MatchLineResult[] = [];
    let exceptions = 0;
    let undisposed = 0;
    for (const line of invoiceLines) {
      const grn = line.grnLineId !== null ? grnLineById.get(line.grnLineId) : undefined;
      const poLine =
        grn !== undefined && grn.poLineId !== null ? poLineById.get(grn.poLineId) : undefined;

      let outcome: MatchLineOutcome;
      let qtyVariancePct: string | null = null;
      let priceVariancePct: string | null = null;

      if (grn === undefined) {
        // Direct (no-GRN) line: matches nothing — an explicit exception the
        // buyer must dispose (or the invoice is expense-only by design).
        outcome = "UNMATCHED";
        exceptions += 1;
      } else {
        // Quantity: invoicing AT OR BELOW the received qty is normal (the
        // GRNI remainder stays open — partial invoicing); invoicing ABOVE
        // the received qty is the 2-unit-gap exception (BR-009's worked
        // failure path: disposition before approval). The variance records
        // on every line either way.
        const qtyVariance = new Decimal(line.qty).minus(new Decimal(grn.qty));
        qtyVariancePct = pct(qtyVariance, new Decimal(grn.qty));
        const invoiceExceedsReceived = qtyVariance.gt(0);
        const priceVariance = new Decimal(line.unitPrice).minus(new Decimal(grn.unitCost));
        const priceBase = new Decimal(grn.unitCost);
        priceVariancePct = pct(priceVariance, priceBase);
        const priceAbove = priceVariancePct !== null && new Decimal(priceVariancePct).gt(priceTolerance);
        const priceHasVariance =
          priceVariancePct !== null && new Decimal(priceVariancePct).gt(0);

        if (invoiceExceedsReceived) {
          outcome = "QTY_EXCEPTION";
          exceptions += 1;
        } else if (priceAbove) {
          outcome = "PRICE_EXCEPTION";
          exceptions += 1;
        } else if (priceHasVariance) {
          // Within tolerance → auto-pass WITH the variance recorded (the
          // BR-009 worked example's 2% case).
          outcome = "PRICE_VARIANCE_WITHIN_TOLERANCE";
        } else if (poLine !== undefined) {
          // Invoice ↔ GRN agreed; check the PO leg (short receipt within
          // tolerance passes — the PO stays open for the remainder).
          const poQtyVariance = new Decimal(grn.qty).minus(new Decimal(poLine.qty));
          const poQtyVarPct = pct(poQtyVariance, new Decimal(poLine.qty));
          if (poQtyVarPct !== null && new Decimal(poQtyVarPct).gt(qtyTolerance)) {
            outcome = "QTY_EXCEPTION";
            exceptions += 1;
          } else {
            outcome = "MATCHED";
          }
        } else {
          outcome = "MATCHED";
        }
      }

      const dispositionInput = dispositions.get(line.lineNo);
      let disposition: MatchLineResult["disposition"] = null;
      if (dispositionInput !== undefined) {
        if (dispositionInput.reason.trim() === "") {
          throw new MatchDispositionInvalidError(
            `disposition on line ${line.lineNo} requires an explicit reason (BR-009)`,
          );
        }
        disposition = {
          type: dispositionInput.type,
          reason: dispositionInput.reason,
          by: input.actorId,
          at: new Date().toISOString(),
        };
      }

      if ((outcome === "QTY_EXCEPTION" || outcome === "PRICE_EXCEPTION" || outcome === "UNMATCHED") && disposition === null) {
        undisposed += 1;
      }

      lines.push({
        invoiceLineNo: line.lineNo,
        grnLineId: line.grnLineId,
        poLineId: grn?.poLineId ?? null,
        itemId: line.itemId,
        accountId: line.accountId,
        poQty: poLine?.qty ?? null,
        poUnitPrice: poLine?.unitPrice ?? null,
        grnQty: grn?.qty ?? null,
        grnUnitCost: grn?.unitCost ?? null,
        invoiceQty: line.qty,
        invoiceUnitPrice: line.unitPrice,
        qtyVariancePct,
        priceVariancePct,
        outcome,
        disposition,
      });
    }

    const summaryOutcome = exceptions === 0 ? "MATCHED" : undisposed === 0 ? "DISPOSITIONED" : "EXCEPTION";
    return {
      matchedAt: new Date().toISOString(),
      matchedBy: input.actorId,
      tolerances: { qtyPct, pricePct },
      overrideApplied: input.tolerancesOverride !== undefined && input.tolerancesOverride !== null,
      lines,
      summary: { outcome: summaryOutcome, exceptions, undisposed },
    };
  }

  /**
   * Record the match result on the invoice (match-before-approval, BR-009).
   * Dispositions may be attached in the same call (re-running the match
   * with dispositions preserves the previously computed variances — the
   * computation is deterministic).
   */
  async recordMatch(input: {
    invoiceId: string;
    tolerancesOverride?: { qtyPct: string; pricePct: string } | null;
    dispositions?: readonly MatchDispositionInput[];
    actorId: string | null;
  }): Promise<MatchResult> {
    const invoice = await store.findSupplierInvoiceById(input.invoiceId);
    if (invoice === undefined) throw new SupplierInvoiceNotFoundError(input.invoiceId);
    if (invoice.status === "POSTED" || invoice.status === "CANCELLED") {
      throw new MatchDispositionInvalidError(
        `supplier invoice ${input.invoiceId} is ${invoice.status} — the match outcome is frozen on posted documents (BR-033)`,
      );
    }
    const result = await this.computeMatch(input);
    await store.updateSupplierInvoiceStatus({
      id: input.invoiceId,
      actorId: input.actorId,
      matchStatus: result.summary.outcome,
      matchResult: result as unknown as Record<string, unknown>,
    });
    return result;
  }

  /**
   * The approval gate: every supplier invoice must carry a recorded match
   * outcome, and every above-tolerance exception an explicit disposition
   * (BR-009 — no posting path bypasses this).
   */
  assertApprovable(invoice: { matchStatus: string; matchResult: Record<string, unknown> | null; id: string }): void {
    if (invoice.matchResult === null) {
      throw new MatchOutcomeMissingError(invoice.id);
    }
    if (invoice.matchStatus === "EXCEPTION") {
      const summary = (invoice.matchResult as { summary?: { undisposed?: number; exceptions?: number } }).summary;
      throw new MatchExceptionUndisposedError({
        invoiceId: invoice.id,
        exceptions: summary?.exceptions ?? summary?.undisposed ?? 1,
      });
    }
  }
}
