import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  ImportMappingConflictError,
  ImportMappingInvalidError,
  ImportMappingNotFoundError,
} from "../domain/onboarding-errors";
import { isImportKind, KIND_SPECS } from "./kinds";
import * as store from "../infrastructure/onboarding.store";

/**
 * PHASE-040 saved-mapping service (§2.3): tenant-scoped named column maps
 * reusable across files (IMPORT direction — acceptance 4: a mapping created
 * for one file is reused on a second file of the same shape with zero
 * re-mapping) + the v3.1/CR-46 EXPORT templates (entity, column selection,
 * format, filters — the recurring-extract shapes; the export runtime itself
 * rides the existing exporters, the mapping persists the shape).
 */

export interface CreateMappingInput {
  name: string;
  direction: "IMPORT" | "EXPORT";
  kind: string;
  entity: string | null;
  columnMap: Record<string, unknown>;
  options?: Record<string, unknown> | null;
}

@Injectable()
export class MappingsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(direction: string | undefined, kind: string | undefined) {
    return store.listImportMappings(direction, kind);
  }

  async create(actorId: string, input: CreateMappingInput): Promise<store.ImportMappingRow> {
    this.assertShape(input);
    const existing = await store.findImportMappingByName(input.direction, input.kind, input.name);
    if (existing !== undefined) {
      throw new ImportMappingConflictError(input.name, input.kind);
    }
    const row = await store.insertImportMapping({
      name: input.name,
      direction: input.direction,
      kind: input.kind,
      entity: input.entity,
      columnMap: input.columnMap,
      options: input.options ?? null,
      createdBy: actorId,
    });
    await this.audit.record({
      action: "onboarding.import_mapping_created",
      entityType: "import_mapping",
      entityId: row.id,
      actorId,
      after: { name: row.name, direction: row.direction, kind: row.kind },
    });
    return row;
  }

  async update(
    actorId: string,
    id: string,
    patch: { name?: string; columnMap?: Record<string, unknown>; options?: Record<string, unknown> | null },
  ): Promise<store.ImportMappingRow> {
    const before = await store.findImportMappingById(id);
    if (before === undefined) {
      throw new ImportMappingNotFoundError(id);
    }
    if (patch.name !== undefined && patch.name !== before.name) {
      const clash = await store.findImportMappingByName(before.direction, before.kind, patch.name);
      if (clash !== undefined) {
        throw new ImportMappingConflictError(patch.name, before.kind);
      }
    }
    if (patch.columnMap !== undefined) {
      this.assertShape({
        name: before.name,
        direction: before.direction,
        kind: before.kind,
        entity: before.entity,
        columnMap: patch.columnMap,
      });
    }
    const updated = await store.updateImportMapping(id, patch);
    if (updated === undefined) {
      throw new ImportMappingNotFoundError(id);
    }
    await this.audit.record({
      action: "onboarding.import_mapping_updated",
      entityType: "import_mapping",
      entityId: id,
      actorId,
      before: { name: before.name },
      after: { name: updated.name },
    });
    return updated;
  }

  async remove(actorId: string, id: string): Promise<void> {
    const before = await store.findImportMappingById(id);
    if (before === undefined) {
      throw new ImportMappingNotFoundError(id);
    }
    await store.deleteImportMapping(id);
    await this.audit.record({
      action: "onboarding.import_mapping_deleted",
      entityType: "import_mapping",
      entityId: id,
      actorId,
      before: { name: before.name, direction: before.direction, kind: before.kind },
    });
  }

  /** Direction-aware shape validation (the DB CHECKs are the floor). */
  private assertShape(input: CreateMappingInput): void {
    if (input.name.trim().length < 1 || input.name.length > 100) {
      throw new ImportMappingInvalidError("mapping name must be 1–100 chars");
    }
    if (input.direction === "IMPORT") {
      if (!isImportKind(input.kind)) {
        throw new ImportMappingInvalidError(
          `unknown import kind ${input.kind} (the seven PHASE-040 kinds)`,
        );
      }
      if (input.entity !== null) {
        throw new ImportMappingInvalidError("import mappings carry no entity (EXPORT only)");
      }
      const spec = KIND_SPECS[input.kind];
      const known = new Set(spec.columns.map((column) => column.name));
      const keys = Object.keys(input.columnMap);
      if (keys.length === 0) {
        throw new ImportMappingInvalidError("the column map is empty");
      }
      for (const key of keys) {
        if (!known.has(key)) {
          throw new ImportMappingInvalidError(
            `unknown canonical column "${key}" for kind ${input.kind}`,
          );
        }
      }
      for (const required of spec.columns.filter((column) => column.required)) {
        if (!(required.name in input.columnMap)) {
          throw new ImportMappingInvalidError(
            `the column map must place the required column "${required.name}"`,
          );
        }
      }
      return;
    }
    // EXPORT: kind doubles as the entity key (shape-checked by the DB CHECK
    // and normalized lower); the columnMap is the column selection.
    if (input.entity === null || input.entity === "") {
      throw new ImportMappingInvalidError("export templates name their entity");
    }
    if (Object.keys(input.columnMap).length === 0) {
      throw new ImportMappingInvalidError("the column selection is empty");
    }
  }
}
