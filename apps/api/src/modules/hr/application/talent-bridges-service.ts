import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  buildBridgeJson,
  type BridgeExportFormat,
  type BridgeExportLocale,
  type BridgeImportRejection,
  type BridgeImportReport,
  type BridgeImportReportEntry,
  type TrainingImportRow,
  renderBridgeCsv,
  validateAppraisalImportRow,
  validateTrainingImportRow,
  BRIDGE_IMPORT_MAX_ROWS,
} from "../domain/talent-bridge";
import {
  BridgeImportInvalidError,
  CompetencyLevelNotFoundError,
  CompetencyNotFoundError,
  CycleStateConflictError,
  DuplicateEnrollmentError,
  GoalWeightsInvalidError,
  ReviewAlreadySubmittedError,
  TalentCycleNotFoundError,
  TalentInvalidError,
} from "../domain/talent-errors";
import * as bridgeStore from "../infrastructure/talent-bridges.store";
import * as store from "../infrastructure/talent.store";
import * as trainingStore from "../infrastructure/talent-training.store";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { TalentPerformanceService } from "./talent-performance-service";
import { TalentTrainingService } from "./talent-training-service";

/**
 * PHASE-047 (W-4 — T-10, D-07) — the external HR bridges service: the
 * three export contracts (CSV/JSON — the 046 remittance-export
 * precedent: read-only, audited, the file STREAMS from the controller
 * under @Res(), bytes not envelope) + the two import paths with
 * ROW-LEVEL VALIDATION REPORTS (the attendance-import precedent's
 * discipline: every row validated PURE first, then resolved, then
 * ridden through the SAME machinery the in-app surfaces ride — the
 * laws are literally the same code paths).
 *
 * THE EXPORT LAWS:
 * - A-4 (the PII cross-check): the field lists are the documented
 *   contracts' columns (domain/talent-bridge.ts) — employee code +
 *   name; NEVER national_id/bank/document numbers/nationality/
 *   probation_end; no free-form notes; no payroll money axes. The
 *   unit spec pins the lists structurally; the store projects exactly
 *   them.
 * - BR-090 at the bridge: the appraisal contract ships the MANAGER
 *   outcomes only — the 360 input rows never enter an export and no
 *   reviewer column exists (an attributed source never leaves).
 * - READ-ONLY + AUDITED (the remittance precedent): the export writes
 *   NOTHING but its audit event.
 * - D-01: the employees substrate is read under RLS, never written.
 *
 * THE IMPORT LAWS (acceptance #9's bad-row report):
 * - FILE-LEVEL refusals are the typed 4xx family (unknown cycle →
 *   404; a non-ACTIVE cycle → 409; a malformed/oversized/empty batch →
 *   the 422 BRIDGE_IMPORT_INVALID) — the whole import refuses BEFORE
 *   any row.
 * - ROW-LEVEL: each row is validated PURE (shape → INVALID_FIELD /
 *   SELF_KIND_MISMATCH), resolved on the code axes (unknown →
 *   UNKNOWN_*), deduplicated in-file (the first occurrence proceeds,
 *   the rest → DUPLICATE_IN_FILE — the attendance import's collapse
 *   law), then rides the in-app machinery with the typed refusals
 *   mapped to report reasons (ALREADY_SUBMITTED, GOAL_WEIGHTS_INVALID
 *   (BR-089), UNKNOWN_COMPETENCY, LEVEL_INVALID, NOT_IN_CYCLE_SCOPE,
 *   ALREADY_COMPLETED, ENROLLMENT_WITHDRAWN, PROGRAM_RETIRED). A
 *   rejected row never aborts the file — the report is the deliverable.
 * - IDEMPOTENCE: a training row whose enrollment is already COMPLETED
 *   rejects ALREADY_COMPLETED (never a silent re-stamp of the
 *   compliance record's completed_at); an appraisal row whose natural
 *   key holds SUBMITTED/CALIBRATED rejects ALREADY_SUBMITTED (the
 *   submitted review's immutability — the same CAS law).
 * - One audit event per import (the batch act: kind, totals,
 *   accepted/rejected); the per-act audits ride the underlying
 *   services (hr.review_submitted / hr.training_enrollment_updated —
 *   the actor is the importing administrator).
 *
 * No live connectors (the integrations README's law): the bridges are
 * the documented file contracts; PHASE-055's public API platform is
 * the live-connector substrate.
 */

