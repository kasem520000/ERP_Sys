import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as journalStore from "../../accounting/infrastructure/journal.store";
import * as store from "../infrastructure/tax.store";

/**
 * PHASE-009 T11 — the INV-012 reconciliation check registered into the
 * PHASE-007 job framework (mirroring treasury's RC-08): Σ document tax
 * summaries vs GL tax-account movements, exact with 0 tolerance. Seeded
 * drift (RC-07 — a mutated summary row, only possible via superuser
 * tooling since the table is append-only for the app role) surfaces as a
 * BROKEN run: it blocks the VAT return's ready-to-file status AND period
 * LOCK (PC-04 — ReconciliationService.assertCoreChecksGreen reads the
 * runs) and fires the notification record (audit event with the diff).
 */
@Injectable()
export class TaxReconciliationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * RC-06 / INV-012 (all-time up to asOf — the as-of balance shape the
   * framework's runs share): Σ summaries' tax (OUTPUT and INPUT both
   * recorded — the RC self-accounted pair contributes to both sides) vs
   * Σ GL net movements on the three VAT purpose accounts (each in its
   * natural direction: payable net credit + recoverable/expensed net
   * debit). Runs even with zero tax activity (an OK run with zero counts
   * — the checklist's NOT_APPLICABLE branch reads the diff).
   */
  async runVatCheck(input: {
    asOf: string;
    runMode: "NIGHTLY" | "ON_DEMAND";
    checkedBy: string | null;
  }) {
    const gl = await store.glTaxMovements({ fromDate: "1970-01-01", toDate: input.asOf });
    const glSides = gl.map((row) => ({ purposeKey: row.purposeKey, netMovement: row.netMovement }));
    let glTotal = 0;
    for (const row of gl) glTotal += Number(row.netMovement);

    const perGroup = await store.aggregateAllSummaries(input.asOf);
    let documentTotal = 0;
    for (const row of perGroup) documentTotal += Number(row.taxAmount);

    const broken = Math.abs(glTotal - documentTotal) > 1e-9;
    const run = await journalStore.insertReconciliationRun({
      kind: "VAT",
      asOf: input.asOf,
      status: broken ? "BROKEN" : "OK",
      controlBalance: glTotal.toFixed(4),
      subledgerBalance: documentTotal.toFixed(4),
      diffCount: broken ? Math.max(glSides.length, 1) : 0,
      diff: broken
        ? {
            glSide: glSides,
            documentSide: perGroup.map((row) => ({
              direction: row.direction,
              treatment: row.treatment,
              taxAmount: row.taxAmount,
            })),
            note: "INV-012: Σ document tax summaries ≠ GL tax-account movements",
          }
        : { groups: perGroup.length, purposesMapped: glSides.length },
      runMode: input.runMode,
      checkedBy: input.checkedBy,
    });
    if (broken) {
      await this.audit.record({
        action: "tax.reconciliation_broken",
        entityType: "reconciliation_run",
        entityId: run.id,
        actorId: input.checkedBy ?? undefined,
        after: {
          kind: "VAT",
          glSide: glTotal.toFixed(4),
          documentSide: documentTotal.toFixed(4),
        },
      });
    }
    return run;
  }
}
