import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { EmployeeNotFoundError } from "../domain/hr-errors";
import {
  CertificationNotFoundError,
  DuplicateEnrollmentError,
  TalentCodeTakenError,
  TalentInvalidError,
  TrainingProgramNotFoundError,
  TrainingEnrollmentNotFoundError,
} from "../domain/talent-errors";
import * as store from "../infrastructure/talent-training.store";
import { findEmployeeBrief } from "../infrastructure/talent-org.store";
import type {
  CertificationRow,
  TrainingEnrollmentRow,
  TrainingProgramRow,
} from "../infrastructure/talent-training.store";

/**
 * PHASE-047 (W-3 — T-08, the training half) — the training engine:
 * the program catalog (internal/external, provider, the cost — an
 * EXACT 2-dp decimal string, ADR-0009's money law extended to the
 * training budget figure; the RETIRED soft lifecycle), the
 * enrollments (the (program, employee) natural key — one record per
 * pair, the typed 409 on a duplicate; the status ladder ENROLLED→
 * IN_PROGRESS→COMPLETED/WITHDRAWN; the completion act stamps
 * completed_at with the result), and the certification register
 * (issuer + the issue/expiry window; renewal is the UPDATE — no
 * DELETE, the register is the compliance record; the expiry feeds
 * the sweep with issuer and expiry intact — acceptance #4).
 *
 * Ledger-free by design (D-05): the cost is money-ADJACENT data —
 * stored exact, never posted.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[\w\-. ]{1,64}$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const MONEY_RE = /^\d{1,15}(\.\d{1,4})?$/;
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;

const ENROLLMENT_STATUSES = new Set(["ENROLLED", "IN_PROGRESS", "COMPLETED", "WITHDRAWN"]);
const ENROLLMENT_RESULTS = new Set(["PENDING", "PASSED", "FAILED"]);
const PROGRAM_STATUSES = new Set(["ACTIVE", "RETIRED"]);

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

/** The 2-dp-family decimal string law (exact, never float — the
 * pctString precedent; money at up to 4-dp per numeric(19,4)). */
function decimalString(value: string, what: string, max: number, regex: RegExp): string {
  if (!regex.test(value)) {
    throw new TalentInvalidError(`${what} must be a decimal string: ${value}`);
  }
  if (Number(value) > max) {
    throw new TalentInvalidError(`${what} must be within [0 … ${max}]: ${value}`);
  }
  return value;
}

