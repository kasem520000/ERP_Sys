/**
 * PHASE-046 (W-5, T-11) — the EOSB board's component tests (the
 * atp-promise-point pattern: jsdom + the bffFetch mock): the two tabs
 * (the calculations register + the BR-087 reconciliation view) render
 * their rows with the kind badges, the journal tie, and the
 * aligned/standing-delta badges; the honest empty states; THE TRUE-UP
 * BUTTON'S RUNTIME GATE (hidden without payroll.runs.post — the ledger
 * act rides the ledger key, matrix §3.24) and the G-54 trigger's dialog
 * (employee + kind + date + note through the W-2 engine's own
 * endpoint).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type {
  EmployeeListRow,
  EosbCalculationRow,
  EosbReconciliationRow,
} from "../../lib/api-types";
import { EosbBoard } from "../eosb-board";

vi.mock("../../lib/client-api", () => ({
  bffFetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const bffFetchMock = vi.mocked(bffFetch);

// jsdom lacks the PointerEvent + pointer-capture APIs Radix Select needs
// to open its listbox (the standard Radix+jsdom workaround — documented
// upstream); without these the trigger's pointerDown never opens.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Object.defineProperty(Element.prototype, "hasPointerCapture", {
      value: () => false,
      writable: true,
      configurable: true,
    });
  }
  if (!Element.prototype.setPointerCapture) {
    Object.defineProperty(Element.prototype, "setPointerCapture", {
      value: () => {},
      writable: true,
      configurable: true,
    });
  }
  if (!Element.prototype.releasePointerCapture) {
    Object.defineProperty(Element.prototype, "releasePointerCapture", {
      value: () => {},
      writable: true,
      configurable: true,
    });
  }
});


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
  salaryStructureId: "0193f000-0000-7000-8000-00000000s001",
  branchId: null,
  costCenterId: null,
  projectId: null,
  bankMasked: { name: null, ibanTail: null, accountTail: null },
  eosSettledAmount: null,
  status: "ACTIVE",
  note: null,
  noteAr: null,
  createdAt: "2020-01-01T00:00:00Z",
};

const CALCULATION: EosbCalculationRow = {
  id: "0193f000-0000-7000-8000-00000000c001",
  employeeId: EMPLOYEE.id,
  kind: "OPENING",
  serviceYears: "6.8800",
  tierBreakdown: null,
  wageBaseSnapshot: null,
  entitlementAmount: "22933.3300",
  provisionBalance: "22433.3300",
  delta: "500.0000",
  journalEntryId: "0193f000-0000-7000-8000-00000000j001",
  status: "POSTED",
  runId: null,
  fiscalPeriodId: null,
  entryDate: "2026-11-17",
  note: "the opening",
  createdAt: "2026-11-17T00:00:00Z",
};

const RECONCILIATION: EosbReconciliationRow = {
  employeeId: EMPLOYEE.id,
  entitlement: "22933.3300",
  provisionBalance: "22933.3300",
  settled: null,
  alignedDelta: "0.0000",
  lastCalculation: CALCULATION,
};

function renderBoard(props: Partial<Parameters<typeof EosbBoard>[0]> = {}): void {
  render(
    <ToastProvider>
      <EosbBoard
        locale="en"
        initialCalculations={[CALCULATION]}
        initialReconciliation={[RECONCILIATION]}
        employees={[EMPLOYEE]}
        canTrueUp={false}
        {...props}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  bffFetchMock.mockReset();
});

afterEach(cleanup);

describe("PHASE-046 W-5 T-11 — the EOSB board", () => {
  it("renders the two tabs; the register shows the kind badge, the delta, the journal tie, and the POSTED status", () => {
    renderBoard();
    expect(screen.getByText("Calculations")).toBeTruthy();
    expect(screen.getByText("Reconciliation")).toBeTruthy();
    expect(screen.getByText("EMP-001 · Saudi Employee")).toBeTruthy();
    expect(screen.getByText("Opening")).toBeTruthy();
    expect(screen.getByText("22933.3300")).toBeTruthy();
    expect(screen.getByText("Posted")).toBeTruthy();
  });

  it("the reconciliation view shows the aligned badge when the delta is exactly zero", () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Reconciliation" }));
    expect(screen.getByText("Aligned")).toBeTruthy();
  });

  it("the honest empty states: no calculations / no balances to reconcile", () => {
    renderBoard({ initialCalculations: [], initialReconciliation: [] });
    expect(screen.getByText(/No EOSB calculations yet/i)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Reconciliation" }));
    expect(screen.getByText(/No provision balances to reconcile yet/i)).toBeTruthy();
  });

  it("THE TRUE-UP BUTTON'S RUNTIME GATE: hidden without payroll.runs.post; the no-permission note renders instead", () => {
    renderBoard({ canTrueUp: false });
    expect(screen.queryByRole("button", { name: "True-up" })).toBeNull();
    expect(
      screen.getByText(/it requires payroll\.runs\.post/),
    ).toBeTruthy();
  });

  it("THE G-54 TRIGGER: with the ledger key the dialog opens, posts the W-2 engine's own shape, and toasts", async () => {
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        calculation: { ...CALCULATION, id: "0193f000-0000-7000-8000-00000000c002" },
        journalEntryId: "0193f000-0000-7000-8000-00000000j002",
        delta: "500.0000",
      },
    } as Awaited<ReturnType<typeof bffFetch>>);
    renderBoard({ canTrueUp: true });

    fireEvent.click(screen.getByRole("button", { name: "True-up" }));
    expect(screen.getByText("EOSB provision true-up (G-54)")).toBeTruthy();

    // The employee select + the default kind + today's date ride the
    // engine's own endpoint verbatim.
    const employeeSelect = screen.getByRole("combobox", { name: /Employee/ });
    employeeSelect.focus();
    fireEvent.keyDown(employeeSelect, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: /EMP-001/ }));
    fireEvent.click(screen.getByRole("button", { name: "Post the true-up" }));

    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("payroll/eosb/true-up", {
        method: "POST",
        body: {
          employeeId: EMPLOYEE.id,
          kind: "PERIOD_TRUE_UP",
          onDate: expect.any(String),
        },
      });
    });
    await waitFor(() => {
      expect(screen.getByText("The true-up is posted — the delta is journaled")).toBeTruthy();
    });
  });
});
