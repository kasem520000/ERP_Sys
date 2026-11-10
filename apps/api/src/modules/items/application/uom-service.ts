import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/items.store";
import {
  ConversionDuplicateError,
  ConversionNotFoundError,
  SystemUomImmutableError,
  UomCodeTakenError,
  UomNotFoundError,
} from "../domain/items-errors";

/**
 * UoM service (PHASE-006 §2.2/T2): registry reads, tenant extensions, and
 * conversion management. Conversion math is exact-decimal (domain-core
 * `Decimal`) with the compose-exactly property proven by the property
 * test: any resolvable chain multiplies with zero drift at 6-dp — the
 * service is the ONLY legal conversion executor (BR: no app code converts
 * units ad hoc).
 */

@Injectable()
export class UomService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(): Promise<store.UomRow[]> {
    return store.listUoms();
  }

  async get(id: string): Promise<store.UomRow> {
    const uom = await store.findUomById(id);
    if (uom === undefined) {
      throw new UomNotFoundError(id);
    }
    return uom;
  }

  async create(
    actorId: string,
    input: { code: string; name: string; nameAr: string | null },
  ): Promise<store.UomRow> {
    const existing = await store.findUomByCode(input.code);
    if (existing !== undefined) {
      throw new UomCodeTakenError(input.code);
    }
    const uom = await store.insertUom(input);
    await this.audit.record({
      action: "uom.created",
      entityType: "uom",
      entityId: uom.id,
      actorId,
      after: { code: uom.code, name: uom.name },
    });
    return uom;
  }

  /** System seed rows are read-only (migration comment contract). */
  async update(
    actorId: string,
    id: string,
    patch: { name?: string; nameAr?: string | null; isActive?: boolean },
  ): Promise<store.UomRow> {
    const before = await store.findUomById(id);
    if (before === undefined) {
      throw new UomNotFoundError(id);
    }
    if (before.isSystem && patch.isActive === false) {
      throw new SystemUomImmutableError(before.code);
    }
    const updated = await store.updateUom(id, patch);
    if (updated === undefined) {
      throw new UomNotFoundError(id);
    }
    await this.audit.record({
      action: "uom.updated",
      entityType: "uom",
      entityId: id,
      actorId,
      before: { name: before.name, is_active: before.isActive },
      after: { name: updated.name, is_active: updated.isActive },
    });
    return updated;
  }

  async listConversions(): Promise<store.UomConversionRow[]> {
    return store.listUomConversions();
  }

  async addConversion(
    actorId: string,
    input: { fromUomId: string; toUomId: string; factor: string },
  ): Promise<store.UomConversionRow> {
    if (input.fromUomId === input.toUomId) {
      throw new ConversionDuplicateError(input.fromUomId, input.toUomId);
    }
    for (const uomId of [input.fromUomId, input.toUomId]) {
      const uom = await store.findUomById(uomId);
      if (uom === undefined) {
        throw new UomNotFoundError(uomId);
      }
    }
    const direct = await store.findUomConversion(input.fromUomId, input.toUomId);
    if (direct !== undefined) {
      throw new ConversionDuplicateError(input.fromUomId, input.toUomId);
    }
    if (Number(input.factor) <= 0) {
      throw new ConversionDuplicateError(input.fromUomId, input.toUomId);
    }
    const row = await store.insertUomConversion(input);
    await this.audit.record({
      action: "uom.conversion_added",
      entityType: "uom_conversion",
      entityId: row.id,
      actorId,
      after: { from: row.fromUomId, to: row.toUomId, factor: row.factor },
    });
    return row;
  }

  /**
   * Resolve an exact conversion factor (direct or shortest chain), or
   * throw when no path exists. Returns the composed factor as a decimal
   * string — property tests prove chains compose with zero 6-dp drift.
   */
  async resolveFactor(fromUomId: string, toUomId: string): Promise<string> {
    if (fromUomId === toUomId) {
      return "1";
    }
    const conversions = await store.listUomConversions();
    // BFS: shortest chain first (fewest multiplications = least drift risk).
    const edges = new Map<string, { to: string; factor: string }[]>();
    for (const row of conversions) {
      const list = edges.get(row.fromUomId) ?? [];
      list.push({ to: row.toUomId, factor: row.factor });
      edges.set(row.fromUomId, list);
    }
    const queue: { uomId: string; factor: Decimal }[] = [
      { uomId: fromUomId, factor: new Decimal("1") },
    ];
    const visited = new Set<string>([fromUomId]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges.get(current.uomId) ?? []) {
        const composed = current.factor.times(new Decimal(edge.factor));
        if (edge.to === toUomId) {
          return composed.toString();
        }
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push({ uomId: edge.to, factor: composed });
        }
      }
    }
    throw new ConversionNotFoundError(fromUomId, toUomId);
  }
}
