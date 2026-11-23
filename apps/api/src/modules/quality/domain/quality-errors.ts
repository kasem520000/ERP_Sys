import { DomainError } from "@erp/domain-core";

/**
 * PHASE-050 (W-25 — T-05 + T-06, 2026-11-23) THE QUALITY TYPED-REFUSAL
 * TAXONOMY (the cmms-errors precedent: stable UPPER_SNAKE codes are the
 * API contract, the message is display-only, the details payload is
 * machine-readable). The reservation law rides every class: the codes
 * name BR-102's closure gate and G-62's floors exactly as the phase
 * doc's own wording; no identifier outside the 050 reservations
 * (G-62…G-63 · INV-035 · BR-101…BR-104) is invented anywhere.
 *
 * The HTTP face (the PHASE-045 T-03 lesson applied at the FIRST quality
 * increment): the not-found classes register as 404 and the lifecycle
 * conflicts as 409 in error.filter.ts's domainStatus chain in the SAME
 * increment that ships the routes — never the 422 fall-through drift.
 */

/** The service-level input floor (the CmmsInputInvalidError precedent —
 * the controller's zod parse errors surface as VALIDATION_ERROR; this
 * class guards the invariants the zod shape cannot express). */
export class QualityInputInvalidError extends DomainError {
  constructor(details: { field: string; reason: string }) {
    super(
      "QUALITY_INPUT_INVALID",
      `quality input invalid at ${details.field}: ${details.reason}`,
      details,
    );
  }
}

// ── the specifications plane (T-05) ──────────────────────────────────────────

export class QualitySpecificationNotFoundError extends DomainError {
  constructor(details: { specificationId: string }) {
    super(
      "QUALITY_SPECIFICATION_NOT_FOUND",
      `quality specification ${details.specificationId} does not exist in this tenant`,
      details,
    );
  }
}

/** The (tenant, item, parameter) natural key is unique (the 0113 uq) —
 * the service refuses BY NAME before the DB floor (the typed pre-check
 * law; the 23505 never surfaces raw). */
export class QualitySpecificationDuplicateError extends DomainError {
  constructor(details: { itemId: string; parameter: string }) {
    super(
      "QUALITY_SPECIFICATION_DUPLICATE",
      `item ${details.itemId} already carries a specification parameter "${details.parameter}" (the (tenant, item, parameter) key is unique — uq_quality_specifications_tenant_item_parameter)`,
      details,
    );
  }
}

/** THE NO-FABRICATION BAND LAW (0113's own floor, the BR-055 family):
 * a band, when both ends are set, must be real (UCL > LCL); the
 * service refuses the point band / inverted band BY NAME before the DB
 * floor so the caller gets the parameter and both figures. */
export class QualitySpecBandInvalidError extends DomainError {
  constructor(details: { parameter: string; ucl: string; lcl: string }) {
    super(
      "QUALITY_SPEC_BAND_INVALID",
      `the tolerance band for parameter "${details.parameter}" is not a real band: UCL ${details.ucl} must be greater than LCL ${details.lcl} (an unset tolerance is UNTOLERATED and legal — a one-sided band too — but a point or inverted band is refused)`,
      details,
    );
  }
}

/** The mapping contract's engine-side not-found (the inspections
 * module's own row — the composite FK's service-level face, 0114). */
export class QualityInspectionNotFoundError extends DomainError {
  constructor(details: { inspectionId: string }) {
    super(
      "QUALITY_INSPECTION_NOT_FOUND",
      `inspection ${details.inspectionId} does not exist in this tenant (the INSPECTION-sourced NCR and the specification map bind to the inspections module's own rows — the 0114 composite FK's service face)`,
      details,
    );
  }
}

// ── the NCR plane (T-06) ─────────────────────────────────────────────────────

export class NcrRecordNotFoundError extends DomainError {
  constructor(details: { ncrId: string }) {
    super(
      "NCR_RECORD_NOT_FOUND",
      `NCR ${details.ncrId} does not exist in this tenant`,
      details,
    );
  }
}

/** The lifecycle refusals (the ladder OPEN → DISPOSITIONED → CLOSED —
 * the CmmsWorkOrderStateError precedent: the refusal carries the
 * record, its current state, and the refused move). */
export class NcrStateError extends DomainError {
  constructor(details: { ncrId: string; ncrNo: string; from: string; to: string; reason: string }) {
    super(
      "NCR_STATE_ERROR",
      `NCR ${details.ncrNo} is ${details.from} — the move to ${details.to} is illegal (${details.reason}; the ladder is OPEN → DISPOSITIONED → CLOSED)`,
      details,
    );
  }
}

