import { DomainError } from "@erp/domain-core";

/**
 * PHASE-047 (W-1 — HR Growth: Talent & Performance) domain errors, the
 * typed taxonomy the W-2/W-3 engines throw (the 046 statutory-errors
 * precedent: landed with the foundation, registered in-phase, consumed by
 * the engines + the HTTP layer's status map as they land). Codes are
 * stable API contracts (ERROR_MODEL §4); A7-sensitive not-founds render
 * identically for unknown-vs-foreign ids (RLS makes them indistinguishable
 * at the store — the typed errors never disclose a foreign id's
 * existence).
 *
 * The families (the plan's D-04 reservations):
 * - 404 A7: the not-found family (cycle/competency/vacancy/applicant/
 *   program/org-unit/position/document).
 * - 409: the unique-code family (the typed taken refusals) + the cycle
 *   CAS family (a closed/active cycle's state conflicts).
 * - 422 fail-closed: BR-088 (the monotonic stage law — backward motion
 *   only via the recorded reopen), BR-089 (the per-cycle per-reviewee
 *   active weight sum must be EXACTLY 100%), BR-090 (the 360
 *   aggregate-only law — a relationship's inputs surface only at ≥ 3
 *   responses), D-09 (the org/goal cycle law — a move that would create
 *   a cycle is refused before any write).
 */

// ── The 404 A7 family ───────────────────────────────────────────────────────

export class TalentCycleNotFoundError extends DomainError {
  constructor(id: string) {
    super("TALENT_CYCLE_NOT_FOUND", `performance cycle ${id} does not exist in this tenant`);
  }
}
export class CompetencyNotFoundError extends DomainError {
  constructor(id: string) {
    super("COMPETENCY_NOT_FOUND", `competency ${id} does not exist in this tenant`);
  }
}
export class CompetencyLevelNotFoundError extends DomainError {
  constructor(level: number) {
    super(
      "COMPETENCY_LEVEL_NOT_FOUND",
      `competency level ${level} is not configured in this tenant (the 1–5 scale is tenant data — 0098 §4 seeds the documented default)`,
    );
  }
}
export class VacancyNotFoundError extends DomainError {
  constructor(id: string) {
    super("VACANCY_NOT_FOUND", `vacancy ${id} does not exist in this tenant`);
  }
}
export class ApplicantNotFoundError extends DomainError {
  constructor(id: string) {
    super("APPLICANT_NOT_FOUND", `applicant ${id} does not exist in this tenant`);
  }
}
export class TrainingProgramNotFoundError extends DomainError {
  constructor(id: string) {
    super("TRAINING_PROGRAM_NOT_FOUND", `training program ${id} does not exist in this tenant`);
  }
}
export class OrgUnitNotFoundError extends DomainError {
  constructor(id: string) {
    super("ORG_UNIT_NOT_FOUND", `org unit ${id} does not exist in this tenant`);
  }
}
export class PositionNotFoundError extends DomainError {
  constructor(id: string) {
    super("POSITION_NOT_FOUND", `position ${id} does not exist in this tenant`);
  }
}
export class EmployeeDocumentNotFoundError extends DomainError {
  constructor(id: string) {
    super("EMPLOYEE_DOCUMENT_NOT_FOUND", `employee document ${id} does not exist in this tenant`);
  }
}

// ── The 409 family: unique codes + the lifecycle CAS ───────────────────────

export class TalentCodeTakenError extends DomainError {
  constructor(kind: "cycle" | "competency" | "vacancy" | "program" | "org-unit" | "position", code: string) {
    super(
      "TALENT_CODE_TAKEN",
      `${kind} code ${code} is already used in this tenant — codes are unique per kind`,
    );
  }
}
export class CycleStateConflictError extends DomainError {
  constructor(id: string, from: string, to: string) {
    super(
      "CYCLE_STATE_CONFLICT",
      `performance cycle ${id} is ${from} — the ${to} transition is not available from this state (the DRAFT→ACTIVE→CALIBRATION→CLOSED ladder is one-way; the CAS refuses a raced or stale move)`,
    );
  }
}
export class ReviewAlreadySubmittedError extends DomainError {
  constructor(id: string) {
    super(
      "REVIEW_ALREADY_SUBMITTED",
      `review ${id} is already SUBMITTED — a submitted review is immutable until calibration (re-open through the cycle's calibration phase, never a silent edit)`,
    );
  }
}
export class DuplicateEnrollmentError extends DomainError {
  constructor(programId: string, employeeId: string) {
    super(
      "DUPLICATE_ENROLLMENT",
      `employee ${employeeId} is already enrolled in program ${programId} — one enrollment record per (program, employee); the status ladder is the update path`,
    );
  }
}

// ── The 422 fail-closed family: the BR-088/089/090 + D-09 laws ─────────────

