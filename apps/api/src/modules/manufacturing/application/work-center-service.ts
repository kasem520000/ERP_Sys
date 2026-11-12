import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/manufacturing.store";
import type { WorkCenterRow } from "../infrastructure/manufacturing.store";
import {
  WorkCenterCodeConflictError,
  WorkCenterInUseError,
  WorkCenterInputInvalidError,
  WorkCenterNotFoundError,
} from "../domain/manufacturing-errors";

/**
 * Work-center service (PHASE-042 M-03/H-04): the shop-floor capacity + rate
 * master data — per-shift capacity in HOURS, shifts per day, fixed/var cost
 * rates per hour in base currency, the status lifecycle, and the
 * cost-center analytics link. Master data only: the service NEVER posts a
 * journal and never touches stock; the rates feed the release-time freeze
 * (OperationExecutionService) and the downtime cost estimate
 * (DowntimeService) — both snapshot what they need, later rate edits never
 * move a live order (the BOM version-bind discipline).
 *
 * setStatus("INACTIVE") is a guarded deactivation: blocked while the center
 * is referenced by an ACTIVE routing's operations (master-data dependency)
 * or by live (PENDING/SETUP/RUNNING/PAUSED) frozen operation rows — the
 * shop floor must not lose its cost basis mid-flight. Validation mirrors the
 * 0065 CHECK floors at the service layer (code shape, capacity (0, 24],
 * shifts 1..6, rates ≥ 0) so the typed 422 arrives before any SQL.
 */

const CODE_RE = /^[A-Za-z][A-Za-z0-9_-]{1,39}$/;
const RATE_RE = /^\d+(\.\d{1,6})?$/;
const CAPACITY_RE = /^\d+(\.\d{1,2})?$/;

export interface CreateWorkCenterInput {
  code: string;
  name: string;
  nameAr?: string | null;
  description?: string | null;
  capacityPerShift: string;
  shiftsPerDay: number;
  fixedCostRate?: string | null;
  varCostRate?: string | null;
  costCenterId?: string | null;
  actorId: string | null;
}

export interface UpdateWorkCenterInput {
  name?: string;
  nameAr?: string | null;
  description?: string | null;
  capacityPerShift?: string;
  shiftsPerDay?: number;
  fixedCostRate?: string | null;
  varCostRate?: string | null;
  costCenterId?: string | null;
  actorId: string | null;
}

/** 23505 = unique_violation; unwraps driver causes (the bom-service helper). */
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

