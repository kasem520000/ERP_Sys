import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  EmployeeNotFoundError,
} from "../domain/hr-errors";
import {
  EmployeeDocumentNotFoundError,
  OrgCycleError,
  OrgUnitNotFoundError,
  PositionNotFoundError,
  TalentCodeTakenError,
  TalentInvalidError,
} from "../domain/talent-errors";
import { wouldCreateCycle } from "../domain/talent-math";
import * as store from "../infrastructure/talent-org.store";
import { lockTalentOrgPlane } from "../infrastructure/atomic";
import type { EmployeeDocumentRow, OrgUnitRow, PositionRow } from "../infrastructure/talent-org.store";

/**
 * PHASE-047 (W-3 — T-08 the org half + T-09's documents) — the org
 * engine: the org tree (D-09's cycle-safe move law — every move and
 * every position re-parent validates NO CYCLE at write time through
 * the SAME pure `wouldCreateCycle` the goals cascade rides, under the
 * T-20 org-plane gate so two tree writes never interleave on a stale
 * edge set), the bilingual positions (grade, org-unit attachment,
 * reports_to), and the employee documents register (HR-10 — the
 * Gulf compliance exposure: PASSPORT/IQAMA/VISA/CONTRACT/CERTIFICATE/
 * OTHER with issue/expiry windows; operational data incl. DELETE —
 * replacement is a normal HR operation).
 *
 * THE ORG-CODE LAW: unit and position codes are DOT-FREE
 * (`^[A-Za-z0-9_-]{1,32}$`) — the materialized path's grammar rides
 * dot-joined codes, so a dot inside a code would be ambiguous; the
 * typed refusal names the law.
 *
 * THE PATH GRAMMAR: root path = own code; a child's path =
 * `{parentPath}.{ownCode}`. A move recomputes the moved unit's path
 * AND every descendant's prefix in the one ambient UoW (the store's
 * two-statement move); a rename never rewrites paths (codes are
 * immutable — the path's stability is the tree's).
 *
 * Ledger-free by design (D-05).
 */

const ORG_CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOCUMENT_KINDS = new Set([
  "PASSPORT",
  "IQAMA",
  "VISA",
  "CONTRACT",
  "CERTIFICATE",
  "OTHER",
]);

function requireUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) {
    throw new TalentInvalidError(`${what} must be a uuid: ${value}`);
  }
  return value;
}

function isoDate(value: string, what: string): string {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new TalentInvalidError(`${what} must be an ISO date (YYYY-MM-DD): ${value}`);
  }
  return value;
}

