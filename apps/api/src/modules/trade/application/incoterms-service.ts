import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";

import * as store from "../infrastructure/trade.store";
import { renderIncotermMatrix, type IncotermMatrixHints } from "../domain/incoterm-matrix";
import {
  IncotermCodeFrozenError,
  IncotermDuplicateError,
  IncotermInactiveError,
  IncotermInvalidError,
  IncotermRecordNotFoundError,
} from "../domain/trade-errors";

/**
 * PHASE-051 (W-35 — T-08, 2026-11-25) THE INCOTERMS REGISTRY ENGINE
 * (L-03, D-10/D-16): the tenant-extensible registry — the reads (with
 * the risk-hint matrix rendered from each row's OWN data, AR/EN), the
 * tenant additions (the (tenant, code) natural key refused BY NAME),
 * and the updates (the code is the row's identity — NEVER rewritten;
 * the names, the ownership matrix and the active flag ride).
 *
 *   THE SEEDS' OWN LAW (D-16 — «البذور بإقرار الدقة», the BR-055
 *   family): the Incoterms-2020 set ships as tenant-extensible DATA
 *   with the documented accuracy disclaimer on every starter row (the
 *   tenant owns the final applicability — verify against the contract
 *   and jurisdiction before use). The registry never invents a code
 *   the tenant did not write; the matrix is the ROW'S OWN data, never
 *   a parallel dictionary (the one-source law — the W-39 selector and
 *   the finance surfaces render these rows VERBATIM).
 *
 *   THE SELECTION FLOOR (the PO/SO selector's engine arm): a
 *   selected code must EXIST and be ACTIVE in the tenant's registry —
 *   the typed refusals name the code (unknown / retired). A retired
 *   code never rides a NEW order; existing orders keep their recorded
 *   selection (the snapshot semantics — the order's create froze its
 *   choice; the registry's later retirement never rewrites a posted
 *   order). The BR-106 MANDATE itself (the typed refusal at the
 *   order's own posting) lives in the shared order gate — the
 *   documented contract the purchasing and sales issue acts consume
 *   (infrastructure/trade-order-gate.ts); this service owns the
 *   REGISTRY, the gate owns the mandate. Zero parallel computation on
 *   either side.
 *
 *   ONE ambient transaction per write (INV-018): the row and its
 *   audit record commit together or not at all — there is no journal
 *   to post and no ledger effect anywhere (the registry is pure
 *   reference data).
 */

/** The 0120 CHECK floors, rendered at the service surface. */
const CODE_RE = /^[A-Z0-9]{2,8}$/;
const NAME_MIN = 2;
const NAME_MAX = 120;

function requireCode(code: string): string {
  if (!CODE_RE.test(code)) {
    throw new IncotermInvalidError({
      field: "code",
      reason: `2…8 uppercase letters/digits are required (the 0120 floor), got "${code}"`,
    });
  }
  return code;
}

function requireName(name: string, field: string): string {
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
    throw new IncotermInvalidError({
      field,
      reason: `${NAME_MIN}…${NAME_MAX} chars are required (the 0120 bilingual floor), got "${name}"`,
    });
  }
  return trimmed;
}

export interface IncotermWithMatrix {
  readonly row: store.IncotermRow;
  /** The risk-hint matrix rendered from the row's own data (AR/EN). */
  readonly matrix: IncotermMatrixHints;
}

