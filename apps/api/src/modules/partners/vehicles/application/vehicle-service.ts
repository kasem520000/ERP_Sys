import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../../audit/api/audit";
import { PartnerNotFoundError } from "../../domain/partner-errors";
import { findPartnerById } from "../../infrastructure/partners.store";
import * as store from "../../infrastructure/vehicles.store";
import {
  VEHICLE_CHASSIS_PATTERN,
  VehicleArchivedError,
  VehicleChassisInvalidError,
  VehicleDuplicateChassisError,
  VehicleNotFoundError,
} from "../domain/vehicle-errors";

/**
 * Vehicle registry application service (PHASE-017 §2 item 3): per-partner
 * vehicle records (make/model/chassis/plate/odometer) behind the
 * `partners.vehicles.manage` matrix key, with chassis uniqueness
 * (pre-check + the 23505 race backstop), ACTIVE-only updates, an
 * idempotent-error archive (re-archiving is a conflict, never a second
 * write), and the per-vehicle service-history read model. Every mutation
 * is audited (bilingual note/noteAr ride on the row; audit payloads stay
 * snake_case like the rest of the module).
 */

/** 23505 = unique_violation (PostgreSQL SQLSTATE); unwraps driver causes. */
function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate !== null && candidate !== undefined; depth += 1) {
    if (typeof candidate === "object" && (candidate as { code?: string }).code === "23505") {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

export interface CreateVehicleInput {
  partnerId: string;
  make: string;
  model: string;
  modelYear: number | null;
  chassisNo: string | null;
  plateNo: string | null;
  color: string | null;
  engineNo: string | null;
  odometerKm: string | null;
  odometerAt: string | null;
  note: string | null;
  noteAr: string | null;
}

export interface UpdateVehiclePatch {
  make?: string;
  model?: string;
  modelYear?: number | null;
  chassisNo?: string | null;
  plateNo?: string | null;
  color?: string | null;
  engineNo?: string | null;
  odometerKm?: string | null;
  odometerAt?: string | null;
  note?: string | null;
  noteAr?: string | null;
  version?: number;
}

@Injectable()
export class VehicleService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(
    filter: store.VehicleListFilter,
    limit: number,
  ): Promise<store.VehicleRow[]> {
    return store.listVehicles(filter, limit);
  }

  async get(vehicleId: string): Promise<store.VehicleRow> {
    const vehicle = await store.findVehicleById(vehicleId);
    if (vehicle === undefined) {
      throw new VehicleNotFoundError(vehicleId);
    }
    return vehicle;
  }

  async create(actorId: string, input: CreateVehicleInput): Promise<store.VehicleRow> {
    // The owning partner must exist and not be soft-deleted (the partner
    // module's own not-found contract — reused verbatim).
    const partner = await findPartnerById(input.partnerId);
    if (partner === undefined || partner.deletedAt !== null) {
      throw new PartnerNotFoundError(input.partnerId);
    }
    if (input.chassisNo !== null) {
      if (!VEHICLE_CHASSIS_PATTERN.test(input.chassisNo)) {
        throw new VehicleChassisInvalidError(input.chassisNo);
      }
      const existing = await store.findVehicleByChassis(input.chassisNo);
      if (existing !== undefined) {
        throw new VehicleDuplicateChassisError(input.chassisNo);
      }
    }
    let vehicle: store.VehicleRow;
    try {
      vehicle = await store.insertVehicle({ ...input, createdBy: actorId });
    } catch (error) {
      // Race backstop: a concurrent insert between the pre-check and the
      // INSERT trips uq_vehicles_tenant_chassis (23505).
      if (input.chassisNo !== null && isUniqueViolation(error)) {
        throw new VehicleDuplicateChassisError(input.chassisNo);
      }
      throw error;
    }
    await this.audit.record({
      action: "partners.vehicle_created",
      entityType: "vehicle",
      entityId: vehicle.id,
      actorId,
      after: {
        partner_id: vehicle.partnerId,
        make: vehicle.make,
        model: vehicle.model,
        chassis_no: vehicle.chassisNo,
        plate_no: vehicle.plateNo,
        status: vehicle.status,
      },
    });
    return vehicle;
  }

  /** ACTIVE vehicles only — archived rows are read-only history. */
  async update(actorId: string, vehicleId: string, patch: UpdateVehiclePatch): Promise<store.VehicleRow> {
    const before = await store.findVehicleById(vehicleId);
    if (before === undefined) {
      throw new VehicleNotFoundError(vehicleId);
    }
    if (before.status !== "ACTIVE") {
      throw new VehicleArchivedError(vehicleId);
    }
    if (patch.chassisNo !== undefined && patch.chassisNo !== null) {
      if (!VEHICLE_CHASSIS_PATTERN.test(patch.chassisNo)) {
        throw new VehicleChassisInvalidError(patch.chassisNo);
      }
      const existing = await store.findVehicleByChassis(patch.chassisNo);
      // Re-setting the vehicle's own chassis is a no-op, not a conflict.
      if (existing !== undefined && existing.id !== vehicleId) {
        throw new VehicleDuplicateChassisError(patch.chassisNo);
      }
    }
    let row: store.VehicleRow | undefined;
    try {
      row = await store.updateVehicle(vehicleId, patch);
    } catch (error) {
      if (patch.chassisNo !== undefined && patch.chassisNo !== null && isUniqueViolation(error)) {
        throw new VehicleDuplicateChassisError(patch.chassisNo);
      }
      throw error;
    }
    if (row === undefined) {
      throw new VehicleNotFoundError(vehicleId);
    }
    const updated = row;
    await this.audit.record({
      action: "partners.vehicle_updated",
      entityType: "vehicle",
      entityId: vehicleId,
      actorId,
      before: {
        make: before.make,
        model: before.model,
        chassis_no: before.chassisNo,
        plate_no: before.plateNo,
        odometer_km: before.odometerKm,
        status: before.status,
      },
      after: {
        make: updated.make,
        model: updated.model,
        chassis_no: updated.chassisNo,
        plate_no: updated.plateNo,
        odometer_km: updated.odometerKm,
        status: updated.status,
      },
    });
    return updated;
  }

  /** Archive is a conflict the second time (idempotent-error), never a
   * delete — registry rows stay for history + FK references. */
  async archive(actorId: string, vehicleId: string): Promise<store.VehicleRow> {
    const before = await store.findVehicleById(vehicleId);
    if (before === undefined) {
      throw new VehicleNotFoundError(vehicleId);
    }
    if (before.status !== "ACTIVE") {
      throw new VehicleArchivedError(vehicleId);
    }
    const archived = await store.archiveVehicle(vehicleId);
    if (archived === undefined) {
      // Lost a race with a concurrent archive (or the row vanished —
      // impossible by grants); both are stated honestly.
      const reread = await store.findVehicleById(vehicleId);
      if (reread?.status === "ARCHIVED") {
        throw new VehicleArchivedError(vehicleId);
      }
      throw new VehicleNotFoundError(vehicleId);
    }
    await this.audit.record({
      action: "partners.vehicle_archived",
      entityType: "vehicle",
      entityId: vehicleId,
      actorId,
      before: { status: before.status },
      after: { status: archived.status },
    });
    return archived;
  }

  /** Per-vehicle timeline (job cards + invoices + warranty credit notes). */
  async serviceHistory(vehicleId: string): Promise<store.VehicleServiceHistoryEntry[]> {
    await this.get(vehicleId);
    return store.findVehicleServiceHistory(vehicleId);
  }
}