/** BR-102's OWN typed refusal (the phase doc's wording: no NCR closes
 * without a disposition — the typed refusal NAMING the record): the
 * close act on an OPEN record, carrying the record's own figures. */
export class NcrDispositionRequiredError extends DomainError {
  constructor(details: { ncrId: string; ncrNo: string; status: string }) {
    super(
      "NCR_DISPOSITION_REQUIRED",
      `NCR ${details.ncrNo} cannot close without a disposition (BR-102 — the record is ${details.status}; the ladder is OPEN → DISPOSITIONED → CLOSED and closure requires the disposition pair)`,
      details,
    );
  }
}

/** G-62's affected-quantity floor (D-05: the affected quantity is
 * capped by the batch's own on-hand — the live stock read, never a DB
 * constraint; the refusal names BOTH figures). */
export class NcrAffectedQtyAboveOnHandError extends DomainError {
  constructor(details: { batchId: string; affectedQty: string; onHand: string }) {
    super(
      "NCR_AFFECTED_QTY_ABOVE_ON_HAND",
      `the affected quantity ${details.affectedQty} exceeds the batch's own on-hand ${details.onHand} (G-62's floor — the write-off can never take more stock than the batch holds)`,
      details,
    );
  }
}

// ── the CAPA plane (T-07 — W-26) ─────────────────────────────────────────────

export class CapaRecordNotFoundError extends DomainError {
  constructor(details: { capaId: string }) {
    super(
      "CAPA_RECORD_NOT_FOUND",
      `CAPA ${details.capaId} does not exist in this tenant`,
      details,
    );
  }
}

/** The lifecycle refusals (the ladder OPEN → IN_PROGRESS → CLOSED — the
 * NcrStateError precedent: the refusal carries the record, its current
 * state, the refused move, and the fold's own reason line). */
export class CapaStateError extends DomainError {
  constructor(details: {
    capaId: string;
    capaNo: string;
    from: string;
    to: string;
    reason: string;
  }) {
    super(
      "CAPA_STATE_ERROR",
      `CAPA ${details.capaNo} is ${details.from} — the move to ${details.to} is illegal (${details.reason}; the ladder is OPEN → IN_PROGRESS → CLOSED)`,
      details,
    );
  }
}

/** BR-103's due-date half (D-10's own law: the typed refusal carrying
 * the open action/due-date figures): the close attempt while an open
 * action's window has not elapsed — an undated open action or a
 * future-dated one. */
export class CapaActionsPendingError extends DomainError {
  constructor(details: {
    capaId: string;
    capaNo: string;
    openActionCount: number;
    pendingCount: number;
    pendingDueDates: (string | null)[];
  }) {
    super(
      "CAPA_ACTIONS_PENDING",
      `CAPA ${details.capaNo} cannot close before its actions' due dates pass (BR-103 — ${details.pendingCount} of ${details.openActionCount} open action(s) carry windows that have not elapsed: ${details.pendingDueDates.map((due) => due ?? "no due date declared").join(", ")})`,
      details,
    );
  }
}

/** BR-103's effectiveness half (D-10's second condition: the
 * effectiveness check must be recorded before closure). */
export class CapaEffectivenessRequiredError extends DomainError {
  constructor(details: { capaId: string; capaNo: string }) {
    super(
      "CAPA_EFFECTIVENESS_REQUIRED",
      `CAPA ${details.capaNo} cannot close without its effectiveness check recorded (BR-103 — the check lands with the closure; a closed record with no check is the 0114 floor's own refusal)`,
      details,
    );
  }
}

/** The single-use G-63 stamp (the fold's COST_ALREADY_RECORDED cell —
 * INV-013's sibling discipline: the external cost posts exactly once). */
export class CapaCostAlreadyRecordedError extends DomainError {
  constructor(details: { capaId: string; capaNo: string; journalEntryId: string }) {
    super(
      "CAPA_COST_ALREADY_RECORDED",
      `CAPA ${details.capaNo} already carries its external cost (the G-63 stamp is single-use — journal entry ${details.journalEntryId} owns it)`,
      details,
    );
  }
}

// ── the calibration plane (T-08) ──────────────────────────────────────────────

/** The instrument-asset binding's typed not-found (D-08: the instrument
 * IS an asset on the 049 surfaces — the calibration binds the asset card
 * through the fixed-assets module's own read, the composite FK's service
 * face). */
