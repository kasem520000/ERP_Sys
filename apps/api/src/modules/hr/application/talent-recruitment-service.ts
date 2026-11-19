import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { EmployeeNotFoundError } from "../domain/hr-errors";
import {
  ApplicantAlreadyHiredError,
  ApplicantNotHireableError,
  ApplicantNotFoundError,
  InterviewNotPanelistError,
  InterviewNotFoundError,
  InterviewSlotTakenError,
  ReopenInvalidError,
  StageTransitionInvalidError,
  TalentCodeTakenError,
  TalentInvalidError,
  VacancyNotFoundError,
  VacancyStateConflictError,
} from "../domain/talent-errors";
import {
  canAdvanceStage,
  isApplicantStage,
  reopenTarget,
  type ApplicantStage,
} from "../domain/talent-math";
import * as store from "../infrastructure/talent-recruitment.store";
import { findEmployeeBrief } from "../infrastructure/talent-org.store";
import type { ApplicantRow, VacancyRow } from "../infrastructure/talent-recruitment.store";

/**
 * PHASE-047 (W-3 — T-07) — the recruitment engine: the vacancy
 * lifecycle (OPEN↔ON_HOLD, OPEN/ON_HOLD→FILLED/CANCELLED — FILLED/
 * CANCELLED terminal, every transition the CAS conditional UPDATE),
 * the applicant pipeline (BR-088's monotonic stages + the ONE
 * recorded backward edge, the reopen), the hire act (the link to the
 * 045 employee master, written once — D-01's law: the talent layer
 * NEVER writes the employees table; the hire LINKS an existing
 * employee created through the payroll module's own master surface),
 * and the interview scorecards (one row per panelist per round; the
 * scorecard is the panelist's OWN evidence — the own-rows law).
 *
 * THE LAWS:
 *
 * - BR-088 (the monotonic pipeline): the FIXED ladder
 *   NEW→SCREEN→INTERVIEW→OFFER→HIRED/REJECTED; any strictly-forward
 *   move is legal (skips included — the rank never moves backward;
 *   stage_history records the actual path); backward motion ONLY via
 *   the recorded reopen (REJECTED → SCREEN, the dedicated act); the
 *   STAGE CAS is one conditional UPDATE whose WHERE pins the expected
 *   stage — the raced or stale move matches zero rows and the service
 *   re-reads for the honest current-state refusal.
 * - THE HIRE ACT: requires OFFER (the ladder's own law —
 *   ApplicantNotHireableError below it); links an EXISTING employee
 *   (typed 404 for unknown/foreign ids — A7 parity); the link writes
 *   ONCE — the hire CAS carries TWO structural arms: the stage pin
 *   (`stage = 'OFFER'`) AND the written-once link arm
 *   (`hired_employee_id IS NULL`, added 2026-11-19 with W-4 per the
 *   owner's NF-10 finding — the W-3 shape pinned the stage alone) —
 *   a second hire is the typed 409, never a silent relink; the
 *   OFFER→HIRED hop and the link and the history record ride the
 *   SAME statement.
 * - THE PANEL RECORD: one row per (applicant, round, panelist) — the
 *   0096 unique, the typed 409 on a duplicate schedule; the scorecard
 *   write is guarded on the panelist (a non-panelist's write matches
 *   zero rows — the typed refusal; the own-rows law is structural).
 *
 * Ledger-free by design (D-05).
 */

const CODE_RE = /^[\w\-. ]{1,64}$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTERVIEW_MODES = new Set(["ONSITE", "VIDEO", "PHONE"]);
const INTERVIEW_VERDICTS = new Set(["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE"]);

const VACANCY_ACTIONS = {
  hold: { from: "OPEN", to: "ON_HOLD" },
  resume: { from: "ON_HOLD", to: "OPEN" },
  fill: { from: ["OPEN", "ON_HOLD"], to: "FILLED" },
  cancel: { from: ["OPEN", "ON_HOLD"], to: "CANCELLED" },
} as const;

export type VacancyAction = keyof typeof VACANCY_ACTIONS;

function requireUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) {
    throw new TalentInvalidError(`${what} must be a uuid: ${value}`);
  }
  return value;
}

