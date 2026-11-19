/**
 * PHASE-047 (W-5, T-11) — the performance board's component tests (the
 * statutory-board pattern: jsdom + the bffFetch mock + the Radix
 * focus/keyDown law): the five tabs render with their registers +
 * badges; the cycle create dialog posts the exact shape; the
 * own-reviews plane renders the honest no-permission notice when the
 * session lacks hr.performance.review (null); the 360-kind score law
 * (a SELF input without an overall score refuses locally, zero
 * requests); the calibration view loads a cycle's reviews and renders
 * BR-090's aggregate blocks + the below-threshold notes; the goals tab
 * renders the own triage row and the BR-089 check's verdict badge; a
 * typed refusal renders through the localized talent mirror.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type {
  Aggregate360View,
  CompetencyLevelRow,
  CompetencyRow,
  EmployeeListRow,
  GoalRow,
  GoalWeightCheck,
  PerformanceCycleRow,
  PerformanceReviewRow,
} from "../../lib/api-types";
import { HrPerformanceBoard } from "../hr-performance-board";

vi.mock("../../lib/client-api", () => ({
  bffFetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const bffFetchMock = vi.mocked(bffFetch);

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Object.defineProperty(Element.prototype, "hasPointerCapture", {
      value: () => false,
      writable: true,
      configurable: true,
    });
  }
  if (!Element.prototype.setPointerCapture) {
    Object.defineProperty(Element.prototype, "setPointerCapture", { value: () => {}, writable: true, configurable: true });
  }
  if (!Element.prototype.releasePointerCapture) {
    Object.defineProperty(Element.prototype, "releasePointerCapture", { value: () => {}, writable: true, configurable: true });
  }
});

/** The Radix select law (the statutory test's proven idiom): selects
 * activate on focus + Enter keyDown, options click by role. */