export class QualityInstrumentNotFoundError extends DomainError {
  constructor(details: { assetId: string }) {
    super(
      "QUALITY_INSTRUMENT_NOT_FOUND",
      `instrument asset ${details.assetId} does not exist in this tenant (the calibration binds the asset card — D-08, the 0115 composite FK's service face)`,
      details,
    );
  }
}

export class CalibrationRecordNotFoundError extends DomainError {
  constructor(details: { calibrationId: string }) {
    super(
      "CALIBRATION_RECORD_NOT_FOUND",
      `calibration record ${details.calibrationId} does not exist in this tenant`,
      details,
    );
  }
}

/** The due-after floor's typed pre-check (0115's own CHECK refused at
 * the service floor BEFORE the DB constraint fires — the refusal names
 * BOTH dates). */
export class CalibrationDueDateInvalidError extends DomainError {
  constructor(details: { calibratedAt: string; dueDate: string }) {
    super(
      "CALIBRATION_DUE_DATE_INVALID",
      `the due date ${details.dueDate} does not follow the calibration act ${details.calibratedAt} (the due date is strictly after the calibration's own UTC day — the 0115 floor; a due date on or before the act day is refused)`,
      details,
    );
  }
}

/** The sweep's settings write refusal (the registry's own zod refusal
 * re-surfaced under the wave's own name — the
 * CmmsSweepThresholdsInvalidError precedent). */
export class CalibrationSweepThresholdsInvalidError extends DomainError {
  constructor(details: { message: string }) {
    super(
      "CALIBRATION_SWEEP_THRESHOLDS_INVALID",
      `the calibration sweep's threshold ladder is invalid: ${details.message} (the registry's own schema refusal re-surfaced — the documented fail-closed default [30,7,0] stands)`,
      details,
    );
  }
}

// ── the SPC plane (T-09 — W-27) ──────────────────────────────────────────────
// The two input floors live beside the pure fold that throws them
// (spc-statistics.ts — the fold's own contract); re-exported here so the
// HTTP face and every consumer imports the taxonomy from one place.

export {
  SpcSubgroupSizeInvalidError,
  SpcInsufficientSamplesError,
} from "./spc-statistics";

// ── the supplier quality score plane (T-10 — W-27) ──────────────────────────

/** The fold's input floor (beside the fold — supplier-score.ts); the
 * service reads make the shape structurally impossible, the fold
 * refuses it BY NAME anyway. */
export { SupplierScoreInputsInvalidError } from "./supplier-score";

/** The recompute target's not-found (the partners module's own row —
 * the feed contract's supplier). */
export class SupplierQualityPartnerNotFoundError extends DomainError {
  constructor(details: { partnerId: string }) {
    super(
      "SUPPLIER_QUALITY_PARTNER_NOT_FOUND",
      `supplier ${details.partnerId} does not exist in this tenant (the quality rolling fold computes one row per supplier per period — the partners module's own row is the target)`,
      details,
    );
  }
}

/** The period shape floor (the rolling fold's calendar-month law). */
export class SupplierScorePeriodInvalidError extends DomainError {
  constructor(details: { periodStart: string }) {
    super(
      "SUPPLIER_SCORE_PERIOD_INVALID",
      `the period start ${details.periodStart} is not a calendar month's first day (the rolling fold computes one row per supplier per calendar month — YYYY-MM-01; the natural key is (tenant, partner, period_start))`,
      details,
    );
  }
}

// ── the COA plane (T-11 — W-27) ──────────────────────────────────────────────

export class CoaDocumentNotFoundError extends DomainError {
  constructor(details: { coaId: string }) {
    super(
      "COA_DOCUMENT_NOT_FOUND",
      `certificate ${details.coaId} does not exist in this tenant`,
      details,
    );
  }
}

/** The batch-item provenance floor: the certificate's batch must belong
 * to the certificate's item (the 0115 composite FK guarantees the
 * batch's existence; the cross-field coherence is this typed floor). */
export class CoaBatchItemMismatchError extends DomainError {
  constructor(details: { batchId: string; itemId: string; batchItemId: string }) {
    super(
      "COA_BATCH_ITEM_MISMATCH",
      `batch ${details.batchId} belongs to item ${details.batchItemId}, not the certificate's item ${details.itemId} (the certificate's provenance must be coherent — the frozen snapshot certifies ONE item)`,
      details,
    );
  }
}

/** The inspection-item provenance floor: the linked inspection must
 * resolve to the certificate's item through the mapping contract's own
 * chain (the FG batch · the production order · the GRN's own lines for
 * a per-line resolution — the W-25 declared shape). */