@Injectable()
export class TalentOrgService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // ── org units (the cycle-safe tree, D-09) ────────────────────────────────

  async createOrgUnit(input: {
    code: string;
    name: string;
    nameAr: string | null;
    parentId: string | null;
    actorId: string | null;
  }): Promise<OrgUnitRow> {
    if (!ORG_CODE_RE.test(input.code)) {
      throw new TalentInvalidError(
        `the org-unit code must be 1–32 dot-free characters (letters/digits/dash/underscore — the materialized path's grammar rides dot-joined codes): ${input.code}`,
      );
    }
    if (input.name.trim().length < 1 || input.name.length > 160) {
      throw new TalentInvalidError("the org-unit name must be 1–160 characters");
    }
    await lockTalentOrgPlane();
    if ((await store.findOrgUnitByCode(input.code)) !== undefined) {
      throw new TalentCodeTakenError("org-unit", input.code);
    }
    let parentPath: string | null = null;
    if (input.parentId !== null) {
      const parentId = requireUuid(input.parentId, "parentId");
      const parent = await store.findOrgUnitById(parentId);
      if (parent === undefined) throw new OrgUnitNotFoundError(input.parentId);
      parentPath = parent.path;
    }
    const created = await store.insertOrgUnit({
      code: input.code,
      name: input.name.trim(),
      nameAr: input.nameAr,
      parentId: input.parentId,
      parentPath,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.org_unit_created",
      entityType: "org_unit",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { code: created.code, name: created.name, parentId: created.parentId, path: created.path },
    });
    return created;
  }

  async getOrgUnit(orgUnitId: string): Promise<OrgUnitRow> {
    const unit = await store.findOrgUnitById(requireUuid(orgUnitId, "orgUnitId"));
    if (unit === undefined) throw new OrgUnitNotFoundError(orgUnitId);
    return unit;
  }

  async listOrgUnits(): Promise<OrgUnitRow[]> {
    return store.listOrgUnits();
  }

  /**
   * PHASE-047 (W-5 — T-14, the 360 extension's placement read): the
   * employee's D-01 placement axes (position + org unit + D-02's
   * probation_end) or the honest null axes (a position-less employee
   * is a valid state — never an error). READ-ONLY on the substrate.
   */
  async getPlacement(
    employeeId: string,
  ): Promise<store.EmployeePlacementView | null> {
    return (await store.findPlacement(requireUuid(employeeId, "employeeId"))) ?? null;
  }

  /**
   * The org-unit patch: the rename/active arms, OR the MOVE (a
   * non-undefined parentId) — the D-09 act. The move runs under the
   * org-plane gate: the whole-tree edge read + the pure cycle guard +
   * the two-statement re-path (the moved unit + every descendant's
   * prefix rewrite) stay coherent; the guarded UPDATE refuses a raced
   * move (zero rows — the service re-reads and retries the act).
   */
  async patchOrgUnit(input: {
    id: string;
    name?: string;
    nameAr?: string | null;
    active?: boolean;
    parentId?: string | null;
    actorId: string | null;
  }): Promise<OrgUnitRow> {
    const id = requireUuid(input.id, "orgUnitId");
    await lockTalentOrgPlane();
    const unit = await store.findOrgUnitById(id);
    if (unit === undefined) throw new OrgUnitNotFoundError(input.id);
    if (input.name !== undefined && (input.name.trim().length < 1 || input.name.length > 160)) {
      throw new TalentInvalidError("the org-unit name must be 1–160 characters");
    }
    if (input.parentId === undefined) {
      const updated = await store.patchOrgUnit({
        id,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr }),
        ...(input.active === undefined ? {} : { active: input.active }),
      });
      await this.audit.record({
        action: "hr.org_unit_patched",
        entityType: "org_unit",
        entityId: id,
        actorId: input.actorId ?? undefined,
        after: { name: updated?.name, active: updated?.active },
      });
      return updated!;
    }
    // THE MOVE (D-09): the pure guard FIRST — a move that would close
    // a loop is refused BEFORE any write (the illegal state never
    // saves).
    const newParentId = input.parentId === null ? null : requireUuid(input.parentId, "parentId");
    if (newParentId === id) {
      throw new OrgCycleError("org-unit", id, id);
    }
    if (newParentId !== null) {
      const parent = await store.findOrgUnitById(newParentId);
      if (parent === undefined) throw new OrgUnitNotFoundError(input.parentId!);
    }
    const edges = await store.listOrgUnitEdges();
    if (wouldCreateCycle(edges, id, newParentId)) {
      throw new OrgCycleError("org-unit", id, input.parentId!);
    }
    const newPath =
      newParentId === null
        ? unit.code
        : `${(await store.findOrgUnitById(newParentId))!.path}.${unit.code}`;
    const moved = await store.moveOrgUnit({
      id,
      expectedParentId: unit.parentId,
      newParentId,
      newPath,
      oldPath: unit.path,
    });
    if (moved === undefined) {
      // A raced move changed the parent underneath — re-read for the
      // honest current-state refusal (one act, one write).
      const current = await store.findOrgUnitById(id);
      throw new TalentInvalidError(
        `org unit ${input.id}'s parent moved underneath this act (now ${current?.parentId ?? "root"}) — retry the move against the fresh state`,
      );
    }
    await this.audit.record({
      action: "hr.org_unit_moved",
      entityType: "org_unit",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { parentId: unit.parentId, path: unit.path },
      after: { parentId: newParentId, path: newPath },
    });
    return moved;
  }

  // ── positions (the bilingual slots + reports_to) ─────────────────────────

  async createPosition(input: {
    code: string;
    title: string;
    titleAr: string | null;
    grade: string | null;
    orgUnitId: string | null;
    reportsTo: string | null;
    actorId: string | null;
  }): Promise<PositionRow> {
    if (!ORG_CODE_RE.test(input.code)) {
      throw new TalentInvalidError(
        `the position code must be 1–32 dot-free characters (letters/digits/dash/underscore): ${input.code}`,
      );
    }
    if (input.title.trim().length < 1 || input.title.length > 160) {
      throw new TalentInvalidError("the position title must be 1–160 characters");
    }
    if (input.grade !== null && input.grade.length > 32) {
      throw new TalentInvalidError("the grade must be at most 32 characters");
    }
    await lockTalentOrgPlane();
    if ((await store.findPositionByCode(input.code)) !== undefined) {
      throw new TalentCodeTakenError("position", input.code);
    }
    if (input.orgUnitId !== null) {
      const orgUnitId = requireUuid(input.orgUnitId, "orgUnitId");
      if ((await store.findOrgUnitById(orgUnitId)) === undefined) {
        throw new OrgUnitNotFoundError(input.orgUnitId);
      }
    }
    if (input.reportsTo !== null) {
      const reportsTo = requireUuid(input.reportsTo, "reportsTo");
      if ((await store.findPositionById(reportsTo)) === undefined) {
        throw new PositionNotFoundError(input.reportsTo);
      }
    }
    const created = await store.insertPosition({
      code: input.code,
      title: input.title.trim(),
      titleAr: input.titleAr,
      grade: input.grade,
      orgUnitId: input.orgUnitId,
      reportsTo: input.reportsTo,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.position_created",
      entityType: "position",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        code: created.code,
        title: created.title,
        orgUnitId: created.orgUnitId,
        reportsTo: created.reportsTo,
      },
    });
    return created;
  }

  async listPositions(filter: { orgUnitId?: string; limit?: number }): Promise<PositionRow[]> {
    return store.listPositions({
      ...(filter.orgUnitId === undefined
        ? {}
        : { orgUnitId: requireUuid(filter.orgUnitId, "orgUnitId") }),
      limit: Math.min(Math.max(filter.limit ?? 100, 1), 500),
    });
  }

  /** The position patch — the reports_to re-parent rides the SAME
   * D-09 guard (the pure wouldCreateCycle over the position edges,
   * under the org-plane gate); the guarded UPDATE pins the CURRENT
   * reports_to so a raced re-parent refuses. */
  async patchPosition(input: {
    id: string;
    title?: string;
    titleAr?: string | null;
    grade?: string | null;
    orgUnitId?: string | null;
    reportsTo?: string | null;
    status?: string;
    actorId: string | null;
  }): Promise<PositionRow> {
    const id = requireUuid(input.id, "positionId");
    await lockTalentOrgPlane();
    const position = await store.findPositionById(id);
    if (position === undefined) throw new PositionNotFoundError(input.id);
    if (input.title !== undefined && (input.title.trim().length < 1 || input.title.length > 160)) {
      throw new TalentInvalidError("the position title must be 1–160 characters");
    }
    if (input.status !== undefined && input.status !== "ACTIVE" && input.status !== "RETIRED") {
      throw new TalentInvalidError(`status must be ACTIVE or RETIRED: ${input.status}`);
    }
    if (input.orgUnitId !== undefined && input.orgUnitId !== null) {
      requireUuid(input.orgUnitId, "orgUnitId");
      if ((await store.findOrgUnitById(input.orgUnitId)) === undefined) {
        throw new OrgUnitNotFoundError(input.orgUnitId);
      }
    }
    if (input.reportsTo !== undefined && input.reportsTo !== null) {
      const reportsTo = requireUuid(input.reportsTo, "reportsTo");
      if ((await store.findPositionById(reportsTo)) === undefined) {
        throw new PositionNotFoundError(input.reportsTo);
      }
      if (reportsTo === id) {
        throw new OrgCycleError("position", id, reportsTo);
      }
      const edges = await store.listPositionEdges();
      if (wouldCreateCycle(
        edges.map((edge) => ({ id: edge.id, parentId: edge.reportsTo })),
        id,
        reportsTo,
      )) {
        throw new OrgCycleError("position", id, reportsTo);
      }
    }
    const updated = await store.updatePosition({
      id,
      expectedReportsTo: position.reportsTo,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.titleAr === undefined ? {} : { titleAr: input.titleAr }),
      ...(input.grade === undefined ? {} : { grade: input.grade }),
      ...(input.orgUnitId === undefined ? {} : { orgUnitId: input.orgUnitId }),
      ...(input.reportsTo === undefined ? {} : { reportsTo: input.reportsTo }),
      ...(input.status === undefined ? {} : { status: input.status }),
    });
    if (updated === undefined) {
      const current = await store.findPositionById(id);
      throw new TalentInvalidError(
        `position ${input.id}'s reports_to moved underneath this act (now ${current?.reportsTo ?? "root"}) — retry against the fresh state`,
      );
    }
    await this.audit.record({
      action: "hr.position_patched",
      entityType: "position",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { reportsTo: position.reportsTo },
      after: { reportsTo: updated.reportsTo, status: updated.status },
    });
    return updated;
  }

  // ── employee documents (the register, HR-10) ─────────────────────────────

  async createDocument(input: {
    employeeId: string;
    kind: string;
    number: string | null;
    issuedOn: string | null;
    expiresOn: string | null;
    notes: string | null;
    actorId: string | null;
  }): Promise<EmployeeDocumentRow> {
    const employeeId = requireUuid(input.employeeId, "employeeId");
    if ((await store.findEmployeeBrief(employeeId)) === undefined) {
      throw new EmployeeNotFoundError(input.employeeId);
    }
    if (!DOCUMENT_KINDS.has(input.kind)) {
      throw new TalentInvalidError(
        `kind must be one of PASSPORT/IQAMA/VISA/CONTRACT/CERTIFICATE/OTHER: ${input.kind}`,
      );
    }
    if (input.number !== null && input.number.length > 128) {
      throw new TalentInvalidError("the document number must be at most 128 characters");
    }
    const issuedOn = input.issuedOn === null ? null : isoDate(input.issuedOn, "issuedOn");
    const expiresOn = input.expiresOn === null ? null : isoDate(input.expiresOn, "expiresOn");
    if (issuedOn !== null && expiresOn !== null && expiresOn <= issuedOn) {
      throw new TalentInvalidError(
        `the document window is inverted: issued ${issuedOn}, expires ${expiresOn} (expiry must be after the issue date)`,
      );
    }
    const created = await store.insertEmployeeDocument({
      employeeId,
      kind: input.kind,
      number: input.number,
      issuedOn,
      expiresOn,
      notes: input.notes,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.employee_document_created",
      entityType: "employee_document",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      // NO document number in the audit payload (the PII inventory's
      // law — the number never leaves the register's own plane).
      after: { employeeId, kind: created.kind, issuedOn, expiresOn },
    });
    return created;
  }

  async listDocuments(filter: {
    employeeId?: string;
    kind?: string;
    limit?: number;
  }): Promise<EmployeeDocumentRow[]> {
    if (filter.kind !== undefined && !DOCUMENT_KINDS.has(filter.kind)) {
      throw new TalentInvalidError(
        `kind must be one of PASSPORT/IQAMA/VISA/CONTRACT/CERTIFICATE/OTHER: ${filter.kind}`,
      );
    }
    return store.listEmployeeDocuments({
      ...(filter.employeeId === undefined
        ? {}
        : { employeeId: requireUuid(filter.employeeId, "employeeId") }),
      ...(filter.kind === undefined ? {} : { kind: filter.kind }),
      limit: Math.min(Math.max(filter.limit ?? 100, 1), 500),
    });
  }

  async patchDocument(input: {
    id: string;
    number?: string | null;
    issuedOn?: string | null;
    expiresOn?: string | null;
    notes?: string | null;
    actorId: string | null;
  }): Promise<EmployeeDocumentRow> {
    const id = requireUuid(input.id, "documentId");
    const document = await store.findEmployeeDocumentById(id);
    if (document === undefined) throw new EmployeeDocumentNotFoundError(input.id);
    if (input.number !== undefined && input.number !== null && input.number.length > 128) {
      throw new TalentInvalidError("the document number must be at most 128 characters");
    }
    const issuedOn =
      input.issuedOn === undefined
        ? document.issuedOn
        : input.issuedOn === null
          ? null
          : isoDate(input.issuedOn, "issuedOn");
    const expiresOn =
      input.expiresOn === undefined
        ? document.expiresOn
        : input.expiresOn === null
          ? null
          : isoDate(input.expiresOn, "expiresOn");
    if (issuedOn !== null && expiresOn !== null && expiresOn <= issuedOn) {
      throw new TalentInvalidError(
        `the document window is inverted: issued ${issuedOn}, expires ${expiresOn}`,
      );
    }
    const updated = await store.updateEmployeeDocument({
      id,
      ...(input.number === undefined ? {} : { number: input.number }),
      ...(input.issuedOn === undefined ? {} : { issuedOn: input.issuedOn }),
      ...(input.expiresOn === undefined ? {} : { expiresOn: input.expiresOn }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    });
    await this.audit.record({
      action: "hr.employee_document_patched",
      entityType: "employee_document",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { kind: updated?.kind, expiresOn: updated?.expiresOn },
    });
    return updated!;
  }

  /** The register's one DELETE (replacement is a normal HR operation;
   * the audit event is the record — the PII law: the number never
   * rides the payload). */
  async deleteDocument(id: string, actorId: string | null): Promise<EmployeeDocumentRow> {
    const documentId = requireUuid(id, "documentId");
    const deleted = await store.deleteEmployeeDocument(documentId);
    if (deleted === undefined) throw new EmployeeDocumentNotFoundError(id);
    await this.audit.record({
      action: "hr.employee_document_deleted",
      entityType: "employee_document",
      entityId: documentId,
      actorId: actorId ?? undefined,
      before: { kind: deleted.kind, employeeId: deleted.employeeId },
    });
    return deleted;
  }
}