const CONTRACT_SLUGS: Record<string, string> = {
  "hr.employee-master": "hr-employee-master",
  "hr.employment-org-snapshot": "hr-employment-org-snapshot",
  "hr.appraisal-results": "hr-appraisal-results",
};

export type BridgeContractId =
  | "hr.employee-master"
  | "hr.employment-org-snapshot"
  | "hr.appraisal-results";

@Injectable()
export class TalentBridgesService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TalentPerformanceService) private readonly performance: TalentPerformanceService,
    @Inject(TalentTrainingService) private readonly training: TalentTrainingService,
  ) {}

  // ── the three export contracts (read-only + audited) ─────────────────────

  /**
   * Render one bridge contract as CSV or JSON. The rows come from the
   * bridges store's read-only queries (RLS ambient); the rendering is
   * the pure layer; the generation is AUDITED (contract, format,
   * locale, rowCount — the evidence a bridge file left the platform).
   */
  async exportContract(input: {
    contract: BridgeContractId;
    format: BridgeExportFormat;
    locale: BridgeExportLocale;
    cycleId?: string;
    actorId: string | null;
  }): Promise<{
    contentType: string;
    filename: string;
    bytes: Buffer;
    rowCount: number;
  }> {
    const generatedAt = new Date().toISOString();
    const rows = await this.contractRows(input.contract, input.cycleId);
    const bytes =
      input.format === "csv"
        ? renderBridgeCsv({
            contractId: input.contract,
            locale: input.locale,
            generatedAt,
            rows: rows as never,
          })
        : Buffer.from(
            JSON.stringify(
              buildBridgeJson({
                contractId: input.contract,
                locale: input.locale,
                generatedAt,
                rows: rows as never,
              }),
              null,
              2,
            ),
            "utf8",
          );
    const contentType =
      input.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";
    const filename = `${CONTRACT_SLUGS[input.contract]}-${generatedAt.slice(0, 10)}.${input.format}`;
    await this.audit.record({
      action: "hr.bridge_exported",
      entityType: "hr_bridge",
      // The act's subject is the tenant's data as a whole (entity_id is
      // a uuid column — the tenant id IS the export's scope; the
      // contract discriminator rides `after`).
      entityId: requireTenantContext().tenantId,
      actorId: input.actorId ?? undefined,
      after: {
        contract: input.contract,
        format: input.format,
        locale: input.locale,
        rowCount: rows.length,
        ...(input.cycleId === undefined ? {} : { cycleId: input.cycleId }),
      },
    });
    return { contentType, filename, bytes, rowCount: rows.length };
  }

  private async contractRows(contract: BridgeContractId, cycleId?: string) {
    if (contract === "hr.employee-master") {
      return bridgeStore.listEmployeeMasterRows();
    }
    if (contract === "hr.employment-org-snapshot") {
      return bridgeStore.listEmploymentOrgSnapshotRows();
    }
    const resolvedCycle =
      cycleId === undefined ? undefined : requireCycleUuid(cycleId);
    if (resolvedCycle !== undefined) {
      // The typed 404 for an unknown/foreign cycle id (A7 parity) —
      // the contract refuses rather than silently shipping an empty
      // file for a typo'd id.
      const cycle = await store.findCycleById(resolvedCycle);
      if (cycle === undefined) throw new TalentCycleNotFoundError(resolvedCycle);
    }
    return bridgeStore.listAppraisalResultsRows(resolvedCycle);
  }

  // ── import 1: appraisal results (rides the submission machinery) ────────

  /**
   * THE APPRAISAL-RESULTS IMPORT (acceptance #9): one ACTIVE cycle's
   * external appraisal rows, each validated per-row and reported
   * accepted/rejected with TYPED reasons. The reviewer/reviewee axes
   * resolve from employee CODES; the scorecard keys are competency
   * CODES (translated to the natural-key ids before riding
   * `submitReview` — the same validation-first + BR-089 + draft-upsert
   * + submit-CAS laws the in-app surface rides; the reviewer identity
   * is the DATA's own, the external system's manager — the acting
   * user is the importing administrator on hr.performance.manage).
   */
  async importAppraisalResults(input: {
    cycleId: string;
    rows: readonly unknown[];
    actorId: string | null;
  }): Promise<BridgeImportReport> {
    if (!/^[0-9a-fA-F-]{36}$/.test(input.cycleId)) {
      throw new TalentInvalidError(`cycleId must be a uuid: ${input.cycleId}`);
    }
    if (input.rows.length === 0 || input.rows.length > BRIDGE_IMPORT_MAX_ROWS) {
      throw new BridgeImportInvalidError(
        `the import batch must carry 1…${BRIDGE_IMPORT_MAX_ROWS} rows: ${input.rows.length}`,
      );
    }
    // The file-level law: the submission window (an ACTIVE cycle) —
    // the whole import refuses BEFORE any row.
    const cycle = await store.findCycleById(input.cycleId);
    if (cycle === undefined) throw new TalentCycleNotFoundError(input.cycleId);
    if (cycle.status !== "ACTIVE") {
      throw new CycleStateConflictError(
        input.cycleId,
        cycle.status,
        "import appraisal results (reviews submit only while the cycle is ACTIVE)",
      );
    }
    // Batch-resolve the code axes (one read each) + the competency
    // dictionary's code map (the translation substrate).
    const shaped = input.rows.map((raw, index) => ({ index, raw }));
    const codeProbe: string[] = [];
    const competencyProbe: string[] = [];
    for (const entry of shaped) {
      const probe = validateAppraisalImportRow(entry.raw);
      if (probe.ok) {
        codeProbe.push(probe.row.revieweeCode, probe.row.reviewerCode);
        competencyProbe.push(...Object.keys(probe.row.competencyScores));
      }
    }
    const employeeIds = await bridgeStore.employeeIdsByCodes(codeProbe);
    const competencies = await competenciesByCodes(competencyProbe);

    const reportRows: BridgeImportReportEntry[] = [];
    let acceptedCount = 0;
    const seenNaturalKeys = new Set<string>();
    for (const entry of shaped) {
      const validation = validateAppraisalImportRow(entry.raw);
      if (!validation.ok) {
        reportRows.push(rejected(entry.index, entry.raw, validation.reason, validation.detail));
        continue;
      }
      const row = validation.row;
      // The in-file collapse law: the first occurrence of a natural
      // key proceeds; the rest reject (nothing lands twice, nothing
      // silently).
      const naturalKey = `${row.revieweeCode}|${row.reviewerCode}|${row.kind}`;
      if (seenNaturalKeys.has(naturalKey)) {
        reportRows.push(
          rejected(
            entry.index,
            entry.raw,
            "DUPLICATE_IN_FILE",
            `the natural key (reviewee ${row.revieweeCode}, reviewer ${row.reviewerCode}, kind ${row.kind}) already rode an earlier row of this file`,
          ),
        );
        continue;
      }
      seenNaturalKeys.add(naturalKey);
      const revieweeId = employeeIds.get(row.revieweeCode);
      if (revieweeId === undefined) {
        reportRows.push(
          rejected(
            entry.index,
            entry.raw,
            "UNKNOWN_REVIEWEE",
            `employee code ${row.revieweeCode} does not exist in this tenant`,
          ),
        );
        continue;
      }
      const reviewerId = employeeIds.get(row.reviewerCode);
      if (reviewerId === undefined) {
        reportRows.push(
          rejected(
            entry.index,
            entry.raw,
            "UNKNOWN_REVIEWER",
            `employee code ${row.reviewerCode} does not exist in this tenant`,
          ),
        );
        continue;
      }
      // The scorecard translation: competency CODE → the id the
      // submission law validates (unknown or inactive codes reject —
      // the same law the in-app surface enforces, surfaced as the
      // report's own reason).
      const translatedScores: Record<string, number> = {};
      let unknownCompetency: string | null = null;
      for (const [code, level] of Object.entries(row.competencyScores)) {
        const competency = competencies.get(code);
        if (competency === undefined) {
          unknownCompetency = code;
          break;
        }
        translatedScores[competency.id] = level;
      }
      if (unknownCompetency !== null) {
        reportRows.push(
          rejected(
            entry.index,
            entry.raw,
            "UNKNOWN_COMPETENCY",
            `competency code ${unknownCompetency} does not exist (or is inactive) in this tenant`,
          ),
        );
        continue;
      }
      // The scope law's own reason (the honest out-of-scope refusal —
      // submitReview re-checks it, the defense-in-depth pair).
      if (!(await store.employeeInCycleScope(cycle.scopeOrgUnitIds, revieweeId))) {
        reportRows.push(
          rejected(
            entry.index,
            entry.raw,
            "NOT_IN_CYCLE_SCOPE",
            `reviewee ${row.revieweeCode} is not in the cycle's participant scope`,
          ),
        );
        continue;
      }
      try {
        const submitted = await this.performance.submitReview({
          reviewerEmployeeId: reviewerId,
          cycleId: input.cycleId,
          revieweeEmployeeId: revieweeId,
          kind: row.kind,
          overallScore: row.overallScore,
          competencyScores: translatedScores,
          comments: row.comments,
          actorId: input.actorId,
        });
        acceptedCount += 1;
        reportRows.push({
          index: entry.index,
          status: "ACCEPTED",
          row: entry.raw,
          reviewId: submitted.id,
        });
      } catch (error) {
        const mapped = mapAppraisalRejection(error);
        if (mapped === undefined) throw error;
        reportRows.push(rejected(entry.index, entry.raw, mapped.reason, mapped.detail));
      }
    }
    const report: BridgeImportReport = {
      kind: "appraisal-results",
      totalCount: input.rows.length,
      acceptedCount,
      rejectedCount: input.rows.length - acceptedCount,
      rows: reportRows,
    };
    await this.audit.record({
      action: "hr.bridge_import_run",
      entityType: "hr_bridge",
      entityId: requireTenantContext().tenantId,
      actorId: input.actorId ?? undefined,
      after: {
        kind: "appraisal-results",
        cycleId: input.cycleId,
        totalCount: report.totalCount,
        acceptedCount: report.acceptedCount,
        rejectedCount: report.rejectedCount,
      },
    });
    return report;
  }

  // ── import 2: training completions (rides the enrollment machinery) ─────

  /**
   * THE TRAINING-COMPLETIONS IMPORT (acceptance #9): external
   * completion rows, each validated per-row and reported with TYPED
   * reasons. A row without an enrollment ENROLLS then COMPLETES (the
   * same acts the in-app surface rides); an existing ENROLLED/
   * IN_PROGRESS row COMPLETES; a COMPLETED row rejects
   * ALREADY_COMPLETED (the compliance record's completed_at is never
   * silently re-stamped); a WITHDRAWN row rejects (terminal).
   */
  async importTrainingCompletions(input: {
    rows: readonly unknown[];
    actorId: string | null;
  }): Promise<BridgeImportReport> {
    if (input.rows.length === 0 || input.rows.length > BRIDGE_IMPORT_MAX_ROWS) {
      throw new BridgeImportInvalidError(
        `the import batch must carry 1…${BRIDGE_IMPORT_MAX_ROWS} rows: ${input.rows.length}`,
      );
    }
    const shaped = input.rows.map((raw, index) => ({ index, raw }));
    const employeeProbe: string[] = [];
    const programProbe: string[] = [];
    for (const entry of shaped) {
      const probe = validateTrainingImportRow(entry.raw);
      if (probe.ok) {
        employeeProbe.push(probe.row.employeeCode);
        programProbe.push(probe.row.programCode);
      }
    }
    const employeeIds = await bridgeStore.employeeIdsByCodes(employeeProbe);
    const programs = await bridgeStore.programsByCodes(programProbe);

    const reportRows: BridgeImportReportEntry[] = [];
    let acceptedCount = 0;
    const seenNaturalKeys = new Set<string>();
    for (const entry of shaped) {
      const validation = validateTrainingImportRow(entry.raw);
      if (!validation.ok) {
        reportRows.push(rejected(entry.index, entry.raw, validation.reason, validation.detail));
        continue;
      }
      const row = validation.row;
      const naturalKey = `${row.programCode}|${row.employeeCode}`;
      if (seenNaturalKeys.has(naturalKey)) {
        reportRows.push(
          rejected(
            entry.index,
            entry.raw,
            "DUPLICATE_IN_FILE",
            `the natural key (program ${row.programCode}, employee ${row.employeeCode}) already rode an earlier row of this file`,
          ),
        );
        continue;
      }
      seenNaturalKeys.add(naturalKey);
      const program = programs.get(row.programCode);
      if (program === undefined) {
        reportRows.push(
          rejected(
            entry.index,
            entry.raw,
            "UNKNOWN_PROGRAM",
            `training program code ${row.programCode} does not exist in this tenant`,
          ),
        );
        continue;
      }
      if (program.status !== "ACTIVE") {
        reportRows.push(
          rejected(
            entry.index,
            entry.raw,
            "PROGRAM_RETIRED",
            `training program ${row.programCode} is ${program.status} — only ACTIVE programs take enrollments`,
          ),
        );
        continue;
      }
      const employeeId = employeeIds.get(row.employeeCode);
      if (employeeId === undefined) {
        reportRows.push(
          rejected(
            entry.index,
            entry.raw,
            "UNKNOWN_EMPLOYEE",
            `employee code ${row.employeeCode} does not exist in this tenant`,
          ),
        );
        continue;
      }
      try {
        const enrollmentId = await this.completeEnrollment(row, program.id, employeeId, input.actorId);
        acceptedCount += 1;
        reportRows.push({
          index: entry.index,
          status: "ACCEPTED",
          row: entry.raw,
          enrollmentId,
        });
      } catch (error) {
        const mapped = mapTrainingRejection(error);
        if (mapped === undefined) throw error;
        reportRows.push(rejected(entry.index, entry.raw, mapped.reason, mapped.detail));
      }
    }
    const report: BridgeImportReport = {
      kind: "training-completions",
      totalCount: input.rows.length,
      acceptedCount,
      rejectedCount: input.rows.length - acceptedCount,
      rows: reportRows,
    };
    await this.audit.record({
      action: "hr.bridge_import_run",
      entityType: "hr_bridge",
      entityId: requireTenantContext().tenantId,
      actorId: input.actorId ?? undefined,
      after: {
        kind: "training-completions",
        totalCount: report.totalCount,
        acceptedCount: report.acceptedCount,
        rejectedCount: report.rejectedCount,
      },
    });
    return report;
  }

  /** The completion act: enroll when no record exists, then the
   * COMPLETED update (the same acts the in-app surface rides). */
  private async completeEnrollment(
    row: TrainingImportRow,
    programId: string,
    employeeId: string,
    actorId: string | null,
  ): Promise<string> {
    const existing = await trainingStore.findEnrollmentByNaturalKey({ programId, employeeId });
    if (existing !== undefined) {
      if (existing.status === "COMPLETED") {
        throw new BridgeRowRejectedError(
          "ALREADY_COMPLETED",
          `the enrollment (program ${row.programCode}, employee ${row.employeeCode}) is already COMPLETED — the compliance record's completed_at is never re-stamped`,
        );
      }
      if (existing.status === "WITHDRAWN") {
        throw new BridgeRowRejectedError(
          "ENROLLMENT_WITHDRAWN",
          `the enrollment (program ${row.programCode}, employee ${row.employeeCode}) is WITHDRAWN — a withdrawn record is terminal`,
        );
      }
      const updated = await this.training.updateEnrollment({
        id: existing.id,
        status: "COMPLETED",
        attendancePct: row.attendancePct,
        completionPct: row.completionPct,
        result: row.result,
        notes: row.notes,
        actorId,
      });
      return updated.id;
    }
    // No record: enroll then complete — a raced duplicate enroll
    // resolves by the existing row's state (the honest re-read).
    let enrollmentId: string;
    try {
      const enrolled = await this.training.enroll({
        programId,
        employeeId,
        notes: null,
        actorId,
      });
      enrollmentId = enrolled.id;
    } catch (error) {
      if (error instanceof DuplicateEnrollmentError) {
        const raced = await trainingStore.findEnrollmentByNaturalKey({ programId, employeeId });
        if (raced === undefined) throw error;
        if (raced.status === "COMPLETED") {
          throw new BridgeRowRejectedError(
            "ALREADY_COMPLETED",
            `the enrollment (program ${row.programCode}, employee ${row.employeeCode}) completed concurrently — the compliance record's completed_at is never re-stamped`,
          );
        }
        if (raced.status === "WITHDRAWN") {
          throw new BridgeRowRejectedError(
            "ENROLLMENT_WITHDRAWN",
            `the enrollment (program ${row.programCode}, employee ${row.employeeCode}) withdrew concurrently — a withdrawn record is terminal`,
          );
        }
        enrollmentId = raced.id;
      } else {
        throw error;
      }
    }
    const updated = await this.training.updateEnrollment({
      id: enrollmentId,
      status: "COMPLETED",
      attendancePct: row.attendancePct,
      completionPct: row.completionPct,
      result: row.result,
      notes: row.notes,
      actorId,
    });
    return updated.id;
  }
}

