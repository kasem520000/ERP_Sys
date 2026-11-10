import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  RunImmutableError,
  RunNotFoundError,
  RunSelfApprovalError,
  RunPeriodExistsError,
} from "../domain/payroll-errors";
import * as store from "../infrastructure/payroll.store";
import type { RunRow } from "../infrastructure/payroll.store";

/**
 * Run approval workflow (PHASE-029 T6): DRAFT → PENDING_APPROVAL (submit)
 * → POSTED (the posting service — approval stamp required). SoD
 * (AUTHORIZATION_MATRIX §4 row payroll.runs.approve): the run's creator
 * never approves it. The approved stamp lands while the status is STILL
 * PENDING_APPROVAL (the ck_payroll_runs_draft_shape one-directional
 * lesson — DRAFT rows carry no stamps, the stamp precedes the POSTED
 * flip). Every transition audited.
 */

@Injectable()
export class ApprovalWorkflow {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** DRAFT → PENDING_APPROVAL (requires a calculated population). */
  async submit(runId: string, actorId: string | null): Promise<RunRow> {
    const run = await store.findRunById(runId);
    if (run === undefined) throw new RunNotFoundError(runId);
    if (run.status !== "DRAFT") {
      throw new RunImmutableError({
        runId,
        status: run.status,
        action: "submit (only DRAFT runs submit)",
      });
    }
    const lines = await store.listRunLines(runId);
    if (lines.length === 0) {
      throw new RunImmutableError({
        runId,
        status: run.status,
        action: "submit (the run carries no calculated lines — calculate first)",
      });
    }
    const liveSibling = await store.findLiveRunOfPeriod(run.fiscalPeriodId);
    if (liveSibling !== undefined && liveSibling.id !== runId) {
      throw new RunPeriodExistsError({
        fiscalPeriodId: run.fiscalPeriodId,
        existingRunId: liveSibling.id,
      });
    }
    const submitted = await store.updateRun(runId, {
      status: "PENDING_APPROVAL",
      submittedAt: new Date().toISOString(),
      submittedBy: actorId,
    });
    await this.audit.record({
      action: "payroll.run_submitted",
      entityType: "payroll_run",
      entityId: runId,
      actorId: actorId ?? undefined,
      before: { status: "DRAFT" },
      after: { status: "PENDING_APPROVAL", lineCount: lines.length, net: submitted.netTotal },
    });
    return submitted;
  }

  /**
   * Approve (SoD): stamps approved_at/by while the status STAYS
   * PENDING_APPROVAL — posting is the separate, audited step (the run
   * posting service checks the stamp).
   */
  async approve(runId: string, actorId: string): Promise<RunRow> {
    const run = await store.findRunById(runId);
    if (run === undefined) throw new RunNotFoundError(runId);
    if (run.status !== "PENDING_APPROVAL") {
      throw new RunImmutableError({
        runId,
        status: run.status,
        action: "approve (only PENDING_APPROVAL runs accept the stamp)",
      });
    }
    if (run.approvedAt !== null) {
      throw new RunImmutableError({
        runId,
        status: run.status,
        action: "approve (already approved — post next)",
      });
    }
    if (run.createdBy !== null && run.createdBy === actorId) {
      throw new RunSelfApprovalError({ runId, actorId });
    }
    const approved = await store.updateRun(runId, {
      approvedAt: new Date().toISOString(),
      approvedBy: actorId,
    });
    await this.audit.record({
      action: "payroll.run_approved",
      entityType: "payroll_run",
      entityId: runId,
      actorId,
      before: { status: run.status, approvedAt: null },
      after: { status: approved.status, approvedAt: approved.approvedAt },
    });
    return approved;
  }
}