export class StageTransitionInvalidError extends DomainError {
  constructor(applicantId: string, from: string, to: string) {
    super(
      "STAGE_TRANSITION_INVALID",
      `applicant ${applicantId}: the ${from} → ${to} stage move is not a forward step of the pipeline ladder (NEW→SCREEN→INTERVIEW→OFFER→HIRED/REJECTED — BR-088's monotonic law; backward motion only via the recorded reopen action)`,
    );
  }
}
export class ApplicantNotHireableError extends DomainError {
  constructor(applicantId: string, stage: string) {
    super(
      "APPLICANT_NOT_HIREABLE",
      `applicant ${applicantId} is at stage ${stage} — the hire act requires OFFER (BR-088's ladder; the employee link writes only from the hire)`,
    );
  }
}
export class GoalWeightsInvalidError extends DomainError {
  constructor(employeeId: string, cycleId: string, sum: string) {
    super(
      "GOAL_WEIGHTS_INVALID",
      `employee ${employeeId}'s active goal weights in cycle ${cycleId} sum to ${sum} — BR-089 requires EXACTLY 100% per cycle per reviewee (the typed refusal before any write; zero residue)`,
    );
  }
}
export class FeedbackBelowThresholdError extends DomainError {
  constructor(kind: string, count: number) {
    super(
      "FEEDBACK_BELOW_THRESHOLD",
      `the ${kind} relationship carries ${count} response(s) — BR-090 surfaces a relationship's inputs only at ≥ 3 responses (aggregate-only visibility; an attributed source never leaves the service boundary below the threshold)`,
    );
  }
}
export class OrgCycleError extends DomainError {
  constructor(kind: "org-unit" | "position" | "goal", id: string, parentId: string) {
    super(
      "ORG_CYCLE_INVALID",
      `the ${kind} ${id} cannot parent under ${parentId} — the move would create a cycle (D-09's write-time law; the illegal state never saves)`,
    );
  }
}
export class CompetencyScaleInvalidError extends DomainError {
  constructor(message: string) {
    super("COMPETENCY_SCALE_INVALID", message);
  }
}
export class TalentInvalidError extends DomainError {
  constructor(message: string) {
    super("TALENT_INVALID", message);
  }
}

// ── PHASE-047 (W-3 — T-07 + T-08 + T-09) — the wave's own additions ─────────
// (the W-1 taxonomy's families extended in-phase, the same discipline:
// the 404/409 additions register in the error filter's status map; the
// 422 fail-closed family falls through to the 422 default BY DESIGN.)

// The 404 A7 additions: the interview slot, the enrollment row, the
// certification register row.
export class InterviewNotFoundError extends DomainError {
  constructor(id: string) {
    super("INTERVIEW_NOT_FOUND", `interview ${id} does not exist in this tenant`);
  }
}
export class TrainingEnrollmentNotFoundError extends DomainError {
  constructor(id: string) {
    super("TRAINING_ENROLLMENT_NOT_FOUND", `training enrollment ${id} does not exist in this tenant`);
  }
}
export class CertificationNotFoundError extends DomainError {
  constructor(id: string) {
    super("CERTIFICATION_NOT_FOUND", `certification ${id} does not exist in this tenant`);
  }
}

// The 409 additions: the vacancy lifecycle CAS, the hire link's
// written-once law, and the panel-slot unique.
export class VacancyStateConflictError extends DomainError {
  constructor(id: string, from: string, action: string) {
    super(
      "VACANCY_STATE_CONFLICT",
      `vacancy ${id} is ${from} — the ${action} action is not available from this state (OPEN↔ON_HOLD, OPEN/ON_HOLD→FILLED/CANCELLED; FILLED/CANCELLED are terminal)`,
    );
  }
}
export class ApplicantAlreadyHiredError extends DomainError {
  constructor(applicantId: string, employeeId: string) {
    super(
      "APPLICANT_ALREADY_HIRED",
      `applicant ${applicantId} is already linked to employee ${employeeId} — the hire link is written once (the 0096 column law; a second hire is never a silent relink)`,
    );
  }
}
export class InterviewSlotTakenError extends DomainError {
  constructor(applicantId: string, round: number, panelistEmployeeId: string) {
    super(
      "INTERVIEW_SLOT_TAKEN",
      `the panel slot (applicant ${applicantId}, round ${round}, panelist ${panelistEmployeeId}) already exists — one row per panelist per round (the 0096 unique; the slot's scorecard is the update path)`,
    );
  }
}

// The 422 fail-closed additions (fall through to the 422 default):
// the reopen law's typed refusal and the scorecard's own-rows law.
export class ReopenInvalidError extends DomainError {
  constructor(applicantId: string, stage: string) {
    super(
      "REOPEN_INVALID",
      `applicant ${applicantId} is at stage ${stage} — only a REJECTED applicant reopens (BR-088's one sanctioned backward edge, REJECTED → SCREEN, recorded in stage_history; a HIRED applicant's employee link is permanent)`,
    );
  }
}
export class InterviewNotPanelistError extends DomainError {
  constructor(interviewId: string, panelistEmployeeId: string) {
    super(
      "INTERVIEW_NOT_PANELIST",
      `interview ${interviewId}'s panel slot belongs to employee ${panelistEmployeeId} — the scorecard is the panelist's OWN evidence (the own-rows law, the review-submission precedent; a client cannot record someone else's card)`,
    );
  }
}

// ── PHASE-047 (W-4 — T-10) — the external bridges' additions ───────────────
// (the same in-phase discipline: the ONE new code is a 422-family shape
// refusal — it falls through to the 422 default BY DESIGN, no error-filter
// registration needed; the imports' file-level 404/409 refusals reuse the
// W-1/W-2/W-3 taxonomy's already-registered codes: TALENT_CYCLE_NOT_FOUND,
// CYCLE_STATE_CONFLICT, TALENT_INVALID).

/** The file-level import refusal: a malformed/empty/oversized batch
 * (the attendance import's bounded-file law — a bigger file is a
 * deliberate migration, not a bridge import). The ROW-level refusals
 * never throw: they ride the row-level validation report. */
export class BridgeImportInvalidError extends DomainError {
  constructor(message: string) {
    super("BRIDGE_IMPORT_INVALID", message);
  }
}
