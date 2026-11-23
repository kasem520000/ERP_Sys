/**
 * PHASE-050 (W-28 — T-13, 2026-11-23) THE SHARED BLOCKING VALIDATION
 * SERVICE — D-07's own demand: ONE service, the ONLY gate. INV-035 +
 * BR-101: any issue/ship document line referencing a batch with an
 * ACTIVE quality hold is rejected SERVER-SIDE, on EVERY baseline path —
 * structurally, because the gate is wired INSIDE the inventory movement
 * core's planIssue (the reserved-pool hard-protection precedent's own
 * choke point): every path that resolves batch slices passes here, and
 * the enforcement-drift risk (a new path forgetting the check — the
 * phase doc §7's own risk) is closed by construction.
 *
 * THE SOLE BYPASS (the allowQuarantinedBatch precedent's discipline):
 * the quality module's own G-62 write-off (the NCR disposition act —
 * sourceType `ncr_record`) carries `allowHeldBatch: true` because the
 * 0116 flow's own demand: the SCRAP write-off lands AT the disposition,
 * while the investigating hold may still be ACTIVE (the hold's release
 * comes after, justified by this very disposition — BR-101's own
 * ordering). Every other caller — sales delivery, sales invoice with
 * goods, manual issue, transfers, job cards, service orders, production
 * consumption, tolling, kitting, count losses, adjustments, supplier
 * RMA, maintenance work orders — is gated with NO exception.
 *
 * THE SERVER-SIDE-ONLY LAW (D-20/OA-02): the check lives here, in the
 * server's plan phase — an offline document carrying a held batch is
 * rejected at sync reconciliation when its POST runs this same plan.
 */
import { BatchQualityHoldError } from "../domain/quality-errors";
import { heldBatchTarget } from "../domain/hold-blocking";
import * as store from "../infrastructure/quality.store";

/**
 * THE GATE: throws BatchQualityHoldError (the 409 typed refusal naming
 * the batch, the reason and the figures) when ANY of the given batches
 * carries an ACTIVE hold; returns silently when none does. One read
 * (the partial unique index's own access path), one deterministic
 * refusal target (the fold's own law — the caller's slice order is not
 * evidence).
 */
export async function assertNoActiveBatchHolds(
  batchIds: readonly string[],
): Promise<void> {
  if (batchIds.length === 0) return;
  const holds = await store.findActiveHoldsByBatches(batchIds);
  const target = heldBatchTarget(batchIds, holds);
  if (target !== null) {
    throw new BatchQualityHoldError({
      batchId: target.batchId,
      holdId: target.id,
      reason: target.reason,
      heldAt: target.heldAt,
    });
  }
}
