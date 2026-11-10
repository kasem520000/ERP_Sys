import { DomainError } from "@erp/domain-core";

/**
 * Vehicle registry error registry (PHASE-017 §2 item 3; ERROR_MODEL §4:
 * module-scoped codes are contracts). HTTP mapping in the exception
 * filter: 404 not-found, 409 natural-key conflict + lifecycle state,
 * 422 chassis shape (pre-check of the ck_vehicles_chassis_shape VIN
 * regex before the insert ever runs).
 */

export class VehicleNotFoundError extends DomainError {
  constructor(id: string) {
    super("VEHICLE_NOT_FOUND", `vehicle ${id} does not exist in this tenant`);
  }
}

export class VehicleDuplicateChassisError extends DomainError {
  constructor(chassisNo: string) {
    super("VEHICLE_CHASSIS_TAKEN", `chassis number ${chassisNo} is already registered in this tenant`);
  }
}

export class VehicleArchivedError extends DomainError {
  constructor(id: string) {
    super("VEHICLE_ARCHIVED", `vehicle ${id} is archived`);
  }
}

/** Chassis pre-check: VIN shape `[A-HJ-NPR-Z0-9]{6,17}` (no I/O/Q). */
export class VehicleChassisInvalidError extends DomainError {
  constructor(chassisNo: string) {
    super(
      "VEHICLE_CHASSIS_INVALID",
      `chassis number ${chassisNo} must be 6–17 characters of A–H, J–N, P, R–Z and 0–9 (VIN shape, no I/O/Q)`,
    );
  }
}

/** The ck_vehicles_chassis_shape pre-check (kept in one place). */
export const VEHICLE_CHASSIS_PATTERN = /^[A-HJ-NPR-Z0-9]{6,17}$/;
