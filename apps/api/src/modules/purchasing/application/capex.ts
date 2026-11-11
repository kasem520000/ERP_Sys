import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { SelfApprovalBlockedError } from "../../accounting/domain/accounting-errors";
import { findPeriodForDate } from "../../accounting/infrastructure/accounting.store";
import { ControlGuard } from "../../budgeting/application/control-guard";
import * as collab from "../infrastructure/collaboration.store";
import {
  CapexRequestNotFoundError,
  CapexStateError,
} from "../domain/sourcing-errors";

/**
 * CAPEX requests service (PHASE-038 T-07; P-10/P-15): capital purchase
 * requests with the PR-style workflow (DRAFT → PENDING_APPROVAL →
 * APPROVED → CONVERTED; REJECTED/CANCELLED off the way), the SoD gate
 * (creator ≠ approver — SelfApprovalBlockedError), and the PHASE-028
 * budget control guard at submit — ADVISORY by default (exactly one
 * notification + the banner payload persisted on the row), ENFORCE_DRAFT
 * per tenant policy (the typed BUDGET_EXCEEDED rejection; the guard
 * never touches the posting pipeline — BR-051 verbatim). The official
 * number reserves at APPROVAL (the PR discipline).
 */

export const CAPEX_NUMBER_FORMAT = {
  prefix: "CAP",
  format: "CAP-{YYYY}-{SEQ:6}",
  docType: "capex_request",
} as const;

const AMOUNT_RE = /^\d+\.\d{4}$/;

