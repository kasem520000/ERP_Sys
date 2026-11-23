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
