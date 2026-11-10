import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { publishTenancyEvent } from "../../configuration/api";
import * as store from "../infrastructure/tenancy.store";
import {
  BranchCodeTakenError,
  BranchNotActiveError,
  BranchScopeViolationError,
} from "../domain/tenancy-errors";
import { NotFoundError } from "../../identity/api/identity";

/**
 * Branch service (PHASE-004 §2.4/T6): CRUD for operating units inside the
 * caller's tenant UoW, the branch registry contract other modules consume
 * (inactive branches reject new documents at the service layer — the
 * acceptance-3 stub-document contract test drives
 * `assertBranchAcceptsDocuments`), and branch-scoped membership
 * enforcement (AUTHORIZATION_MATRIX §5: cross-branch references → 403).
 *
 * Deactivation is the lifecycle (is_active = false keeps history); DELETE
 * is grant-absent by design.
 */

export interface BranchScopeContext {
  /** null = tenant-wide membership; else the granted branch id list. */
  readonly branchScope: readonly string[] | null;
}

@Injectable()
export class BranchService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** List branches filtered by the caller's branch scope (matrix §5). */
  async listForMembership(
    scope: BranchScopeContext,
  ): Promise<store.BranchRow[]> {
    return store.listBranches(scope.branchScope === null ? null : [...scope.branchScope]);
  }

  async create(
    actorId: string,
    input: { code: string; name: string; nameAr: string | null; address: unknown },
  ): Promise<store.BranchRow> {
    const existing = await store.findBranchByCode(input.code);
    if (existing !== undefined) {
      throw new BranchCodeTakenError(input.code);
    }
    const branch = await store.insertBranch(input);
    await this.audit.record({
      action: "branch.created",
      entityType: "branch",
      entityId: branch.id,
      actorId,
      after: { code: branch.code, name: branch.name },
    });
    publishTenancyEvent({
      type: "branch.updated",
      tenantId: branch.tenantId,
      branchId: branch.id,
    });
    return branch;
  }

  async update(
    actorId: string,
    branchId: string,
    patch: { name?: string; nameAr?: string | null; address?: unknown; isActive?: boolean },
  ): Promise<store.BranchRow> {
    const before = await store.findBranchById(branchId);
    if (before === undefined) {
      throw new NotFoundError(`branch ${branchId}`);
    }
    // Codes are natural keys referenced by documents — immutable (the
    // controller schema never accepts a code on PATCH).
    const branch = await store.updateBranch(branchId, patch);
    if (branch === undefined) {
      throw new NotFoundError(`branch ${branchId}`);
    }
    await this.audit.record({
      action: "branch.updated",
      entityType: "branch",
      entityId: branch.id,
      actorId,
      before: { name: before.name, is_active: before.isActive },
      after: { name: branch.name, is_active: branch.isActive },
    });
    publishTenancyEvent({
      type: "branch.updated",
      tenantId: branch.tenantId,
      branchId: branch.id,
    });
    return branch;
  }

  /**
   * Registry contract for document-type services (PHASE-005+): a document
   * targeting a branch the caller cannot touch → 403 BranchScopeViolation;
   * a target branch that is inactive → BranchNotActive (new documents
   * rejected; history preserved).
   */
  async assertBranchAcceptsDocuments(
    scope: BranchScopeContext,
    branchId: string,
  ): Promise<void> {
    if (scope.branchScope !== null && !scope.branchScope.includes(branchId)) {
      throw new BranchScopeViolationError(branchId);
    }
    const branch = await store.findBranchById(branchId);
    if (branch === undefined) {
      throw new NotFoundError(`branch ${branchId}`);
    }
    if (!branch.isActive) {
      throw new BranchNotActiveError(branchId);
    }
  }
}

/** Pure scope check for cross-branch reference validation (no DB touch). */
export function assertBranchInScope(scope: BranchScopeContext, branchId: string): void {
  if (scope.branchScope !== null && !scope.branchScope.includes(branchId)) {
    throw new BranchScopeViolationError(branchId);
  }
}