// ── the rejection plumbing ─────────────────────────────────────────────────

/**
 * The row-level rejection carrier (INTERNAL to the import path): the
 * typed reason + detail the report renders. Never an HTTP error —
 * the report is the deliverable.
 */
class BridgeRowRejectedError extends Error {
  constructor(
    readonly reason: BridgeImportRejection,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "BridgeRowRejectedError";
  }
}

function rejected(
  index: number,
  row: unknown,
  reason: BridgeImportRejection,
  detail: string,
): BridgeImportReportEntry {
  return { index, status: "REJECTED", reason, detail, row };
}

function mapAppraisalRejection(
  error: unknown,
): { reason: BridgeImportRejection; detail: string } | undefined {
  if (error instanceof BridgeRowRejectedError) {
    return { reason: error.reason, detail: error.detail };
  }
  if (error instanceof ReviewAlreadySubmittedError) {
    return {
      reason: "ALREADY_SUBMITTED",
      detail: "the natural key already holds a SUBMITTED/CALIBRATED review — immutable until calibration",
    };
  }
  if (error instanceof GoalWeightsInvalidError) {
    return {
      reason: "GOAL_WEIGHTS_INVALID",
      detail: error.message,
    };
  }
  if (error instanceof CompetencyNotFoundError) {
    return { reason: "UNKNOWN_COMPETENCY", detail: error.message };
  }
  if (error instanceof CompetencyLevelNotFoundError) {
    return { reason: "LEVEL_INVALID", detail: error.message };
  }
  if (error instanceof TalentInvalidError) {
    return { reason: "INVALID_FIELD", detail: error.message };
  }
  return undefined;
}

function mapTrainingRejection(
  error: unknown,
): { reason: BridgeImportRejection; detail: string } | undefined {
  if (error instanceof BridgeRowRejectedError) {
    return { reason: error.reason, detail: error.detail };
  }
  if (error instanceof TalentInvalidError) {
    return { reason: "INVALID_FIELD", detail: error.message };
  }
  return undefined;
}

/** Batch competency code map (the scorecard translation's substrate —
 * one read per distinct code; inactive codes never enter the map and
 * reject at the translation — the in-app law's own treatment). */
async function competenciesByCodes(
  codes: readonly string[],
): Promise<Map<string, { id: string; code: string; active: boolean }>> {
  const map = new Map<string, { id: string; code: string; active: boolean }>();
  for (const code of new Set(codes)) {
    const competency = await store.findCompetencyByCode(code);
    if (competency !== undefined && competency.active) {
      map.set(code, { id: competency.id, code, active: true });
    }
  }
  return map;
}

function requireCycleUuid(value: string): string {
  if (!/^[0-9a-fA-F-]{36}$/.test(value)) {
    throw new TalentInvalidError(`cycleId must be a uuid: ${value}`);
  }
  return value;
}