function pickSelect(labelText: string, optionName: string | RegExp): void {
  const trigger = screen.getByLabelText(labelText);
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

const EMPLOYEE: EmployeeListRow = {
  id: "0193f000-0000-7000-8000-00000000e001",
  code: "EMP-001",
  name: "Saudi Employee",
  nameAr: "الموظف السعودي",
  nationalIdMasked: "••••1234",
  hireDate: "2020-01-01",
  terminationDate: null,
  terminationReason: null,
  contractType: "FULL_TIME",
  basicSalary: "10000.0000",
  salaryStructureId: null,
  branchId: null,
  costCenterId: null,
  projectId: null,
  bankMasked: { name: null, ibanTail: null, accountTail: null },
  status: "ACTIVE",
  note: null,
  noteAr: null,
  createdAt: "2020-01-01T00:00:00Z",
};

const CYCLE: PerformanceCycleRow = {
  id: "0193f000-0000-7000-8000-00000000c001",
  name: "FY2026 H2 Review",
  nameAr: "تقييم النصف الثاني 2026",
  periodStart: "2026-07-01",
  periodEnd: "2026-12-31",
  status: "ACTIVE",
  reviewDueDate: "2026-12-20",
  scopeOrgUnitIds: [],
  version: 1,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const COMPETENCY: CompetencyRow = {
  id: "0193f000-0000-7000-8000-00000000k001",
  code: "COMM",
  name: "Communication",
  nameAr: "التواصل",
  category: "Core",
  active: true,
};

const LEVELS: readonly CompetencyLevelRow[] = [1, 2, 3, 4, 5].map((level) => ({
  id: `0193f000-0000-7000-8000-00000000l00${level}`,
  level,
  name: `Level ${level}`,
  nameAr: `المستوى ${level}`,
  descriptor: `The descriptor for level ${level}`,
  descriptorAr: `وصف المستوى ${level}`,
}));

const OWN_REVIEW: PerformanceReviewRow = {
  id: "0193f000-0000-7000-8000-00000000r001",
  cycleId: CYCLE.id,
  reviewerEmployeeId: EMPLOYEE.id,
  revieweeEmployeeId: "0193f000-0000-7000-8000-00000000e002",
  kind: "MANAGER",
  status: "SUBMITTED",
  overallScore: "82.50",
  competencyScores: { [COMPETENCY.id]: 4 },
  goalRollup: "77.00",
  comments: null,
  createdAt: "2026-11-10T00:00:00Z",
  updatedAt: "2026-11-10T00:00:00Z",
};

const AGGREGATE: Aggregate360View = {
  cycleId: CYCLE.id,
  revieweeEmployeeId: "0193f000-0000-7000-8000-00000000e002",
  aggregates: {
    SELF: null,
    PEER: { kind: "PEER", count: 4, mean: "75.50", min: "60.00", max: "90.00" },
    SUBORDINATE: null,
  },
};

const OWN_GOAL: GoalRow = {
  id: "0193f000-0000-7000-8000-00000000g001",
  cycleId: CYCLE.id,
  ownerEmployeeId: EMPLOYEE.id,
  parentGoalId: null,
  title: "Cut onboarding time",
  titleAr: null,
  weight: "60.00",
  kriTarget: "10 days",
  kriActual: "12 days",
  progressPct: "70.00",
  status: "AT_RISK",
  dueDate: "2026-12-15",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-10T00:00:00Z",
};

function renderBoard(
  props: Partial<Parameters<typeof HrPerformanceBoard>[0]> = {},
): void {
  render(
    <ToastProvider>
      <HrPerformanceBoard
        locale="en"
        initialCycles={[CYCLE]}
        initialCompetencies={[COMPETENCY]}
        initialLevels={LEVELS}
        initialOwnReviews={[OWN_REVIEW]}
        initialOwnGoals={[OWN_GOAL]}
        orgUnits={[]}
        employees={[EMPLOYEE]}
        {...props}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  bffFetchMock.mockReset();
});

afterEach(cleanup);

describe("PHASE-047 W-5 T-11 — the performance board", () => {
  it("renders the five tabs; the cycles register shows the row, the ACTIVE badge, and the period window", () => {
    renderBoard();
    expect(screen.getByText("Cycles")).toBeTruthy();
    expect(screen.getByText("My reviews")).toBeTruthy();
    expect(screen.getByText("Calibration")).toBeTruthy();
    expect(screen.getByText("Goals")).toBeTruthy();
    expect(screen.getByText("Competencies")).toBeTruthy();
    expect(screen.getByText("FY2026 H2 Review")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("2026-07-01 → 2026-12-31")).toBeTruthy();
  });

  it("the cycle create dialog posts the exact shape (scope empty = the whole workforce)", async () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "New cycle" }));
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "FY2027 H1 Review" } });
    fireEvent.change(screen.getByLabelText("Period start"), { target: { value: "2027-01-01" } });
    fireEvent.change(screen.getByLabelText("Period end"), { target: { value: "2027-06-30" } });
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...CYCLE, id: "0193f000-0000-7000-8000-00000000c002", name: "FY2027 H1 Review" },
    } as Awaited<ReturnType<typeof bffFetch>>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("hr/performance/cycles", {
        method: "POST",
        body: {
          name: "FY2027 H1 Review",
          nameAr: null,
          periodStart: "2027-01-01",
          periodEnd: "2027-06-30",
          reviewDueDate: null,
          scopeOrgUnitIds: [],
        },
      });
    });
    await waitFor(() => {
      expect(screen.getByText("The cycle was created.")).toBeTruthy();
    });
  });

  it("the own-reviews plane renders the honest no-permission notice when the session lacks the review key (null)", () => {
    renderBoard({ initialOwnReviews: null, initialOwnGoals: null });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "My reviews" }));
    expect(screen.getByText("You do not have permission to do that.")).toBeTruthy();
    expect(screen.queryByText("New review")).toBe(null);
  });

  it("the 360-kind score law: a SELF input without an overall score refuses locally (zero requests)", async () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "My reviews" }));
    fireEvent.click(screen.getByRole("button", { name: "New review" }));
    const dialog = screen.getByRole("dialog");
    const cycleTrigger = within(dialog).getByLabelText(/^Cycle/);
    cycleTrigger.focus();
    fireEvent.keyDown(cycleTrigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: /FY2026 H2 Review/ }));
    const revieweeTrigger = within(dialog).getByLabelText(/^Reviewee/);
    revieweeTrigger.focus();
    fireEvent.keyDown(revieweeTrigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: /EMP-001/ }));
    const kindTrigger = within(dialog).getByLabelText(/^Input kind/);
    kindTrigger.focus();
    fireEvent.keyDown(kindTrigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Self" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByText("Invalid input — complete the required fields.")).toBeTruthy();
    expect(bffFetchMock).not.toHaveBeenCalled();
  });

  it("the calibration view loads a cycle's reviews and renders BR-090's aggregate blocks + the below-threshold notes", async () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Calibration" }));
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [OWN_REVIEW],
    } as Awaited<ReturnType<typeof bffFetch>>);
    pickSelect("Select the cycle", /FY2026 H2 Review/);
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith(`hr/performance/cycles/${CYCLE.id}/reviews`);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "360 aggregates" })).toBeTruthy();
    });
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: AGGREGATE,
    } as Awaited<ReturnType<typeof bffFetch>>);
    fireEvent.click(screen.getByRole("button", { name: "360 aggregates" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith(
        `hr/performance/cycles/${CYCLE.id}/reviews/${OWN_REVIEW.revieweeEmployeeId}/aggregate-360`,
      );
    });
    await waitFor(() => {
      expect(screen.getByText("Count: 4")).toBeTruthy();
      expect(screen.getByText("Mean: 75.50")).toBeTruthy();
      // SELF + SUBORDINATE below threshold → the honest notes (BR-090)
      expect(screen.getAllByText("Below 3 responses — not shown.")).toHaveLength(2);
    });
  });

  it("the goals tab renders the own-goals triage row and the BR-089 check's verdict badge", async () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Goals" }));
    expect(screen.getByText("Cut onboarding time")).toBeTruthy();
    expect(screen.getByText("At risk")).toBeTruthy();
    // the check needs a cycle + an owner; without them the button stays
    // inert (zero requests — the honest local gate)
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(bffFetchMock).not.toHaveBeenCalled();
    // select the cycle (loads the tree) then the owner, then run the check
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { cycleId: CYCLE.id, roots: [] },
    } as Awaited<ReturnType<typeof bffFetch>>);
    pickSelect("Select the cycle", /FY2026 H2 Review/);
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith(`hr/goals/tree?cycleId=${CYCLE.id}`);
    });
    pickSelect("Owner", /EMP-001/);
    const check: GoalWeightCheck = {
      cycleId: CYCLE.id,
      employeeId: EMPLOYEE.id,
      sum: "100.00",
      valid: true,
      activeGoals: 2,
    };
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: check,
    } as Awaited<ReturnType<typeof bffFetch>>);
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith(
        `hr/goals/validate?cycleId=${CYCLE.id}&employeeId=${EMPLOYEE.id}`,
      );
    });
    await waitFor(() => {
      expect(screen.getByText("Valid — exactly 100%")).toBeTruthy();
      expect(screen.getByText("Sum: 100.00%")).toBeTruthy();
    });
  });

  it("the competency framework renders the register and the scale descriptors", () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Competencies" }));
    expect(screen.getByText("COMM")).toBeTruthy();
    expect(screen.getByText("Communication")).toBeTruthy();
    expect(screen.getByText("The descriptor for level 3")).toBeTruthy();
    expect(screen.getAllByText("Edit level")).toHaveLength(5);
  });

  it("a typed refusal renders through the localized talent mirror, never a raw code", async () => {
    renderBoard();
    bffFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: "CYCLE_STATE_CONFLICT", message: "stale" },
    } as Awaited<ReturnType<typeof bffFetch>>);
    fireEvent.click(screen.getByRole("button", { name: "Open calibration" }));
    await waitFor(() => {
      expect(
        screen.getByText("The cycle's state does not allow this transition — the lifecycle ladder is one-way."),
      ).toBeTruthy();
    });
  });
});