function isoDateTime(value: string, what: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new TalentInvalidError(`${what} must be an ISO 8601 timestamp: ${value}`);
  }
  return value;
}

@Injectable()
export class TalentRecruitmentService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // ── vacancies (the requisition lifecycle) ────────────────────────────────

  async createVacancy(input: {
    code: string;
    positionId: string | null;
    title: string;
    titleAr: string | null;
    headcount: number;
    notes: string | null;
    actorId: string | null;
  }): Promise<VacancyRow> {
    if (!CODE_RE.test(input.code)) {
      throw new TalentInvalidError(
        `the vacancy code must be 1–64 characters of letters/digits/dash/dot/space: ${input.code}`,
      );
    }
    if (input.title.trim().length < 1 || input.title.length > 160) {
      throw new TalentInvalidError("the vacancy title must be 1–160 characters");
    }
    if (!Number.isInteger(input.headcount) || input.headcount < 1) {
      throw new TalentInvalidError(`the requested headcount must be a positive integer: ${input.headcount}`);
    }
    if (input.positionId !== null) {
      requireUuid(input.positionId, "positionId");
    }
    if ((await store.findVacancyByCode(input.code)) !== undefined) {
      throw new TalentCodeTakenError("vacancy", input.code);
    }
    const created = await store.insertVacancy({
      code: input.code,
      positionId: input.positionId,
      title: input.title.trim(),
      titleAr: input.titleAr,
      headcount: input.headcount,
      notes: input.notes,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.vacancy_created",
      entityType: "vacancy",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { code: created.code, title: created.title, headcount: created.headcount, status: "OPEN" },
    });
    return created;
  }

  async getVacancy(vacancyId: string): Promise<VacancyRow> {
    const vacancy = await store.findVacancyById(requireUuid(vacancyId, "vacancyId"));
    if (vacancy === undefined) throw new VacancyNotFoundError(vacancyId);
    return vacancy;
  }

  async listVacancies(filter: { status?: string; limit?: number }): Promise<VacancyRow[]> {
    const STATUSES = new Set(["OPEN", "ON_HOLD", "FILLED", "CANCELLED"]);
    if (filter.status !== undefined && !STATUSES.has(filter.status)) {
      throw new TalentInvalidError(
        `status must be one of OPEN/ON_HOLD/FILLED/CANCELLED: ${filter.status}`,
      );
    }
    return store.listVacancies({
      ...(filter.status === undefined ? {} : { status: filter.status }),
      limit: Math.min(Math.max(filter.limit ?? 50, 1), 200),
    });
  }

  /** The lifecycle CAS — hold/resume/fill/cancel; FILLED/CANCELLED
   * terminal (every action from them is the typed conflict). */
  async transitionVacancy(
    vacancyId: string,
    action: VacancyAction,
    actorId: string | null,
  ): Promise<VacancyRow> {
    const id = requireUuid(vacancyId, "vacancyId");
    const vacancy = await store.findVacancyById(id);
    if (vacancy === undefined) throw new VacancyNotFoundError(vacancyId);
    const edge = VACANCY_ACTIONS[action];
    const legalFrom = Array.isArray(edge.from) ? edge.from : [edge.from];
    if (!legalFrom.includes(vacancy.status as never)) {
      throw new VacancyStateConflictError(vacancyId, vacancy.status, action);
    }
    const updated = await store.casTransitionVacancy(
      id,
      vacancy.status,
      edge.to,
      actorId,
    );
    if (updated === undefined) {
      const current = await store.findVacancyById(id);
      throw new VacancyStateConflictError(vacancyId, current?.status ?? vacancy.status, action);
    }
    await this.audit.record({
      action: "hr.vacancy_transitioned",
      entityType: "vacancy",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: vacancy.status },
      after: { status: edge.to, action },
    });
    return updated;
  }

  // ── applicants (BR-088's pipeline) ───────────────────────────────────────

  async createApplicant(input: {
    vacancyId: string;
    fullName: string;
    fullNameAr: string | null;
    email: string | null;
    phone: string | null;
    source: string | null;
    notes: string | null;
    actorId: string | null;
  }): Promise<ApplicantRow> {
    const vacancyId = requireUuid(input.vacancyId, "vacancyId");
    const vacancy = await store.findVacancyById(vacancyId);
    if (vacancy === undefined) throw new VacancyNotFoundError(input.vacancyId);
    if (input.fullName.trim().length < 1 || input.fullName.length > 160) {
      throw new TalentInvalidError("the applicant's full name must be 1–160 characters");
    }
    if (input.email !== null && !EMAIL_RE.test(input.email)) {
      throw new TalentInvalidError(`the applicant email is not a valid address: ${input.email}`);
    }
    if (input.phone !== null && input.phone.trim().length > 32) {
      throw new TalentInvalidError("the applicant phone must be at most 32 characters");
    }
    const created = await store.insertApplicant({
      vacancyId,
      fullName: input.fullName.trim(),
      fullNameAr: input.fullNameAr,
      email: input.email,
      phone: input.phone,
      source: input.source,
      notes: input.notes,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.applicant_created",
      entityType: "applicant",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { vacancyId, fullName: created.fullName, stage: "NEW", source: created.source },
    });
    return created;
  }

  async getApplicant(applicantId: string): Promise<ApplicantRow> {
    const applicant = await store.findApplicantById(requireUuid(applicantId, "applicantId"));
    if (applicant === undefined) throw new ApplicantNotFoundError(applicantId);
    return applicant;
  }

  async listApplicants(filter: {
    vacancyId?: string;
    stage?: string;
    limit?: number;
  }): Promise<ApplicantRow[]> {
    if (filter.stage !== undefined && !isApplicantStage(filter.stage)) {
      throw new TalentInvalidError(
        `stage must be one of the FIXED ladder NEW/SCREEN/INTERVIEW/OFFER/HIRED/REJECTED: ${filter.stage}`,
      );
    }
    return store.listApplicants({
      ...(filter.vacancyId === undefined ? {} : { vacancyId: requireUuid(filter.vacancyId, "vacancyId") }),
      ...(filter.stage === undefined ? {} : { stage: filter.stage }),
      limit: Math.min(Math.max(filter.limit ?? 50, 1), 200),
    });
  }

  /**
   * BR-088's advance act: the pure rank law FIRST (the typed refusal
   * names the illegal move BEFORE any write), then the STAGE CAS —
   * one conditional UPDATE whose WHERE pins the expected stage; a
   * raced move matches zero rows and the re-read throws the honest
   * current-state refusal.
   */
  async advanceStage(
    applicantId: string,
    to: string,
    actorId: string | null,
  ): Promise<ApplicantRow> {
    const id = requireUuid(applicantId, "applicantId");
    if (!isApplicantStage(to)) {
      throw new TalentInvalidError(
        `stage must be one of the FIXED ladder NEW/SCREEN/INTERVIEW/OFFER/HIRED/REJECTED: ${to}`,
      );
    }
    const applicant = await store.findApplicantById(id);
    if (applicant === undefined) throw new ApplicantNotFoundError(applicantId);
    const from = applicant.stage as ApplicantStage;
    if (to === "HIRED") {
      // The hire is the DEDICATED act (the employee link rides it) —
      // never a bare stage hop.
      throw new TalentInvalidError(
        `applicant ${applicantId}: the HIRED stage is reached only through the hire act (POST /applicants/:id/hire — the employee link is written with the hop, never without it)`,
      );
    }
    if (!canAdvanceStage(from, to)) {
      throw new StageTransitionInvalidError(applicantId, from, to);
    }
    const updated = await store.casAdvanceStage({
      applicantId: id,
      from,
      to,
      action: "ADVANCE",
      actorId,
      at: new Date().toISOString(),
    });
    if (updated === undefined) {
      const current = await store.findApplicantById(id);
      const currentStage = (current?.stage ?? from) as ApplicantStage;
      if (current !== undefined && canAdvanceStage(currentStage, to)) {
        // The row moved underneath to an earlier-rank stage (a raced
        // reopen) — the move is still monotonic from the CURRENT
        // state; refuse honestly (the caller retries with the fresh
        // read; one act, one write, never a blind loop).
        throw new StageTransitionInvalidError(applicantId, currentStage, to);
      }
      throw new StageTransitionInvalidError(applicantId, currentStage, to);
    }
    await this.audit.record({
      action: "hr.applicant_stage_advanced",
      entityType: "applicant",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { stage: from },
      after: { stage: to },
    });
    return updated;
  }

  /**
   * THE ONE RECORDED BACKWARD EDGE (BR-088): REJECTED → SCREEN — the
   * dedicated act, the history record carries action REOPEN. Only a
   * REJECTED applicant reopens (a HIRED applicant's employee link is
   * permanent; a live applicant never needs a backward hop).
   */
  async reopenApplicant(applicantId: string, actorId: string | null): Promise<ApplicantRow> {
    const id = requireUuid(applicantId, "applicantId");
    const applicant = await store.findApplicantById(id);
    if (applicant === undefined) throw new ApplicantNotFoundError(applicantId);
    const from = applicant.stage as ApplicantStage;
    const target = reopenTarget(from);
    if (target === null) {
      throw new ReopenInvalidError(applicantId, from);
    }
    const updated = await store.casAdvanceStage({
      applicantId: id,
      from,
      to: target,
      action: "REOPEN",
      actorId,
      at: new Date().toISOString(),
    });
    if (updated === undefined) {
      const current = await store.findApplicantById(id);
      throw new ReopenInvalidError(applicantId, current?.stage ?? from);
    }
    await this.audit.record({
      action: "hr.applicant_reopened",
      entityType: "applicant",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { stage: from },
      after: { stage: target, action: "REOPEN" },
    });
    return updated;
  }

  /**
   * THE HIRE ACT (acceptance #3): requires OFFER; links an EXISTING
   * employee of this tenant (typed 404 for unknown/foreign ids — A7
   * parity; D-01: the talent layer never writes the employees table,
   * the employee master's own creation surface is the payroll
   * module's); the OFFER→HIRED hop + the written-once link + the
   * history record ride ONE conditional UPDATE whose WHERE carries
   * BOTH defense lines — the stage pin (`stage = 'OFFER'`) and the
   * written-once link arm (`hired_employee_id IS NULL`, the NF-10
   * second line, 2026-11-19/W-4) — a raced or repeated hire matches
   * zero rows on either arm (the typed 409 with the EXISTING link).
   */
  async hireApplicant(
    applicantId: string,
    employeeId: string,
    actorId: string | null,
  ): Promise<ApplicantRow> {
    const id = requireUuid(applicantId, "applicantId");
    const linkedId = requireUuid(employeeId, "employeeId");
    const applicant = await store.findApplicantById(id);
    if (applicant === undefined) throw new ApplicantNotFoundError(applicantId);
    // The written-once law FIRST: a linked applicant (stage HIRED) is
    // the typed 409 — the hire link exists, never a silent relink.
    if (applicant.hiredEmployeeId !== null) {
      throw new ApplicantAlreadyHiredError(applicantId, applicant.hiredEmployeeId);
    }
    if (applicant.stage !== "OFFER") {
      throw new ApplicantNotHireableError(applicantId, applicant.stage);
    }
    const employee = await findEmployeeBrief(linkedId);
    if (employee === undefined) {
      // A7 parity: unknown and foreign render identically.
      throw new EmployeeNotFoundError(employeeId);
    }
    const updated = await store.casAdvanceStage({
      applicantId: id,
      from: "OFFER",
      to: "HIRED",
      action: "HIRE",
      actorId,
      at: new Date().toISOString(),
      hiredEmployeeId: linkedId,
    });
    if (updated === undefined) {
      const current = await store.findApplicantById(id);
      if (current?.hiredEmployeeId != null) {
        throw new ApplicantAlreadyHiredError(applicantId, current.hiredEmployeeId);
      }
      throw new ApplicantNotHireableError(applicantId, current?.stage ?? "OFFER");
    }
    await this.audit.record({
      action: "hr.applicant_hired",
      entityType: "applicant",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { stage: "OFFER" },
      after: { stage: "HIRED", hiredEmployeeId: linkedId, employeeCode: employee.code },
    });
    return updated;
  }

  // ── interviews (the panel scorecards) ────────────────────────────────────

  async scheduleInterview(input: {
    applicantId: string;
    round: number;
    panelistEmployeeId: string;
    scheduledStart: string;
    scheduledEnd: string;
    mode: string;
    actorId: string | null;
  }) {
    const applicantId = requireUuid(input.applicantId, "applicantId");
    const panelistEmployeeId = requireUuid(input.panelistEmployeeId, "panelistEmployeeId");
    const applicant = await store.findApplicantById(applicantId);
    if (applicant === undefined) throw new ApplicantNotFoundError(input.applicantId);
    if (!Number.isInteger(input.round) || input.round < 1) {
      throw new TalentInvalidError(`the interview round must be a positive integer: ${input.round}`);
    }
    const panelist = await findEmployeeBrief(panelistEmployeeId);
    if (panelist === undefined) {
      throw new EmployeeNotFoundError(input.panelistEmployeeId);
    }
    const start = isoDateTime(input.scheduledStart, "scheduledStart");
    const end = isoDateTime(input.scheduledEnd, "scheduledEnd");
    if (Date.parse(end) <= Date.parse(start)) {
      throw new TalentInvalidError("the scheduled window is inverted (scheduledEnd must be after scheduledStart)");
    }
    if (!INTERVIEW_MODES.has(input.mode)) {
      throw new TalentInvalidError(`mode must be one of ONSITE/VIDEO/PHONE: ${input.mode}`);
    }
    if (
      (await store.findInterviewSlot({
        applicantId,
        round: input.round,
        panelistEmployeeId,
      })) !== undefined
    ) {
      throw new InterviewSlotTakenError(applicantId, input.round, panelistEmployeeId);
    }
    const created = await store.insertInterview({
      applicantId,
      round: input.round,
      panelistEmployeeId,
      scheduledStart: start,
      scheduledEnd: end,
      mode: input.mode,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.interview_scheduled",
      entityType: "interview",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        applicantId,
        round: input.round,
        panelistEmployeeId,
        mode: input.mode,
        scheduledStart: start,
        scheduledEnd: end,
      },
    });
    return created;
  }

  async listInterviews(filter: {
    applicantId?: string;
    panelistEmployeeId?: string;
    limit?: number;
  }) {
    return store.listInterviews({
      ...(filter.applicantId === undefined
        ? {}
        : { applicantId: requireUuid(filter.applicantId, "applicantId") }),
      ...(filter.panelistEmployeeId === undefined
        ? {}
        : { panelistEmployeeId: requireUuid(filter.panelistEmployeeId, "panelistEmployeeId") }),
      limit: Math.min(Math.max(filter.limit ?? 100, 1), 500),
    });
  }

  /**
   * THE SCORECARD ACT (the own-rows law): the panelist's OWN slot —
   * the acting employee id is resolved from the acting user by the
   * CONTROLLER (the identity bridge, never a client-supplied id), and
   * the store's guarded UPDATE matches only the panelist's row (a
   * non-panelist write = zero rows = the typed refusal).
   */
  async recordScorecard(input: {
    interviewId: string;
    panelistEmployeeId: string;
    scorecard: Record<string, unknown>;
    verdict: string | null;
    comments: string | null;
  }) {
    const interviewId = requireUuid(input.interviewId, "interviewId");
    const interview = await store.findInterviewById(interviewId);
    if (interview === undefined) throw new InterviewNotFoundError(input.interviewId);
    if (interview.panelistEmployeeId !== input.panelistEmployeeId) {
      throw new InterviewNotPanelistError(input.interviewId, interview.panelistEmployeeId);
    }
    if (input.verdict !== null && !INTERVIEW_VERDICTS.has(input.verdict)) {
      throw new TalentInvalidError(
        `verdict must be one of STRONG_HIRE/HIRE/NO_HIRE/STRONG_NO_HIRE: ${input.verdict}`,
      );
    }
    const updated = await store.updateInterviewScorecard({
      interviewId,
      panelistEmployeeId: input.panelistEmployeeId,
      scorecard: input.scorecard,
      verdict: input.verdict,
      comments: input.comments,
    });
    if (updated === undefined) throw new InterviewNotFoundError(input.interviewId);
    await this.audit.record({
      action: "hr.interview_scorecard_recorded",
      entityType: "interview",
      entityId: interviewId,
      actorId: undefined,
      after: { verdict: input.verdict, round: updated.round, applicantId: updated.applicantId },
    });
    return updated;
  }
}