export class CoaInspectionItemMismatchError extends DomainError {
  constructor(details: { inspectionId: string; itemId: string }) {
    super(
      "COA_INSPECTION_ITEM_MISMATCH",
      `inspection ${details.inspectionId} does not resolve to the certificate's item ${details.itemId} (the mapping contract's own chain — the FG batch, the production order, or the goods receipt's own lines for a per-line resolution)`,
      details,
    );
  }
}

/** The accepted-deviation reference's own floor: the referenced NCR
 * must be this item's and carry the ACCEPT disposition (an open or
 * differently-dispositioned NCR is not an acceptance). */
export class CoaDeviationNcrInvalidError extends DomainError {
  constructor(details: { ncrId: string; ncrNo: string; itemId: string; disposition: string | null }) {
    super(
      "COA_DEVIATION_NCR_INVALID",
      `NCR ${details.ncrNo} is not an accepted deviation for this certificate's item (the reference must carry the ACCEPT disposition on this item — found disposition ${details.disposition ?? "none"} on item ${details.itemId})`,
      details,
    );
  }
}

/** BR-104's OWN typed refusal (the phase doc's wording: blocked unless
 * every parameter is within tolerance or carries an accepted-deviation
 * NCR reference — the refusal naming the parameter and BOTH figures). */
export class CoaGateBlockedError extends DomainError {
  constructor(details: {
    itemId: string;
    firstFailure: { parameter: string; value: string; breachedLimit: string } | null;
    missing: string[];
    foreign: string[];
    duplicates: string[];
  }) {
    const failure =
      details.firstFailure !== null
        ? `parameter "${details.firstFailure.parameter}" measured ${details.firstFailure.value} against the limit ${details.firstFailure.breachedLimit}`
        : details.missing.length > 0
          ? `the active parameters [${details.missing.join(", ")}] carry no measurement`
          : details.foreign.length > 0
            ? `the measured set carries foreign specification ids [${details.foreign.join(", ")}]`
            : `the measured set carries duplicate measurements [${details.duplicates.join(", ")}]`;
    super(
      "COA_GATE_BLOCKED",
      `the certificate is blocked (BR-104 — ${failure}; every parameter must be within tolerance or carry an accepted-deviation NCR reference, and every active parameter must be measured exactly once)`,
      details,
    );
  }
}

/** The empty-register floor: an item with no active specifications
 * carries nothing to certify — the honest refusal, never an empty
 * certificate. */
export class CoaNoSpecificationsError extends DomainError {
  constructor(details: { itemId: string }) {
    super(
      "COA_NO_SPECIFICATIONS",
      `item ${details.itemId} carries no active quality specifications (a certificate certifies the item's parameters — nothing to certify is the honest refusal, never an empty certificate)`,
      details,
    );
  }
}

// ── the holds plane (T-13 — INV-035 + BR-101, the D-07 gate) ─────────────────

/** INV-035's own refusal — THE SHARED BLOCKING VALIDATION SERVICE's typed
 * gate (D-07: one service, the only gate). The refusal names the batch,
 * the hold's reason and the figures (heldAt) so the operator sees the
 * exact freeze they hit; every baseline issue/ship path surfaces it
 * (the 409 conflict face — the document stays where it was, ZERO
 * residue: the gate fires inside planIssue BEFORE any slice is valued
 * or applied). */
export class BatchQualityHoldError extends DomainError {
  constructor(details: {
    batchId: string;
    holdId: string;
    reason: string;
    heldAt: string;
  }) {
    super(
      "BATCH_QUALITY_HELD",
      `batch ${details.batchId} is under an ACTIVE quality hold (${details.reason}, held at ${details.heldAt}) — INV-035: the batch cannot be issued or shipped until the hold is released (BR-101: release requires the disposition-linked record)`,
      details,
    );
  }
}

export class BatchQualityHoldNotFoundError extends DomainError {
  constructor(details: { holdId: string }) {
    super(
      "BATCH_QUALITY_HOLD_NOT_FOUND",
      `batch quality hold ${details.holdId} does not exist in this tenant`,
      details,
    );
  }
}

/** The one-active-per-batch law (0116's partial unique) refused at the
 * service floor — the typed pre-check law; the 23505 never surfaces
 * raw. */
