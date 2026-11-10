import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { findAccountById } from "../../accounting/infrastructure/accounting.store";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import {
  ComponentAccountNotFoundError,
  PayrollCodeConflictError,
  StructureInUseError,
  StructureNotFoundError,
} from "../domain/payroll-errors";
import * as store from "../infrastructure/payroll.store";
import type { ComponentRow, StructureRow } from "../infrastructure/payroll.store";

/**
 * Salary structure service (PHASE-029 T3 — BR-052): structures + their
 * component lists. The versioning law: a structure that ANY run has
 * snapshotted is FROZEN — edits create a NEW version (predecessor →
 * ARCHIVED pointing at the successor, components copied + edited). Unused
 * structures edit in place (components replaceable while no run references
 * the structure).
 *
 * Every component carries its own gl_account_id (validated postable,
 * foreign ids die typed 404 — S-04) and the is_eos_base flag.
 */

@Injectable()
export class StructureService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(limit?: number): Promise<StructureRow[]> {
    return store.listStructures(Math.min(limit ?? 200, 500));
  }

  async get(id: string): Promise<{ structure: StructureRow; components: ComponentRow[] }> {
    const structure = await store.findStructureById(id);
    if (structure === undefined) throw new StructureNotFoundError(id);
    return { structure, components: await store.listComponents(id) };
  }

  async create(input: {
    code: string;
    name: string;
    nameAr?: string | null;
    currency?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<StructureRow> {
    if ((await store.findStructureByCode(input.code)) !== undefined) {
      throw new PayrollCodeConflictError({ entity: "salary structure", code: input.code });
    }
    const base = await ownTenantBaseCurrency();
    const created = await store.insertStructure({
      code: input.code,
      name: input.name,
      nameAr: input.nameAr ?? null,
      currency: input.currency ?? base,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "payroll.structure_created",
      entityType: "salary_structure",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { code: created.code, currency: created.currency },
    });
    return created;
  }

  /**
   * Replace the component list (the builder's save). BR-052: refused when
   * any run has snapshotted the structure (version it instead — see
   * createVersion). Foreign/unpostable gl_account_id → typed 404.
   */
  async replaceComponents(
    structureId: string,
    components: readonly {
      key: string;
      name: string;
      nameAr?: string | null;
      kind: store.ComponentKind;
      calc: store.ComponentCalc;
      amount?: string | null;
      rate?: string | null;
      glAccountId: string;
      isEosBase?: boolean;
      seq?: number;
    }[],
    actorId: string | null,
  ): Promise<ComponentRow[]> {
    const structure = await store.findStructureById(structureId);
    if (structure === undefined) throw new StructureNotFoundError(structureId);
    const usedByRun = await store.structureUsedInRun(structureId);
    if (usedByRun !== null) {
      throw new StructureInUseError({ structureId, runId: usedByRun });
    }
    await this.validateComponents(structureId, components);
    await store.deleteComponentsOfStructure(structureId);
    const inserted: ComponentRow[] = [];
    for (const component of components) {
      inserted.push(
        await store.insertComponent({
          structureId,
          key: component.key,
          name: component.name,
          nameAr: component.nameAr ?? null,
          kind: component.kind,
          calc: component.calc,
          amount: component.amount ?? null,
          rate: component.rate ?? null,
          glAccountId: component.glAccountId,
          isEosBase: component.isEosBase ?? false,
          seq: component.seq ?? inserted.length + 1,
        }),
      );
    }
    await this.audit.record({
      action: "payroll.structure_components_replaced",
      entityType: "salary_structure",
      entityId: structureId,
      actorId: actorId ?? undefined,
      after: { componentCount: inserted.length },
    });
    return inserted;
  }

  /**
   * BR-052 versioning: create the successor (components copied + edited),
   * then flip the predecessor → ARCHIVED pointing at it — one ambient
   * transaction. The successor starts unused (editable); employees keep
   * pointing at the row they had until explicitly reassigned.
   */
  async createVersion(
    predecessorId: string,
    input: {
      code: string;
      name?: string | null;
      components?: readonly {
        key: string;
        name: string;
        nameAr?: string | null;
        kind: store.ComponentKind;
        calc: store.ComponentCalc;
        amount?: string | null;
        rate?: string | null;
        glAccountId: string;
        isEosBase?: boolean;
        seq?: number;
      }[];
      actorId: string | null;
    },
  ): Promise<{ structure: StructureRow; components: ComponentRow[] }> {
    const predecessor = await store.findStructureById(predecessorId);
    if (predecessor === undefined) throw new StructureNotFoundError(predecessorId);
    if (predecessor.status !== "ACTIVE") {
      // Versioning an ARCHIVED row: the caller should version its successor.
      throw new StructureNotFoundError(predecessorId);
    }
    if ((await store.findStructureByCode(input.code)) !== undefined) {
      throw new PayrollCodeConflictError({ entity: "salary structure", code: input.code });
    }
    const successors = await store.listStructures(500);
    if (successors.some((row) => row.supersededById === predecessorId)) {
      throw new PayrollCodeConflictError({ entity: "salary structure version", code: input.code });
    }
    const base = await ownTenantBaseCurrency();
    const created = await store.insertStructure({
      code: input.code,
      name: input.name ?? predecessor.name,
      nameAr: predecessor.nameAr,
      currency: predecessor.currency === base ? predecessor.currency : predecessor.currency,
      note: predecessor.note,
      noteAr: predecessor.noteAr,
      createdBy: input.actorId,
    });
    const source =
      input.components === undefined
        ? await store.listComponents(predecessorId)
        : null;
    if (input.components !== undefined) {
      await this.validateComponents(created.id, input.components);
      for (const component of input.components) {
        await store.insertComponent({
          structureId: created.id,
          key: component.key,
          name: component.name,
          nameAr: component.nameAr ?? null,
          kind: component.kind,
          calc: component.calc,
          amount: component.amount ?? null,
          rate: component.rate ?? null,
          glAccountId: component.glAccountId,
          isEosBase: component.isEosBase ?? false,
          seq: component.seq,
        });
      }
    } else if (source !== null) {
      for (const component of source) {
        await store.insertComponent({
          structureId: created.id,
          key: component.key,
          name: component.name,
          nameAr: component.nameAr,
          kind: component.kind,
          calc: component.calc,
          amount: component.amount,
          rate: component.rate,
          glAccountId: component.glAccountId,
          isEosBase: component.isEosBase,
          seq: component.seq,
        });
      }
    }
    await store.archiveStructure(predecessorId, created.id);
    await this.audit.record({
      action: "payroll.structure_versioned",
      entityType: "salary_structure",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      before: { predecessorId, predecessorCode: predecessor.code, status: predecessor.status },
      after: { code: created.code, archivedPredecessor: predecessorId },
    });
    return { structure: created, components: await store.listComponents(created.id) };
  }

  /** S-04 + INV-004: every component's account exists, is postable, is ACTIVE. */
  private async validateComponents(
    _structureId: string,
    components: readonly { key: string; glAccountId: string; calc: string; amount?: string | null; rate?: string | null }[],
  ): Promise<void> {
    const seen = new Set<string>();
    for (const component of components) {
      if (seen.has(component.key)) {
        throw new PayrollCodeConflictError({ entity: "component key", code: component.key });
      }
      seen.add(component.key);
      const account = await findAccountById(component.glAccountId);
      if (account === undefined || account.status !== "ACTIVE" || !account.isPostable) {
        throw new ComponentAccountNotFoundError(component.glAccountId);
      }
    }
    void _structureId;
  }
}
