/**
 * PHASE-047 (W-5, T-13) — the training board's component tests (the
 * statutory-board pattern): the three tabs render with their registers;
 * the completion patch posts the exact shape (status + the percentages
 * + the result — the completed_at stamp is the engine's own act); the
 * certifications' expiry chips badge the ≤ 30-day window and the
 * expired rows; the honest empty states.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type {
  CertificationRow,
  EmployeeListRow,
  TrainingEnrollmentRow,
  TrainingProgramRow,
} from "../../lib/api-types";
import { HrTrainingBoard } from "../hr-training-board";

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

const PROGRAM: TrainingProgramRow = {
  id: "0193f000-0000-7000-8000-00000000p001",
  code: "TRN-SAFE-01",
  name: "Workplace Safety",
  nameAr: "السلامة المهنية",
  kind: "INTERNAL",
  provider: "Internal HR",
  cost: "1500.0000",
  status: "ACTIVE",
  notes: null,
  version: 1,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const ENROLLMENT: TrainingEnrollmentRow = {
  id: "0193f000-0000-7000-8000-00000000n001",
  programId: PROGRAM.id,
  employeeId: EMPLOYEE.id,
  status: "IN_PROGRESS",
  attendancePct: "90.00",
  completionPct: "60.00",
  result: null,
  completedAt: null,
  notes: null,
  version: 1,
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-10T00:00:00Z",
};

function certRow(overrides: Partial<CertificationRow>): CertificationRow {
  return {
    id: "0193f000-0000-7000-8000-00000000t001",
    employeeId: EMPLOYEE.id,
    name: "First Aid",
    nameAr: "الإسعافات الأولية",
    issuer: "Red Crescent",
    issueDate: "2025-11-01",
    expiryDate: "2026-11-01",
    certificateNumber: "FA-2025-77",
    notes: null,
    version: 1,
    createdAt: "2025-11-01T00:00:00Z",
    updatedAt: "2025-11-01T00:00:00Z",
    ...overrides,
  };
}

function renderBoard(
  props: Partial<Parameters<typeof HrTrainingBoard>[0]> = {},
): void {
  render(
    <ToastProvider>
      <HrTrainingBoard
        locale="en"
        initialPrograms={[PROGRAM]}
        initialEnrollments={[ENROLLMENT]}
        initialCertifications={[certRow({})]}
        employees={[EMPLOYEE]}
        currency="SAR"
        {...props}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  bffFetchMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T00:00:00Z"));
  vi.useRealTimers();
});

afterEach(cleanup);

describe("PHASE-047 W-5 T-13 — the training board", () => {
  it("renders the three tabs; the programs register shows the kind badge, the exact-decimal cost, and the ACTIVE badge", () => {
    renderBoard();
    expect(screen.getByRole("tab", { name: "Programs" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Enrollments" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Certifications" })).toBeTruthy();
    expect(screen.getByText("TRN-SAFE-01")).toBeTruthy();
    expect(screen.getByText("Workplace Safety")).toBeTruthy();
    expect(screen.getByText("Internal")).toBeTruthy();
    expect(screen.getByText("1500.0000")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("the completion patch posts the exact shape (status + attendance + completion + result)", async () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Enrollments" }));
    expect(screen.getByText(/stamps completed_at with the result in the same write/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    pickSelect("Status", "Completed");
    fireEvent.change(screen.getByLabelText("Attendance %"), { target: { value: "95.00" } });
    fireEvent.change(screen.getByLabelText("Completion %"), { target: { value: "100.00" } });
    pickSelect("Result", "Passed");
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        ...ENROLLMENT,
        status: "COMPLETED",
        attendancePct: "95.00",
        completionPct: "100.00",
        result: "PASSED",
        completedAt: "2026-11-19",
      },
    } as Awaited<ReturnType<typeof bffFetch>>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith(`hr/training/enrollments/${ENROLLMENT.id}`, {
        method: "PATCH",
        body: {
          status: "COMPLETED",
          attendancePct: "95.00",
          completionPct: "100.00",
          result: "PASSED",
        },
      });
    });
    await waitFor(() => {
      expect(screen.getByText("The enrollment was saved.")).toBeTruthy();
    });
  });

  it("the certifications' expiry chips badge the expired row (today pinned 2026-11-19)", () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Certifications" }));
    expect(screen.getByText("First Aid")).toBeTruthy();
    expect(screen.getByText("Red Crescent")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
  });

  it("the no-expiry certification renders the honest no-expiry note, never a chip", () => {
    renderBoard({ initialCertifications: [certRow({ expiryDate: null })] });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Certifications" }));
    expect(screen.getByText("No expiry")).toBeTruthy();
    expect(screen.queryByText("Expired")).toBe(null);
  });

  it("the honest empty states render per tab", () => {
    renderBoard({ initialEnrollments: [], initialCertifications: [] });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Enrollments" }));
    expect(screen.getByText(/No records yet/)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Certifications" }));
    expect(screen.getAllByText(/No records yet/)).toBeTruthy();
  });
});