@Injectable()
export class TalentTrainingService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // ── training programs (the catalog) ──────────────────────────────────────

  async createProgram(input: {
    code: string;
    name: string;
    nameAr: string | null;
    kind: string;
    provider: string | null;
    cost: string | null;
    notes: string | null;
    actorId: string | null;
  }): Promise<TrainingProgramRow> {
    if (!CODE_RE.test(input.code)) {
      throw new TalentInvalidError(
        `the program code must be 1–64 characters of letters/digits/dash/dot/space: ${input.code}`,
      );
    }
    if (input.name.trim().length < 1 || input.name.length > 160) {
      throw new TalentInvalidError("the program name must be 1–160 characters");
    }
    if (input.kind !== "INTERNAL" && input.kind !== "EXTERNAL") {
      throw new TalentInvalidError(`kind must be INTERNAL or EXTERNAL: ${input.kind}`);
    }
    if (input.cost !== null) {
      decimalString(input.cost, "cost", 1_000_000_000, MONEY_RE);
    }
    if ((await store.findProgramByCode(input.code)) !== undefined) {
      throw new TalentCodeTakenError("program", input.code);
    }
    const created = await store.insertProgram({
      code: input.code,
      name: input.name.trim(),
      nameAr: input.nameAr,
      kind: input.kind,
      provider: input.provider,
      cost: input.cost,
      notes: input.notes,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.training_program_created",
      entityType: "training_program",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { code: created.code, name: created.name, kind: created.kind, cost: created.cost },
    });
    return created;
  }

  async getProgram(programId: string): Promise<TrainingProgramRow> {
    const program = await store.findProgramById(requireUuid(programId, "programId"));
    if (program === undefined) throw new TrainingProgramNotFoundError(programId);
    return program;
  }

  async listPrograms(filter: { status?: string; limit?: number }): Promise<TrainingProgramRow[]> {
    if (filter.status !== undefined && !PROGRAM_STATUSES.has(filter.status)) {
      throw new TalentInvalidError(`status must be ACTIVE or RETIRED: ${filter.status}`);
    }
    return store.listPrograms({
      ...(filter.status === undefined ? {} : { status: filter.status }),
      limit: Math.min(Math.max(filter.limit ?? 50, 1), 200),
    });
  }

  async updateProgram(input: {
    id: string;
    name?: string;
    nameAr?: string | null;
    provider?: string | null;
    cost?: string | null;
    status?: string;
    notes?: string | null;
    actorId: string | null;
  }): Promise<TrainingProgramRow> {
    const id = requireUuid(input.id, "programId");
    const program = await store.findProgramById(id);
    if (program === undefined) throw new TrainingProgramNotFoundError(input.id);
    if (input.name !== undefined && (input.name.trim().length < 1 || input.name.length > 160)) {
      throw new TalentInvalidError("the program name must be 1–160 characters");
    }
    if (input.cost !== undefined && input.cost !== null) {
      decimalString(input.cost, "cost", 1_000_000_000, MONEY_RE);
    }
    if (input.status !== undefined && !PROGRAM_STATUSES.has(input.status)) {
      throw new TalentInvalidError(`status must be ACTIVE or RETIRED: ${input.status}`);
    }
    const updated = await store.updateProgram({
      id,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.cost === undefined ? {} : { cost: input.cost }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    });
    await this.audit.record({
      action: "hr.training_program_updated",
      entityType: "training_program",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { status: updated?.status, cost: updated?.cost },
    });
    return updated!;
  }

  // ── training enrollments (the per-(program, employee) record) ────────────

  async enroll(input: {
    programId: string;
    employeeId: string;
    notes: string | null;
    actorId: string | null;
  }): Promise<TrainingEnrollmentRow> {
    const programId = requireUuid(input.programId, "programId");
    const employeeId = requireUuid(input.employeeId, "employeeId");
    const program = await store.findProgramById(programId);
    if (program === undefined) throw new TrainingProgramNotFoundError(input.programId);
    if (program.status !== "ACTIVE") {
      throw new TalentInvalidError(
        `training program ${input.programId} is ${program.status} — only ACTIVE programs take enrollments`,
      );
    }
    if ((await findEmployeeBrief(employeeId)) === undefined) {
      throw new EmployeeNotFoundError(input.employeeId);
    }
    const created = await store.insertEnrollment({
      programId,
      employeeId,
      notes: input.notes,
      createdBy: input.actorId,
    });
    if (created === undefined) {
      throw new DuplicateEnrollmentError(programId, employeeId);
    }
    await this.audit.record({
      action: "hr.training_enrolled",
      entityType: "training_enrollment",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { programId, employeeId, status: "ENROLLED" },
    });
    return created;
  }

  async getEnrollment(enrollmentId: string): Promise<TrainingEnrollmentRow> {
    const enrollment = await store.findEnrollmentById(requireUuid(enrollmentId, "enrollmentId"));
    if (enrollment === undefined) throw new TrainingEnrollmentNotFoundError(enrollmentId);
    return enrollment;
  }

  async listEnrollments(filter: {
    programId?: string;
    employeeId?: string;
    limit?: number;
  }): Promise<TrainingEnrollmentRow[]> {
    return store.listEnrollments({
      ...(filter.programId === undefined
        ? {}
        : { programId: requireUuid(filter.programId, "programId") }),
      ...(filter.employeeId === undefined
        ? {}
        : { employeeId: requireUuid(filter.employeeId, "employeeId") }),
      limit: Math.min(Math.max(filter.limit ?? 50, 1), 200),
    });
  }

  /**
   * The enrollment update — the status ladder + the attendance/
   * completion percentages + the result. The COMPLETED edge is the
   * completion act (acceptance #4): completed_at stamps with the
   * result in the same write. WITHDRAWN is the soft path (no DELETE —
   * the 0097 evidence discipline).
   */
  async updateEnrollment(input: {
    id: string;
    status?: string;
    attendancePct?: string | null;
    completionPct?: string | null;
    result?: string | null;
    notes?: string | null;
    actorId: string | null;
  }): Promise<TrainingEnrollmentRow> {
    const id = requireUuid(input.id, "enrollmentId");
    const enrollment = await store.findEnrollmentById(id);
    if (enrollment === undefined) throw new TrainingEnrollmentNotFoundError(input.id);
    if (enrollment.status === "WITHDRAWN") {
      throw new TalentInvalidError(
        `training enrollment ${input.id} is WITHDRAWN — a withdrawn record is terminal (the 0097 evidence discipline; re-enrollment is a NEW record after the program re-activates)`,
      );
    }
    if (input.status !== undefined && !ENROLLMENT_STATUSES.has(input.status)) {
      throw new TalentInvalidError(
        `status must be one of ENROLLED/IN_PROGRESS/COMPLETED/WITHDRAWN: ${input.status}`,
      );
    }
    if (input.attendancePct !== undefined && input.attendancePct !== null) {
      decimalString(input.attendancePct, "attendancePct", 100, PCT_RE);
    }
    if (input.completionPct !== undefined && input.completionPct !== null) {
      decimalString(input.completionPct, "completionPct", 100, PCT_RE);
    }
    if (input.result !== undefined && input.result !== null && !ENROLLMENT_RESULTS.has(input.result)) {
      throw new TalentInvalidError(`result must be one of PENDING/PASSED/FAILED: ${input.result}`);
    }
    const updated = await store.updateEnrollment({
      id,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.attendancePct === undefined ? {} : { attendancePct: input.attendancePct }),
      ...(input.completionPct === undefined ? {} : { completionPct: input.completionPct }),
      ...(input.result === undefined ? {} : { result: input.result }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    });
    await this.audit.record({
      action: "hr.training_enrollment_updated",
      entityType: "training_enrollment",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: enrollment.status },
      after: { status: updated?.status, result: updated?.result, completedAt: updated?.completedAt },
    });
    return updated!;
  }

  // ── certifications (the register + the sweep's probe) ────────────────────

  async registerCertification(input: {
    employeeId: string;
    name: string;
    nameAr: string | null;
    issuer: string;
    issueDate: string;
    expiryDate: string | null;
    certificateNumber: string | null;
    notes: string | null;
    actorId: string | null;
  }): Promise<CertificationRow> {
    const employeeId = requireUuid(input.employeeId, "employeeId");
    if ((await findEmployeeBrief(employeeId)) === undefined) {
      throw new EmployeeNotFoundError(input.employeeId);
    }
    if (input.name.trim().length < 1 || input.name.length > 160) {
      throw new TalentInvalidError("the certification name must be 1–160 characters");
    }
    if (input.issuer.trim().length < 1 || input.issuer.length > 160) {
      throw new TalentInvalidError("the issuer must be 1–160 characters");
    }
    const issueDate = isoDate(input.issueDate, "issueDate");
    const expiryDate = input.expiryDate === null ? null : isoDate(input.expiryDate, "expiryDate");
    if (expiryDate !== null && expiryDate <= issueDate) {
      throw new TalentInvalidError(
        `the certification window is inverted: issued ${issueDate}, expires ${expiryDate} (expiry must be after the issue date)`,
      );
    }
    const created = await store.insertCertification({
      employeeId,
      name: input.name.trim(),
      nameAr: input.nameAr,
      issuer: input.issuer.trim(),
      issueDate,
      expiryDate,
      certificateNumber: input.certificateNumber,
      notes: input.notes,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.certification_registered",
      entityType: "certification",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        employeeId,
        name: created.name,
        issuer: created.issuer,
        issueDate,
        expiryDate,
      },
    });
    return created;
  }

  async getCertification(certificationId: string): Promise<CertificationRow> {
    const certification = await store.findCertificationById(
      requireUuid(certificationId, "certificationId"),
    );
    if (certification === undefined) throw new CertificationNotFoundError(certificationId);
    return certification;
  }

  async listCertifications(filter: {
    employeeId?: string;
    limit?: number;
  }): Promise<CertificationRow[]> {
    return store.listCertifications({
      ...(filter.employeeId === undefined
        ? {}
        : { employeeId: requireUuid(filter.employeeId, "employeeId") }),
      limit: Math.min(Math.max(filter.limit ?? 100, 1), 500),
    });
  }

  /** The renewal act — the register's UPDATE path (issuer and expiry
   * stay intact through the sweep: acceptance #4's own law). */
  async renewCertification(input: {
    id: string;
    issuer?: string;
    issueDate?: string;
    expiryDate?: string | null;
    certificateNumber?: string | null;
    notes?: string | null;
    actorId: string | null;
  }): Promise<CertificationRow> {
    const id = requireUuid(input.id, "certificationId");
    const certification = await store.findCertificationById(id);
    if (certification === undefined) throw new CertificationNotFoundError(input.id);
    if (input.issuer !== undefined && (input.issuer.trim().length < 1 || input.issuer.length > 160)) {
      throw new TalentInvalidError("the issuer must be 1–160 characters");
    }
    const issueDate =
      input.issueDate === undefined ? certification.issueDate : isoDate(input.issueDate, "issueDate");
    const expiryDate =
      input.expiryDate === undefined
        ? certification.expiryDate
        : input.expiryDate === null
          ? null
          : isoDate(input.expiryDate, "expiryDate");
    if (expiryDate !== null && expiryDate <= issueDate) {
      throw new TalentInvalidError(
        `the certification window is inverted: issued ${issueDate}, expires ${expiryDate}`,
      );
    }
    const updated = await store.updateCertification({
      id,
      ...(input.issuer === undefined ? {} : { issuer: input.issuer }),
      ...(input.issueDate === undefined ? {} : { issueDate }),
      ...(input.expiryDate === undefined ? {} : { expiryDate }),
      ...(input.certificateNumber === undefined ? {} : { certificateNumber: input.certificateNumber }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    });
    await this.audit.record({
      action: "hr.certification_renewed",
      entityType: "certification",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { expiryDate: certification.expiryDate },
      after: { expiryDate: updated?.expiryDate, issuer: updated?.issuer },
    });
    return updated!;
  }
}