@Injectable()
export class WorkCenterService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // -- reads -------------------------------------------------------------------

  async list(filter: { status?: string; limit: number }): Promise<WorkCenterRow[]> {
    return store.listWorkCenters(filter);
  }

  async find(id: string): Promise<WorkCenterRow> {
    const workCenter = await store.findWorkCenterById(id);
    if (workCenter === undefined) throw new WorkCenterNotFoundError(id);
    return workCenter;
  }

  // -- create ------------------------------------------------------------------

  async create(input: CreateWorkCenterInput): Promise<WorkCenterRow> {
    const code = input.code.trim();
    if (!CODE_RE.test(code)) {
      throw new WorkCenterInputInvalidError(
        `work center code must match ^[A-Za-z][A-Za-z0-9_-]{1,39}$ — got ${input.code}`,
      );
    }
    const name = (input.name ?? "").trim();
    if (name === "" || name.length > 200) {
      throw new WorkCenterInputInvalidError(`work center name must be 1..200 chars — got ${name.length}`);
    }
    const capacityPerShift = this.canonicalCapacity(input.capacityPerShift);
    const shiftsPerDay = this.canonicalShifts(input.shiftsPerDay);
    const fixedCostRate = this.canonicalRate(input.fixedCostRate ?? "0", "fixedCostRate");
    const varCostRate = this.canonicalRate(input.varCostRate ?? "0", "varCostRate");
    let created: WorkCenterRow;
    try {
      created = await store.insertWorkCenter({
        code,
        name,
        nameAr: input.nameAr ?? null,
        description: input.description ?? null,
        capacityPerShift,
        shiftsPerDay,
        fixedCostRate,
        varCostRate,
        costCenterId: input.costCenterId ?? null,
        actorId: input.actorId,
      });
    } catch (error) {
      // uq_work_centers_tenant_code — a concurrent create or a duplicate code.
      if (isUniqueViolation(error)) throw new WorkCenterCodeConflictError(code);
      throw error;
    }
    await this.audit.record({
      action: "manufacturing.work_center.created",
      entityType: "work_center",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { code, capacityPerShift, shiftsPerDay, fixedCostRate, varCostRate, status: "ACTIVE" },
    });
    return created;
  }

  // -- update (full edit; status rides setStatus) --------------------------------

  async update(id: string, input: UpdateWorkCenterInput): Promise<WorkCenterRow> {
    await this.find(id);
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name === "" || name.length > 200) {
        throw new WorkCenterInputInvalidError(`work center name must be 1..200 chars — got ${name.length}`);
      }
    }
    const capacityPerShift =
      input.capacityPerShift !== undefined ? this.canonicalCapacity(input.capacityPerShift) : undefined;
    const shiftsPerDay = input.shiftsPerDay !== undefined ? this.canonicalShifts(input.shiftsPerDay) : undefined;
    // Absent rate = keep; null rate = reset to the 0 default (the NOT NULL
    // DEFAULT 0 columns — clearing means zeroing).
    const fixedCostRate =
      input.fixedCostRate === undefined ? undefined : this.canonicalRate(input.fixedCostRate ?? "0", "fixedCostRate");
    const varCostRate =
      input.varCostRate === undefined ? undefined : this.canonicalRate(input.varCostRate ?? "0", "varCostRate");
    await store.patchWorkCenter({
      id,
      name: input.name?.trim(),
      nameAr: input.nameAr,
      description: input.description,
      capacityPerShift,
      shiftsPerDay,
      fixedCostRate,
      varCostRate,
      costCenterId: input.costCenterId,
    });
    await this.audit.record({
      action: "manufacturing.work_center.updated",
      entityType: "work_center",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { fields: Object.keys(input).filter((key) => key !== "actorId") },
    });
    return this.find(id);
  }

  // -- setStatus (ACTIVE ↔ INACTIVE; INACTIVE guarded) ----------------------------

  async setStatus(id: string, status: "ACTIVE" | "INACTIVE", actorId: string | null): Promise<WorkCenterRow> {
    const workCenter = await this.find(id);
    if (workCenter.status === status) return workCenter; // idempotent no-op
    if (status === "INACTIVE") {
      const activeRoutingOperations = await store.countActiveRoutingOperationsByWorkCenter(id);
      const liveOperations = await store.countLiveOperationsByWorkCenter(id);
      if (activeRoutingOperations > 0 || liveOperations > 0) {
        throw new WorkCenterInUseError({ workCenterId: id, activeRoutingOperations, liveOperations });
      }
    }
    await store.patchWorkCenter({ id, status });
    await this.audit.record({
      action: "manufacturing.work_center.status_changed",
      entityType: "work_center",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: workCenter.status },
      after: { status, code: workCenter.code },
    });
    return this.find(id);
  }

  // -- validation helpers ---------------------------------------------------------

  /** numeric(7,2) hours per shift: 0 < capacity ≤ 24. */
  private canonicalCapacity(raw: string): string {
    if (!CAPACITY_RE.test(raw)) {
      throw new WorkCenterInputInvalidError(`capacityPerShift must be a decimal (≤ 2dp): ${raw}`);
    }
    const value = new Decimal(raw);
    if (value.lessThanOrEqualTo(0) || value.greaterThan(24)) {
      throw new WorkCenterInputInvalidError(`capacityPerShift must be 0 < capacity ≤ 24 hours — got ${raw}`);
    }
    return value.toFixed(2);
  }

  private canonicalShifts(raw: number): number {
    if (!Number.isInteger(raw) || raw < 1 || raw > 6) {
      throw new WorkCenterInputInvalidError(`shiftsPerDay must be an integer 1..6 — got ${raw}`);
    }
    return raw;
  }

  /** numeric(19,6) base-currency per hour: ≥ 0. */
  private canonicalRate(raw: string, what: string): string {
    if (!RATE_RE.test(raw)) {
      throw new WorkCenterInputInvalidError(`${what} must be a non-negative decimal (≤ 6dp): ${raw}`);
    }
    return new Decimal(raw).toFixed(6);
  }
}
