/**
 * PHASE-047 (W-5, T-14) — the employee 360 extension's component tests
 * (the eosb-board pattern): the honest ALL-403 note when no talent
 * plane resolves; the placement card renders the position + grade + org
 * path + the probation chip; the trend renders the per-cycle manager
 * outcomes (BR-090 — never a source row); the documents panel renders
 * the expiry chips; the source record renders the stage history; a
 * degraded panel hides honestly (the others stay).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import type {
  ApplicantRow,
  CertificationRow,
  EmployeePlacementView,
  EmployeeReviewTrendRow,
  GoalRow,
  TrainingEnrollmentRow,
  TrainingProgramRow,
  VacancyRow,
} from "../../lib/api-types";
import { EmployeeTalent360 } from "../employee-talent-360";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const EMPLOYEE_ID = "0193f000-0000-7000-8000-00000000e001";

const PLACEMENT: EmployeePlacementView = {
  position: {
    id: "0193f000-0000-7000-8000-00000000s001",
    code: "POS-TECH-01",
    title: "Technician",
    titleAr: "فني",
    grade: "G5",
    orgUnitId: "0193f000-0000-7000-8000-00000000u002",
    reportsTo: null,
    status: "ACTIVE",
    version: 1,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  },
  orgUnit: {
    id: "0193f000-0000-7000-8000-00000000u002",
    code: "FACILITIES",
    name: "Facilities",
    nameAr: "المرافق",
    parentId: null,
    path: "OPERATIONS.FACILITIES",
    active: true,
    version: 1,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  },
  probationEnd: "2026-11-25",
};

const TREND_ROW: EmployeeReviewTrendRow = {
  id: "0193f000-0000-7000-8000-00000000r001",
  cycleId: "0193f000-0000-7000-8000-00000000c001",
  reviewerEmployeeId: "0193f000-0000-7000-8000-00000000e009",
  revieweeEmployeeId: EMPLOYEE_ID,
  kind: "MANAGER",
  status: "CALIBRATED",
  overallScore: "86.50",
  competencyScores: {},
  goalRollup: "82.00",
  comments: null,
  createdAt: "2026-11-10T00:00:00Z",
  updatedAt: "2026-11-12T00:00:00Z",
  cycleName: "FY2026 H2 Review",
  cycleNameAr: null,
  cycleStatus: "CLOSED",
  cyclePeriodStart: "2026-07-01",
  cyclePeriodEnd: "2026-12-31",
};

const GOAL: GoalRow = {
  id: "0193f000-0000-7000-8000-00000000g001",
  cycleId: TREND_ROW.cycleId,
  ownerEmployeeId: EMPLOYEE_ID,
  parentGoalId: null,
  title: "Cut onboarding time",
  titleAr: null,
  weight: "60.00",
  kriTarget: null,
  kriActual: null,
  progressPct: "70.00",
  status: "AT_RISK",
  dueDate: "2026-12-15",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-10T00:00:00Z",
};

const PROGRAM: TrainingProgramRow = {
  id: "0193f000-0000-7000-8000-00000000p001",
  code: "TRN-SAFE-01",
  name: "Workplace Safety",
  nameAr: null,
  kind: "INTERNAL",
  provider: null,
  cost: null,
  status: "ACTIVE",
  notes: null,
  version: 1,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const ENROLLMENT: TrainingEnrollmentRow = {
  id: "0193f000-0000-7000-8000-00000000n001",
  programId: PROGRAM.id,
  employeeId: EMPLOYEE_ID,
  status: "COMPLETED",
  attendancePct: "95.00",
  completionPct: "100.00",
  result: "PASSED",
  completedAt: "2026-11-10",
  notes: null,
  version: 1,
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-10T00:00:00Z",
};

const CERTIFICATION: CertificationRow = {
  id: "0193f000-0000-7000-8000-00000000t001",
  employeeId: EMPLOYEE_ID,
  name: "First Aid",
  nameAr: null,
  issuer: "Red Crescent",
  issueDate: "2025-11-01",
  expiryDate: "2026-11-25",
  certificateNumber: null,
  notes: null,
  version: 1,
  createdAt: "2025-11-01T00:00:00Z",
  updatedAt: "2025-11-01T00:00:00Z",
};

const SOURCE: ApplicantRow = {
  id: "0193f000-0000-7000-8000-00000000a001",
  vacancyId: "0193f000-0000-7000-8000-00000000v001",
  fullName: "Sara Applicant",
  fullNameAr: null,
  email: null,
  phone: null,
  source: "LinkedIn",
  stage: "HIRED",
  stageHistory: [
    { from: "NEW", to: "SCREEN", action: "ADVANCE", at: "2026-10-01T00:00:00Z", by: null },
    { from: "OFFER", to: "HIRED", action: "HIRE", at: "2026-10-20T00:00:00Z", by: null },
  ],
  hiredEmployeeId: EMPLOYEE_ID,
  notes: null,
  version: 1,
  createdAt: "2026-09-28T00:00:00Z",
  updatedAt: "2026-10-20T00:00:00Z",
};

const VACANCY: VacancyRow = {
  id: SOURCE.vacancyId,
  code: "VAC-TECH-01",
  positionId: null,
  title: "Technician",
  titleAr: null,
  headcount: 1,
  status: "FILLED",
  openedAt: null,
  filledAt: null,
  notes: null,
  version: 1,
  createdAt: "2026-09-27T00:00:00Z",
  updatedAt: "2026-10-20T00:00:00Z",
};

function render360(
  props: Partial<Parameters<typeof EmployeeTalent360>[0]> = {},
): void {
  render(
    <ToastProvider>
      <EmployeeTalent360
        locale="en"
        employeeId={EMPLOYEE_ID}
        placement={PLACEMENT}
        trend={[TREND_ROW]}
        goals={[GOAL]}
        enrollments={[ENROLLMENT]}
        programs={[PROGRAM]}
        certifications={[CERTIFICATION]}
        documents={[]}
        documentsAllowed={true}
        sourceApplicant={SOURCE}
        vacancies={[VACANCY]}
        {...props}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T00:00:00Z"));
  vi.useRealTimers();
});

afterEach(cleanup);

describe("PHASE-047 W-5 T-14 — the employee 360 extension", () => {
  it("renders the honest ALL-403 note when no talent plane resolves", () => {
    render360({
      placement: null,
      trend: null,
      goals: null,
      enrollments: null,
      certifications: null,
      documents: null,
      documentsAllowed: false,
      sourceApplicant: null,
    });
    expect(screen.getByText("The talent 360")).toBeTruthy();
    expect(
      screen.getByText("The talent plane requires HR permissions — nothing is shown here for your session."),
    ).toBeTruthy();
  });

  it("the placement card renders the position, the grade, the org path, and the probation chip", () => {
    render360();
    expect(screen.getByText("Technician")).toBeTruthy();
    expect(screen.getByText("G5")).toBeTruthy();
    expect(screen.getByText("OPERATIONS.FACILITIES")).toBeTruthy();
    expect(screen.getByText("Probation end: 2026-11-25")).toBeTruthy();
    expect(screen.getAllByText("6 days remaining").length).toBeGreaterThan(0);
  });

  it("the trend renders the per-cycle MANAGER outcome (the score + the rollup) — never an attributed source", () => {
    render360();
    expect(screen.getByText("FY2026 H2 Review")).toBeTruthy();
    expect(screen.getByText("Calibrated")).toBeTruthy();
    expect(screen.getByText("Score: 86.50")).toBeTruthy();
    expect(screen.getByText("Goal rollup: 82.00")).toBeTruthy();
  });

  it("the active-goals panel renders the weight + the status + the progress", () => {
    render360();
    expect(screen.getByText("Cut onboarding time")).toBeTruthy();
    expect(screen.getByText("Weight: 60.00%")).toBeTruthy();
    expect(screen.getByText("Progress %: 70.00%")).toBeTruthy();
  });

  it("the training + certification panels render with the expiry chip", () => {
    render360();
    expect(screen.getByText("Workplace Safety")).toBeTruthy();
    expect(screen.getByText("PASSED")).toBeTruthy();
    expect(screen.getByText("First Aid")).toBeTruthy();
    expect(screen.getAllByText("6 days remaining").length).toBeGreaterThan(0);
  });

  it("the source record renders the vacancy + the recorded stage history (the hire link's own audit shape)", () => {
    render360();
    expect(screen.getByText("Sara Applicant")).toBeTruthy();
    expect(screen.getByText("VAC-TECH-01 · Technician")).toBeTruthy();
    expect(screen.getByText("OFFER → HIRED (HIRE)")).toBeTruthy();
  });

  it("a degraded panel hides honestly — the documents panel without the register's key, the others stay", () => {
    render360({ documents: null, documentsAllowed: false });
    expect(screen.queryByText("Documents & expiry chips")).toBe(null);
    expect(screen.getByText("Recruitment source record")).toBeTruthy();
    expect(screen.getByText("Review trend")).toBeTruthy();
  });
});
