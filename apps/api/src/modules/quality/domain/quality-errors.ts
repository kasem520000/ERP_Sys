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
