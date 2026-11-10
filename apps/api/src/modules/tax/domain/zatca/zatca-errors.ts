import { DomainError } from "@erp/domain-core";

/**
 * PHASE-037 · ZATCA Phase-1 domain errors. Codes are stable API contracts
 * (ERROR_MODEL §4); every guard here FAILS CLOSED — a compliance path
 * never degrades silently into an uncompliant document.
 */

/** The device row does not exist (A7-shaped: unknown vs foreign identical). */
export class ZatcaDeviceNotFoundError extends DomainError {
  constructor(id: string) {
    super("ZATCA_DEVICE_NOT_FOUND", `ZATCA device ${id} does not exist in this tenant`);
  }
}

/** INV-027: the chain walk broke (gap, tampered total/hash, or unknown digest version). */
export class ZatcaChainBrokenError extends DomainError {
  constructor(details: {
    deviceId: string;
    atIcv: number | null;
    reason: string;
    failures: readonly { icv: number | null; invoiceId: string; reason: string }[];
  }) {
    super(
      "ZATCA_CHAIN_BROKEN",
      `ZATCA chain verification failed on device ${details.deviceId} at ICV ${String(details.atIcv)}: ${details.reason}`,
      details,
    );
  }
}

/**
 * BR-060 (fail-closed): a KSA-VAT tenant cannot issue (post) or print a
 * SIMPLIFIED invoice without a QR payload. Zero residue — the guard runs
 * before any write/print side effect.
 */
export class ZatcaQrPayloadRequiredError extends DomainError {
  constructor(details: { invoiceId: string; surface: "post" | "print"; classification: string }) {
    super(
      "ZATCA_QR_PAYLOAD_REQUIRED",
      `BR-060: a ${details.classification} invoice (${details.invoiceId}) cannot be ${details.surface === "post" ? "issued" : "printed"} without a ZATCA QR payload — the KSA-VAT fail-closed guard rejected the operation`,
      details,
    );
  }
}

/**
 * BR-061 (honest vocabulary): the Phase-2 surface (clearance/reporting,
 * CSID lifecycle, UBL 2.1, XAdES) is explicitly NOT IMPLEMENTED — any
 * attempt to reach it gets this typed rejection, never a fake success.
 */
export class ZatcaPhase2NotImplementedError extends DomainError {
  constructor(operation: string) {
    super(
      "ZATCA_PHASE2_NOT_IMPLEMENTED",
      `${operation} is ZATCA Phase-2 (clearance/reporting) and is NOT IMPLEMENTED — staged for PHASE-054 (CSID + UBL 2.1 + XAdES); Phase-1 generation does not claim it (BR-061)`,
      { operation, phase: "054" },
    );
  }
}

/** The classification value is not the documented enum. */
export class ZatcaClassificationInvalidError extends DomainError {
  constructor(classification: string) {
    super(
      "ZATCA_CLASSIFICATION_INVALID",
      `invoice classification "${classification}" is not one of STANDARD|SIMPLIFIED`,
      { classification },
    );
  }
}

/** The backfill found an invoice it cannot stamp (missing posted_at, etc.). */
export class ZatcaBackfillStateError extends DomainError {
  constructor(message: string) {
    super("ZATCA_BACKFILL_STATE_INVALID", message);
  }
}