export class BatchHoldAlreadyActiveError extends DomainError {
  constructor(details: { batchId: string; holdId: string }) {
    super(
      "BATCH_HOLD_ALREADY_ACTIVE",
      `batch ${details.batchId} already carries an ACTIVE hold (${details.holdId}) — the one-active-per-batch law (uq_batch_quality_holds_tenant_batch_active); release it before holding the batch again`,
      details,
    );
  }
}

export class BatchQualityHoldStateError extends DomainError {
  constructor(details: { holdId: string; status: string }) {
    super(
      "BATCH_QUALITY_HOLD_STATE",
      `hold ${details.holdId} is ${details.status} — the register is evidence, no move reopens it`,
      details,
    );
  }
}

/** BR-101's own policy refusal: release requires the disposition-linked
 * record (the ncr link + the release note — the justification pair). */
export class HoldReleaseDispositionRequiredError extends DomainError {
  constructor(details: { holdId: string; missing: string }) {
    super(
      "HOLD_RELEASE_DISPOSITION_REQUIRED",
      `BR-101 — hold ${details.holdId} cannot release: ${details.missing} (release requires the disposition-linked record: the ncr whose disposition justifies the release, and the release note)`,
      details,
    );
  }
}

// ── the complaints plane (T-12 — Q-08, the NCR link + the intake) ────────────

export class ComplaintNotFoundError extends DomainError {
  constructor(details: { complaintId: string }) {
    super(
      "COMPLAINT_NOT_FOUND",
      `complaint ${details.complaintId} does not exist in this tenant`,
      details,
    );
  }
}

export class ComplaintStateError extends DomainError {
  constructor(details: { complaintId: string; status: string; reason: string }) {
    super(
      "COMPLAINT_STATE",
      `complaint ${details.complaintId} is ${details.status} — ${details.reason}`,
      details,
    );
  }
}

// ── the recall plane (T-14 — Q-09/Q-12, the drill + the record) ──────────────

export class RecallRecordNotFoundError extends DomainError {
  constructor(details: { recallId: string }) {
    super(
      "RECALL_RECORD_NOT_FOUND",
      `recall record ${details.recallId} does not exist in this tenant`,
      details,
    );
  }
}

export class RecallStateError extends DomainError {
  constructor(details: { recallId: string; status: string; reason: string }) {
    super(
      "RECALL_STATE",
      `recall ${details.recallId} is ${details.status} — ${details.reason}`,
      details,
    );
  }
}

// ── the management review plane (T-16 — Q-10, the frozen indicator pack) ────

export class ManagementReviewNotFoundError extends DomainError {
  constructor(details: { reviewId: string }) {
    super(
      "MANAGEMENT_REVIEW_NOT_FOUND",
      `management review ${details.reviewId} does not exist in this tenant`,
      details,
    );
  }
}

// ── the hazard register plane (T-16 — Q-11, the HACCP register) ─────────────

export class HazardRegisterNotFoundError extends DomainError {
  constructor(details: { hazardId: string }) {
    super(
      "HAZARD_REGISTER_NOT_FOUND",
      `hazard register row ${details.hazardId} does not exist in this tenant`,
      details,
    );
  }
}

/** The (tenant, name) natural key is unique (the 0116 uq) — the typed
 * pre-check law; the 23505 never surfaces raw. */
export class HazardRegisterDuplicateError extends DomainError {
  constructor(details: { name: string }) {
    super(
      "HAZARD_REGISTER_DUPLICATE",
      `a hazard register row already carries the name "${details.name}" (the (tenant, name) key is unique — uq_hazard_registers_tenant_name)`,
      details,
    );
  }
}

/** The register's own state law: a RETIRED (inactive) row is frozen
 * evidence — retiring is the last write it accepts. */
export class HazardRegisterStateError extends DomainError {
  constructor(details: { hazardId: string; name: string }) {
    super(
      "HAZARD_REGISTER_STATE",
      `hazard register row ${details.name} is retired (is_active = false) — the register is evidence, no move rewrites a retired row`,
      details,
    );
  }
}

/** THE HACCP FLOOR (the 0116 ck_hazard_registers_ccp_limit's service
 * face): a critical control point carries its critical limit — the typed
 * pre-check names the missing pair before the DB CHECK fires. */
export class HazardCcpLimitRequiredError extends DomainError {
  constructor(details: { name: string }) {
    super(
      "HAZARD_CCP_LIMIT_REQUIRED",
      `the hazard "${details.name}" is a critical control point (CCP) but carries no critical limit (the HACCP floor — ck_hazard_registers_ccp_limit: a CCP row must carry its critical limit)`,
      details,
    );
  }
}
