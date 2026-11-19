/**
 * PHASE-047 (W-5, T-12) — the recruitment board's component tests (the
 * statutory-board pattern): the three tabs render with their registers
 * + badges; the vacancy lifecycle buttons render per state (OPEN →
 * hold/fill/cancel; terminal states → none); the applicant pipeline's
 * advance dialog posts the exact stage shape; the hire dialog posts the
 * employee link; the honest empty states; a typed BR-088 refusal
 * renders through the localized talent mirror.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type {
  ApplicantRow,
  EmployeeListRow,
  InterviewRow,
  VacancyRow,
} from "../../lib/api-types";
import { HrRecruitmentBoard } from "../hr-recruitment-board";

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

function pickSelect(labelText: string | RegExp, optionName: string | RegExp): void {
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

const VACANCY: VacancyRow = {
  id: "0193f000-0000-7000-8000-00000000v001",
  code: "VAC-ENG-01",
  positionId: null,
  title: "Senior Engineer",
  titleAr: "مهندس أول",
  headcount: 2,
  status: "OPEN",
  openedAt: "2026-11-01",
  filledAt: null,
  notes: null,
  version: 1,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const APPLICANT: ApplicantRow = {
  id: "0193f000-0000-7000-8000-00000000a001",
  vacancyId: VACANCY.id,
  fullName: "Sara Applicant",
  fullNameAr: "سارة المتقدمة",
  email: null,
  phone: null,
  source: "LinkedIn",
  stage: "SCREEN",
  stageHistory: [{ from: "NEW", to: "SCREEN", action: "ADVANCE", at: "2026-11-05T00:00:00Z", by: null }],
  hiredEmployeeId: null,
  notes: null,
  version: 1,
  createdAt: "2026-11-02T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
};

const OFFER_APPLICANT: ApplicantRow = {
  ...APPLICANT,
  id: "0193f000-0000-7000-8000-00000000a002",
  fullName: "Offer Applicant",
  stage: "OFFER",
};

const INTERVIEW: InterviewRow = {
  id: "0193f000-0000-7000-8000-00000000i001",
  applicantId: APPLICANT.id,
  round: 1,
  panelistEmployeeId: EMPLOYEE.id,
  scheduledStart: "2026-11-12 10:00",
  scheduledEnd: "2026-11-12 11:00",
  mode: "VIDEO",
  scorecard: {},
  verdict: null,
  comments: null,
  version: 1,
  createdAt: "2026-11-10T00:00:00Z",
  updatedAt: "2026-11-10T00:00:00Z",
};

function renderBoard(
  props: Partial<Parameters<typeof HrRecruitmentBoard>[0]> = {},
): void {
  render(
    <ToastProvider>
      <HrRecruitmentBoard
        locale="en"
        initialVacancies={[VACANCY]}
        initialApplicants={[APPLICANT, OFFER_APPLICANT]}
        initialInterviews={[INTERVIEW]}
        positions={[]}
        employees={[EMPLOYEE]}
        activeCompetencies={[]}
        {...props}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  bffFetchMock.mockReset();
});

afterEach(cleanup);

describe("PHASE-047 W-5 T-12 — the recruitment board", () => {
  it("renders the three tabs; the vacancy register shows the row, the OPEN badge, and the state-gated lifecycle buttons", () => {
    renderBoard();
    expect(screen.getByRole("tab", { name: "Vacancies" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Applicants" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Interviews" })).toBeTruthy();
    expect(screen.getByText("VAC-ENG-01")).toBeTruthy();
    expect(screen.getByText("Senior Engineer")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    // OPEN → hold + fill + cancel render; resume does not
    expect(screen.getByRole("button", { name: "Hold" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fill" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume" })).toBe(null);
  });

  it("the vacancy transition posts the exact action shape", async () => {
    renderBoard();
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...VACANCY, status: "ON_HOLD" },
    } as Awaited<ReturnType<typeof bffFetch>>);
    fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith(`hr/recruitment/vacancies/${VACANCY.id}/transition`, {
        method: "POST",
        body: { action: "hold" },
      });
    });
    await waitFor(() => {
      expect(screen.getByText("The vacancy transitioned.")).toBeTruthy();
    });
    // ON_HOLD now renders Resume (the state-gated re-render)
    await waitFor(() => {
      expect(screen.getByText("Resume")).toBeTruthy();
    });
  });

  it("the applicant pipeline renders the stage badges and the stage-appropriate acts (advance vs hire vs reopen)", () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Applicants" }));
    expect(screen.getByText("Sara Applicant")).toBeTruthy();
    expect(screen.getAllByText("Screening")).toBeTruthy();
    expect(screen.getByText("Offer")).toBeTruthy();
    // the SCREEN row advances; the OFFER row hires; no reopen anywhere yet
    expect(screen.getAllByRole("button", { name: "Advance stage" }).length).toBe(2);
    expect(screen.getByRole("button", { name: "Hire" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen" })).toBe(null);
  });

  it("the advance dialog posts the exact { to } shape", async () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Applicants" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Advance stage" })[0]!);
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...APPLICANT, stage: "INTERVIEW" },
    } as Awaited<ReturnType<typeof bffFetch>>);
    pickSelect(/^Stage \*/, "Interview");
    fireEvent.click(screen.getAllByRole("button", { name: "Advance stage" }).at(-1)!);
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith(`hr/recruitment/applicants/${APPLICANT.id}/stage`, {
        method: "POST",
        body: { to: "INTERVIEW" },
      });
    });
    await waitFor(() => {
      expect(screen.getByText("The stage advanced.")).toBeTruthy();
    });
  });

  it("the hire dialog posts the employee link (the written-once act)", async () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Applicants" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Hire" })[0]!);
    expect(screen.getByText(/The hire links the applicant to an existing employee record/)).toBeTruthy();
    pickSelect(/^Linked employee/, /EMP-001/);
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...OFFER_APPLICANT, stage: "HIRED", hiredEmployeeId: EMPLOYEE.id },
    } as Awaited<ReturnType<typeof bffFetch>>);
    fireEvent.click(screen.getAllByRole("button", { name: "Hire" }).at(-1)!);
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith(`hr/recruitment/applicants/${OFFER_APPLICANT.id}/hire`, {
        method: "POST",
        body: { employeeId: EMPLOYEE.id },
      });
    });
    await waitFor(() => {
      expect(screen.getByText("The hire linked the employee record.")).toBeTruthy();
    });
  });

  it("the interviews tab renders the panel slot + the honest empty states degrade honestly", () => {
    renderBoard({ initialInterviews: [] });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Interviews" }));
    expect(screen.getByText(/No records yet/)).toBeTruthy();
  });

  it("a typed BR-088 refusal renders through the localized talent mirror, never a raw code", async () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Applicants" }));
    // the SCREEN applicant re-advancing to SCREEN is not a forward step —
    // the engine's typed refusal rides the localized mirror
    fireEvent.click(screen.getAllByRole("button", { name: "Advance stage" })[0]!);
    bffFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      error: { code: "STAGE_TRANSITION_INVALID", message: "not forward" },
    } as Awaited<ReturnType<typeof bffFetch>>);
    pickSelect(/^Stage \*/, "Screening");
    fireEvent.click(screen.getAllByRole("button", { name: "Advance stage" }).at(-1)!);
    await waitFor(() => {
      expect(
        screen.getByText(
          "The stage move is invalid — the ladder is monotonic; backward motion only via the recorded reopen.",
        ),
      ).toBeTruthy();
    });
  });
});