@Injectable()
export class CapexService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly guard: ControlGuard,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { status?: string; branchId?: string; limit: number }) {
    return collab.listCapexRequests(filter);
  }

  async find(id: string) {
    const request = await collab.findCapexRequestById(id);
    if (request === undefined) throw new CapexRequestNotFoundError(id);
    return request;
  }

  async create(input: {
    branchId: string;
    title: string;
    titleAr: string | null;
    description: string | null;
    accountId: string;
    costCenterId: string | null;
    projectId: string | null;
    estimatedAmount: string;
    currencyCode: string;
    neededBy: string | null;
    actorId: string | null;
  }) {
    if (!AMOUNT_RE.test(input.estimatedAmount) || new Decimal(input.estimatedAmount).lte(0)) {
      throw new CapexStateError(
        `estimated amount must be a positive canonical decimal (4dp): ${input.estimatedAmount}`,
      );
    }
    const id = await collab.insertCapexRequest(input);
    await this.audit.record({
      action: "purchasing.capex_created",
      entityType: "capex_request",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        title: input.title,
        amount: input.estimatedAmount,
        accountId: input.accountId,
      },
    });
    return this.find(id);
  }

  async update(id: string, input: {
    title?: string;
    titleAr?: string | null;
    description?: string | null;
    accountId?: string;
    costCenterId?: string | null;
    projectId?: string | null;
    estimatedAmount?: string;
    neededBy?: string | null;
    actorId: string | null;
  }) {
    const request = await this.find(id);
    if (request.status !== "DRAFT") {
      throw new CapexStateError(
        `CAPEX request ${id} is ${request.status} — only DRAFT requests edit`,
      );
    }
    if (
      input.estimatedAmount !== undefined &&
      (!AMOUNT_RE.test(input.estimatedAmount) || new Decimal(input.estimatedAmount).lte(0))
    ) {
      throw new CapexStateError(
        `estimated amount must be a positive canonical decimal (4dp): ${input.estimatedAmount}`,
      );
    }
    await collab.updateCapexRequest(id, input);
    await this.audit.record({
      action: "purchasing.capex_updated",
      entityType: "capex_request",
      entityId: id,
      actorId: input.actorId ?? undefined,
    });
    return this.find(id);
  }

  /**
   * Submit: DRAFT → PENDING_APPROVAL, running the PHASE-028 guard on the
   * projected amount (ADVISORY default — the evaluation persists as the
   * banner evidence; ENFORCE_DRAFT — the typed BUDGET_EXCEEDED block).
   * The guard is a DECLARED EDGE (DEPENDENCY_RULES §2) — this is the
   * trade-document DRAFT-save flow it exists for.
   */
  async submit(id: string, actorId: string | null) {
    const request = await this.find(id);
    if (request.status !== "DRAFT") {
      throw new CapexStateError(
        `CAPEX request ${id} is ${request.status} — only DRAFT requests submit`,
      );
    }
    const asOf = new Date().toISOString().slice(0, 10);
    const period = await findPeriodForDate(request.neededBy ?? asOf);
    if (period === undefined) {
      throw new CapexStateError(
        `no fiscal period covers ${request.neededBy ?? asOf} — the budget guard needs a period to evaluate (create the fiscal calendar first)`,
      );
    }
    const evaluation = await this.guard.evaluateDraftSave({
      actorId,
      documentRef: { type: "capex_request", id: request.id, label: request.title },
      fiscalPeriodId: period.id,
      lines: [
        {
          accountId: request.accountId,
          costCenterId: request.costCenterId,
          projectId: request.projectId,
          // The branch dimension stays unset: the guard's dimension
          // matching keys the budget scope off cost-center/project/
          // branch PRESENCE — a branch-stamped line would require a
          // BRANCHES-scoped budget, and the CAPEX baseline budgets on
          // the account (the P-10/P-15 semantics).
          projectedAmount: request.estimatedAmount,
        },
      ],
    });
    const submittedAt = new Date().toISOString();
    await collab.updateCapexRequest(id, {
      status: "PENDING_APPROVAL",
      submittedAt,
      submittedBy: actorId,
      budgetEvaluation: { mode: evaluation.mode, warnings: evaluation.warnings, at: submittedAt },
    });
    await this.audit.record({
      action: "purchasing.capex_submitted",
      entityType: "capex_request",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { budgetControlMode: evaluation.mode, warnings: evaluation.warnings.length },
    });
    return this.find(id);
  }

  /** Approve: the SoD gate (creator ≠ approver) + the official number. */
  async approve(id: string, actorId: string | null) {
    const request = await this.find(id);
    if (request.status !== "PENDING_APPROVAL") {
      throw new CapexStateError(
        `CAPEX request ${id} is ${request.status} — only PENDING_APPROVAL requests approve`,
      );
    }
    if (request.createdBy !== null && request.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    const year = new Date().toISOString().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: CAPEX_NUMBER_FORMAT.docType,
      branchId: request.branchId,
      periodKey: year,
      format: CAPEX_NUMBER_FORMAT.format,
      prefix: CAPEX_NUMBER_FORMAT.prefix,
      year,
    });
    await collab.updateCapexRequest(id, {
      status: "APPROVED",
      approvedBy: actorId,
      approvedAt: new Date().toISOString(),
      requestNo: acquired.number,
    });
    await this.numbering.bind(CAPEX_NUMBER_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "purchasing.capex_approved",
      entityType: "capex_request",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { requestNo: acquired.number, amount: request.estimatedAmount },
    });
    return this.find(id);
  }

  async reject(id: string, reason: string, actorId: string | null) {
    const request = await this.find(id);
    if (request.status !== "PENDING_APPROVAL") {
      throw new CapexStateError(
        `CAPEX request ${id} is ${request.status} — only PENDING_APPROVAL requests reject`,
      );
    }
    if (request.createdBy !== null && request.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    await collab.updateCapexRequest(id, {
      status: "REJECTED",
      approvedBy: actorId,
      approvedAt: new Date().toISOString(),
      rejectionReason: reason,
    });
    await this.audit.record({
      action: "purchasing.capex_rejected",
      entityType: "capex_request",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const request = await this.find(id);
    if (request.status === "CONVERTED" || request.status === "CANCELLED") {
      throw new CapexStateError(
        `CAPEX request ${id} is ${request.status} — already terminal`,
      );
    }
    await collab.updateCapexRequest(id, { status: "CANCELLED", cancelReason: reason });
    await this.audit.record({
      action: "purchasing.capex_cancelled",
      entityType: "capex_request",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }

  /** Convert: an APPROVED request's PO linkage (the capex → order trail). */
  async convert(id: string, purchaseOrderId: string, actorId: string | null) {
    const request = await this.find(id);
    if (request.status !== "APPROVED") {
      throw new CapexStateError(
        `CAPEX request ${id} is ${request.status} — only APPROVED requests convert`,
      );
    }
    await collab.updateCapexRequest(id, { status: "CONVERTED", convertedOrderId: purchaseOrderId });
    await this.audit.record({
      action: "purchasing.capex_converted",
      entityType: "capex_request",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { purchaseOrderId },
    });
    return this.find(id);
  }
}
