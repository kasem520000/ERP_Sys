/**
 * PHASE-047 (W-5, T-13 + T-14) — the org-structure board's component
 * tests (the statutory-board pattern): the tree renders the
 * materialized paths with depth indentation; the move dialog posts the
 * tri-state parent shape (null = root); the documents tab renders the
 * honest no-permission notice when the session lacks
 * hr.documents.manage (null) and the sweep config + expiry chips when
 * it holds it; the sweep save parses the thresholds and posts the
 * normalized shape; the delete act carries the confirm dialog.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type {
  EmployeeDocumentRow,
  EmployeeListRow,
  HrAlertJobRow,
  OrgUnitRow,
  PositionRow,
} from "../../lib/api-types";
import { HrOrgBoard } from "../hr-org-board";

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

const ROOT_UNIT: OrgUnitRow = {
  id: "0193f000-0000-7000-8000-00000000u001",
  code: "OPERATIONS",
  name: "Operations",
  nameAr: "العمليات",
  parentId: null,
  path: "OPERATIONS",
  active: true,
  version: 1,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const CHILD_UNIT: OrgUnitRow = {
  id: "0193f000-0000-7000-8000-00000000u002",
  code: "FACILITIES",
  name: "Facilities",
  nameAr: "المرافق",
  parentId: ROOT_UNIT.id,
  path: "OPERATIONS.FACILITIES",
  active: true,
  version: 1,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const POSITION: PositionRow = {
  id: "0193f000-0000-7000-8000-00000000s001",
  code: "POS-TECH-01",
  title: "Technician",
  titleAr: "فني",
  grade: "G5",
  orgUnitId: CHILD_UNIT.id,
  reportsTo: null,
  status: "ACTIVE",
  version: 1,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const DOCUMENT: EmployeeDocumentRow = {
  id: "0193f000-0000-7000-8000-00000000d001",
  employeeId: EMPLOYEE.id,
  kind: "IQAMA",
  number: "2411223344",
  issuedOn: "2021-11-19",
  expiresOn: "2026-11-25",
  notes: null,
  version: 1,
  createdAt: "2021-11-19T00:00:00Z",
  updatedAt: "2021-11-19T00:00:00Z",
};

const ALERT_JOB: HrAlertJobRow = {
  id: "0193f000-0000-7000-8000-00000000j001",
  jobKind: "EXPIRY_SWEEP",
  thresholds: [30, 7, 0],
  isActive: true,
  lastRunAt: "2026-11-19T01:00:00Z",
  lastFlagged: 3,
  note: null,
  version: 1,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-19T01:00:00Z",
};

function renderBoard(
  props: Partial<Parameters<typeof HrOrgBoard>[0]> = {},
): void {
  render(
    <ToastProvider>
      <HrOrgBoard
        locale="en"
        initialUnits={[ROOT_UNIT, CHILD_UNIT]}
        initialPositions={[POSITION]}
        initialDocuments={[DOCUMENT]}
        initialAlertJob={ALERT_JOB}
        employees={[EMPLOYEE]}
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

describe("PHASE-047 W-5 T-13/T-14 — the org-structure board", () => {
  it("renders the three tabs; the tree shows the ordered paths with the depth indentation", () => {
    renderBoard();
    expect(screen.getByRole("tab", { name: "Org units" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Positions" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Documents & alerts" })).toBeTruthy();
    expect(screen.getByText("Operations")).toBeTruthy();
    expect(screen.getByText("Facilities")).toBeTruthy();
    expect(screen.getByText("OPERATIONS.FACILITIES")).toBeTruthy();
    // the child's row indents one level deeper than the root's
    const childRow = screen.getByText("Facilities").closest("div[class*='rounded-md']");
    expect(childRow).toBeTruthy();
    expect((childRow as HTMLElement).style.marginInlineStart).toBe("1.25rem");
  });

  it("the move dialog posts the tri-state parent shape (root = null) and re-reads the tree", async () => {
    renderBoard();
    const moveButtons = screen.getAllByRole("button", { name: "Move unit" });
    fireEvent.click(moveButtons[1]!); // FACILITIES moves to root
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...CHILD_UNIT, parentId: null, path: "FACILITIES" },
    } as Awaited<ReturnType<typeof bffFetch>>);
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: [ROOT_UNIT, { ...CHILD_UNIT, parentId: null, path: "FACILITIES" }],
    } as Awaited<ReturnType<typeof bffFetch>>);
    // the dialog's parent select defaults to the CURRENT parent — pick Root
    pickSelect("Parent", /Root \(no parent\)/);
    fireEvent.click(screen.getAllByRole("button", { name: "Move unit" }).at(-1)!);
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith(`hr/org/units/${CHILD_UNIT.id}`, {
        method: "PATCH",
        body: { parentId: null },
      });
    });
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("hr/org/units");
    });
    await waitFor(() => {
      expect(screen.getByText("The unit moved and the subtree re-pathed.")).toBeTruthy();
    });
  });

  it("the positions register renders the grade, the org path, and the reports-to", () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Positions" }));
    expect(screen.getByText("POS-TECH-01")).toBeTruthy();
    expect(screen.getByText("Technician")).toBeTruthy();
    expect(screen.getByText("G5")).toBeTruthy();
    expect(screen.getByText("OPERATIONS.FACILITIES")).toBeTruthy();
  });

  it("the documents tab renders the honest no-permission notice when the register's key is absent (null)", () => {
    renderBoard({ initialDocuments: null, initialAlertJob: null });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Documents & alerts" }));
    expect(screen.getByText("You do not have permission to do that.")).toBeTruthy();
    // the sweep config never renders behind the missing plane
    expect(screen.queryByText("The daily expiry sweep")).toBe(null);
  });

  it("the documents plane renders the register with the expiry chip (today pinned 2026-11-19) + the sweep card", () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Documents & alerts" }));
    expect(screen.getByText("The daily expiry sweep")).toBeTruthy();
    expect(screen.getByText(/four probes: documents, certifications, probation end/)).toBeTruthy();
    expect(screen.getByText("Iqama")).toBeTruthy();
    expect(screen.getByText("2411223344")).toBeTruthy();
    expect(screen.getByText("6 days remaining")).toBeTruthy();
    expect(screen.getByText(/Last run: 2026-11-19T01:00:00Z/)).toBeTruthy();
    expect(screen.getByText(/Last flagged: 3/)).toBeTruthy();
  });

  it("the sweep save parses the thresholds and posts the normalized shape", async () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Documents & alerts" }));
    fireEvent.change(screen.getByLabelText("Thresholds (days)"), { target: { value: "14, 3, 0" } });
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...ALERT_JOB, thresholds: [14, 3, 0] },
    } as Awaited<ReturnType<typeof bffFetch>>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("hr/alerts/expiry-sweep", {
        method: "PUT",
        body: { thresholds: [14, 3, 0], isActive: true, note: null },
      });
    });
    await waitFor(() => {
      expect(screen.getByText("The sweep configuration was saved.")).toBeTruthy();
    });
  });

  it("the document delete carries the confirm dialog; Cancel leaves the row in place", () => {
    renderBoard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Documents & alerts" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getAllByText("Confirm delete?").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(bffFetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("2411223344")).toBeTruthy();
  });

  it("a typed D-09 cycle refusal renders through the localized talent mirror", async () => {
    renderBoard();
    const moveButtons = screen.getAllByRole("button", { name: "Move unit" });
    fireEvent.click(moveButtons[0]!); // OPERATIONS under FACILITIES = the cycle
    // pick the CHILD as the new parent — the pure guard refuses the move
    pickSelect("Parent", /Facilities/);
    bffFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 422,
      error: { code: "ORG_CYCLE_INVALID", message: "cycle" },
    } as Awaited<ReturnType<typeof bffFetch>>);
    fireEvent.click(screen.getAllByRole("button", { name: "Move unit" }).at(-1)!);
    await waitFor(() => {
      expect(
        screen.getByText("The requested move would create a cycle in the tree — refused before any write."),
      ).toBeTruthy();
    });
  });
});