@Injectable()
export class IncotermsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // ── the reads (the registry + the matrix from the row's own data) ──────

  async list(filter: { activeOnly?: boolean }): Promise<IncotermWithMatrix[]> {
    const rows = await store.listIncoterms({
      activeOnly: filter.activeOnly ?? true,
      limit: 200,
    });
    return rows.map((row) => ({ row, matrix: renderIncotermMatrix(row) }));
  }

  async find(code: string): Promise<IncotermWithMatrix> {
    const normalized = code.trim().toUpperCase();
    const row = await store.findIncotermByCode(normalized);
    if (row === undefined) {
      throw new IncotermRecordNotFoundError({ code: normalized });
    }
    return { row, matrix: renderIncotermMatrix(row) };
  }

  // ── the tenant addition (the registry grows) ───────────────────────────

  async create(input: {
    code: string;
    name: string;
    nameAr: string;
    carriageBySeller: boolean;
    insuranceBySeller: boolean;
    exportClearanceBySeller: boolean;
    importClearanceBySeller: boolean;
    importDutyBySeller: boolean;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<IncotermWithMatrix> {
    const code = requireCode(input.code.trim().toUpperCase());
    const name = requireName(input.name, "name");
    const nameAr = requireName(input.nameAr, "nameAr");
    // The natural key refused BY NAME (the typed pre-check law — the
    // 23505 never surfaces raw).
    if ((await store.findIncotermByCode(code)) !== undefined) {
      throw new IncotermDuplicateError({ code });
    }
    const row = await store.insertIncoterm({
      code,
      name,
      nameAr,
      carriageBySeller: input.carriageBySeller,
      insuranceBySeller: input.insuranceBySeller,
      exportClearanceBySeller: input.exportClearanceBySeller,
      importClearanceBySeller: input.importClearanceBySeller,
      importDutyBySeller: input.importDutyBySeller,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "trade.incoterm_created",
      entityType: "incoterms",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        code: row.code,
        name: row.name,
        nameAr: row.nameAr,
        carriageBySeller: row.carriageBySeller,
        insuranceBySeller: row.insuranceBySeller,
        exportClearanceBySeller: row.exportClearanceBySeller,
        importClearanceBySeller: row.importClearanceBySeller,
        importDutyBySeller: row.importDutyBySeller,
      },
    });
    return { row, matrix: renderIncotermMatrix(row) };
  }

  // ── the update (the code is the identity — NEVER rewritten) ────────────

  async update(
    code: string,
    input: {
      code?: string | null;
      name?: string | null;
      nameAr?: string | null;
      carriageBySeller?: boolean | null;
      insuranceBySeller?: boolean | null;
      exportClearanceBySeller?: boolean | null;
      importClearanceBySeller?: boolean | null;
      importDutyBySeller?: boolean | null;
      isActive?: boolean | null;
      note?: string | null;
      noteAr?: string | null;
      actorId: string | null;
    },
  ): Promise<IncotermWithMatrix> {
    const normalized = code.trim().toUpperCase();
    const row = await store.findIncotermByCode(normalized);
    if (row === undefined) {
      throw new IncotermRecordNotFoundError({ code: normalized });
    }
    // THE CODE IS THE IDENTITY: a rewrite attempt refuses BY NAME (the
    // register's audit-trail law — create a new row and retire the old
    // one; the uq's own reading).
    if (input.code !== undefined && input.code !== null) {
      const attempted = input.code.trim().toUpperCase();
      if (attempted !== row.code) {
        throw new IncotermCodeFrozenError({ code: row.code, attempted });
      }
    }
    // The empty-update floor BEFORE the write (zero residue — the
    // refused act leaves the row untouched): at least one field rides.
    const carriesField =
      (input.name !== undefined && input.name !== null) ||
      (input.nameAr !== undefined && input.nameAr !== null) ||
      input.carriageBySeller !== undefined ||
      input.insuranceBySeller !== undefined ||
      input.exportClearanceBySeller !== undefined ||
      input.importClearanceBySeller !== undefined ||
      input.importDutyBySeller !== undefined ||
      input.isActive !== undefined ||
      input.note !== undefined ||
      input.noteAr !== undefined;
    if (!carriesField) {
      throw new IncotermInvalidError({
        field: "update",
        reason: "the update carries at least one field (an empty update is refused — the row never moves for nothing)",
      });
    }
    const updated = await store.updateIncoterm({
      id: row.id,
      name: input.name === undefined || input.name === null ? null : requireName(input.name, "name"),
      nameAr: input.nameAr === undefined || input.nameAr === null ? null : requireName(input.nameAr, "nameAr"),
      carriageBySeller: input.carriageBySeller ?? null,
      insuranceBySeller: input.insuranceBySeller ?? null,
      exportClearanceBySeller: input.exportClearanceBySeller ?? null,
      importClearanceBySeller: input.importClearanceBySeller ?? null,
      importDutyBySeller: input.importDutyBySeller ?? null,
      isActive: input.isActive ?? null,
      note: input.note === undefined ? null : input.note,
      noteAr: input.noteAr === undefined ? null : input.noteAr,
      actorId: input.actorId,
    });
    if (updated === undefined) {
      // The store's own typed refusal surface (the row vanished under
      // the act — RLS moved it): the 404 shape, never a silent pass.
      throw new IncotermRecordNotFoundError({ code: normalized });
    }
    await this.audit.record({
      action: "trade.incoterm_updated",
      entityType: "incoterms",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      before: {
        code: row.code,
        name: row.name,
        nameAr: row.nameAr,
        isActive: row.isActive,
      },
      after: {
        code: updated.code,
        name: updated.name,
        nameAr: updated.nameAr,
        isActive: updated.isActive,
      },
    });
    return { row: updated, matrix: renderIncotermMatrix(updated) };
  }

  // ── the selection floor (the PO/SO selector's engine arm) ──────────────

  /**
   * The selected code must exist and be ACTIVE (the selector's own
   * floor — the typed refusals name the code). Consumed by the PO/SO
   * create acts through the shared order gate (the documented
   * contract); a null selection passes (the mandate fires at the
   * order's own posting, never at create).
   */
  async assertSelectable(code: string | null): Promise<void> {
    if (code === null || code === "") {
      return;
    }
    const normalized = code.trim().toUpperCase();
    if (!CODE_RE.test(normalized)) {
      throw new IncotermInvalidError({
        field: "incotermCode",
        reason: `2…8 uppercase letters/digits are required (the 0120 floor), got "${code}"`,
      });
    }
    const row = await store.findIncotermByCode(normalized);
    if (row === undefined) {
      throw new IncotermRecordNotFoundError({ code: normalized });
    }
    if (!row.isActive) {
      throw new IncotermInactiveError({ code: normalized });
    }
  }
}
