import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";

import {
  HazardCcpLimitRequiredError,
  HazardRegisterDuplicateError,
  HazardRegisterNotFoundError,
  HazardRegisterStateError,
  QualityInputInvalidError,
} from "../domain/quality-errors";
import * as store from "../infrastructure/quality.store";

/**
 * PHASE-050 (W-30 — T-16, 2026-11-23) THE HAZARD REGISTERS SERVICE —
 * Q-11 (D-15): the HACCP register's own surface (create/list/find/update).
 * THE TENANT OWNS THE STRUCTURE: the hazards, the CCP flags, the critical
 * limits, the monitoring and the corrective actions are the tenant's own
 * master data — the food-manufacturing template COMPOSES the surface
 * (the `quality` feature flag, never a hardcoded checklist; the 0116
 * table comment's own law). THE HACCP FLOOR is the 0116 CHECK's service
 * face: a CCP row carries its critical limit (the typed pre-check names
 * the missing pair before the DB floor fires). The register's own state
 * law: a RETIRED (inactive) row is frozen evidence — retiring is the
 * last write it accepts (the CAS pins is_active = true).
 */

/** The 0116 category vocabulary (ck_hazard_registers_category's domain). */
export const HAZARD_CATEGORIES = [
  "BIOLOGICAL",
  "CHEMICAL",
  "PHYSICAL",
  "ALLERGEN",
] as const;

function requireUuid(value: string, what: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new QualityInputInvalidError({ field: what, reason: "a uuid is required" });
  }
  return value;
}

export interface CreateHazardInput {
  name: string;
  nameAr?: string | null;
  hazard: string;
  hazardAr?: string | null;
  category: string;
  processStep?: string | null;
  itemId?: string | null;
  isCcp?: boolean;
  criticalLimit?: string | null;
  criticalLimitAr?: string | null;
  monitoringProcedure?: string | null;
  correctiveAction?: string | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

export interface UpdateHazardInput {
  hazardId: string;
  hazard?: string;
  hazardAr?: string | null;
  processStep?: string | null;
  itemId?: string | null;
  isCcp?: boolean;
  criticalLimit?: string | null;
  criticalLimitAr?: string | null;
  monitoringProcedure?: string | null;
  correctiveAction?: string | null;
  isActive?: boolean;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

@Injectable()
export class HazardRegistersService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async create(input: CreateHazardInput): Promise<store.HazardRegisterRow> {
    if (input.name.trim().length === 0 || input.name.length > 200) {
      throw new QualityInputInvalidError({
        field: "name",
        reason: "the hazard register name is required (1…200 chars — the (tenant, name) key's own shape)",
      });
    }
    if (input.hazard.trim().length === 0 || input.hazard.length > 2000) {
      throw new QualityInputInvalidError({
        field: "hazard",
        reason: "the hazard description is required (1…2000 chars)",
      });
    }
    if (!(HAZARD_CATEGORIES as readonly string[]).includes(input.category)) {
      throw new QualityInputInvalidError({
        field: "category",
        reason: `category must be one of ${HAZARD_CATEGORIES.join("/")}: ${input.category}`,
      });
    }
    const isCcp = input.isCcp ?? false;
    const criticalLimit = input.criticalLimit?.trim() ? input.criticalLimit : null;
    // THE HACCP FLOOR (the 0116 CHECK's typed pre-check): a CCP carries
    // its critical limit.
    if (isCcp && criticalLimit === null) {
      throw new HazardCcpLimitRequiredError({ name: input.name });
    }
    let itemId: string | null = null;
    if (input.itemId != null && input.itemId !== "") {
      itemId = requireUuid(input.itemId, "itemId");
    }
    // The (tenant, name) natural key's typed pre-check (the 23505 never
    // surfaces raw — the QualitySpecificationDuplicateError precedent).
    if ((await store.findHazardRegisterByName(input.name)) !== undefined) {
      throw new HazardRegisterDuplicateError({ name: input.name });
    }
    const row = await store.insertHazardRegister({
      name: input.name,
      nameAr: input.nameAr ?? null,
      hazard: input.hazard,
      hazardAr: input.hazardAr ?? null,
      category: input.category,
      processStep: input.processStep ?? null,
      itemId,
      isCcp,
      criticalLimit,
      criticalLimitAr: input.criticalLimitAr ?? null,
      monitoringProcedure: input.monitoringProcedure ?? null,
      correctiveAction: input.correctiveAction ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "quality.hazard_register_created",
      entityType: "hazard_register",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { name: row.name, category: row.category, isCcp: row.isCcp },
    });
    return row;
  }

  async list(filter: {
    itemId?: string;
    category?: string;
    activeOnly?: boolean;
    limit?: number;
  } = {}): Promise<store.HazardRegisterRow[]> {
    return store.listHazardRegisters({
      itemId: filter.itemId,
      category: filter.category,
      activeOnly: filter.activeOnly,
      limit: filter.limit ?? 200,
    });
  }

  async find(id: string): Promise<store.HazardRegisterRow> {
    const row = await store.findHazardRegisterById(requireUuid(id, "id"));
    if (row === undefined) throw new HazardRegisterNotFoundError({ hazardId: id });
    return row;
  }

  /** The PATCH act: the descriptive fields merge (an explicit null
   * CLEARS), the CCP coherence re-checked against the MERGED pair at
   * this floor, the state CAS beneath pinning the ACTIVE row (a retired
   * row is frozen evidence). */
  async update(input: UpdateHazardInput): Promise<store.HazardRegisterRow> {
    const current = await this.find(input.hazardId);
    if (input.hazard !== undefined && (input.hazard.trim().length === 0 || input.hazard.length > 2000)) {
      throw new QualityInputInvalidError({
        field: "hazard",
        reason: "the hazard description is required (1…2000 chars)",
      });
    }
    const nextIsCcp = input.isCcp ?? current.isCcp;
    const nextCriticalLimit =
      input.criticalLimit === undefined
        ? current.criticalLimit
        : (input.criticalLimit ?? "").trim().length > 0
          ? input.criticalLimit
          : null;
    // THE HACCP FLOOR over the MERGED pair (a CCP-promoting patch must
    // carry — or keep — its critical limit).
    if (nextIsCcp && nextCriticalLimit === null) {
      throw new HazardCcpLimitRequiredError({ name: current.name });
    }
    if (input.itemId != null && input.itemId !== "") {
      requireUuid(input.itemId, "itemId");
    }
    const row = await store.updateHazardRegister({
      id: input.hazardId,
      hazard: input.hazard,
      hazardAr: input.hazardAr,
      processStep: input.processStep,
      itemId: input.itemId === "" ? null : input.itemId,
      isCcp: input.isCcp,
      criticalLimit: input.criticalLimit === undefined ? undefined : nextCriticalLimit,
      criticalLimitAr: input.criticalLimitAr,
      monitoringProcedure: input.monitoringProcedure,
      correctiveAction: input.correctiveAction,
      isActive: input.isActive,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    if (row === undefined) {
      throw new HazardRegisterStateError({
        hazardId: input.hazardId,
        name: current.name,
      });
    }
    await this.audit.record({
      action: "quality.hazard_register_updated",
      entityType: "hazard_register",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { name: row.name, isCcp: row.isCcp, isActive: row.isActive },
    });
    return row;
  }
}
