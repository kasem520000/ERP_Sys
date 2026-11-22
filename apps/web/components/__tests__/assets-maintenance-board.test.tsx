/**
 * PHASE-049 (W-20 — T-13) — the maintenance board's component tests (the
 * statutory-board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the orders table renders the W-17 listing's own
 *   shapes VERBATIM — the machine's stamps, the orderNo, the engine's own
 *   totals; the workspace composes the three reads (order + lines + steps
 *   — the engine has no combined endpoint); the completion renders the
 *   engine's OWN INV-034 verdict (balanced/sourceTotal/glExpenseDebit/
 *   difference exactly as the completion act returned them).
 * - The lifecycle bar rides the machine's own ladder (one POST per move —
 *   the plan transition's endpoint proven).
 * - The evaluation surfaces the engine's NAMED skips (BR-097's own report
 *   rows), never a generic error.
 * - The typed refusal renders with its FULL payload.
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 * - The status filter re-fetches through the BFF with the query param.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type {
  AssetMeterRow,
  EmployeeListRow,
  FixedAssetRow,
  MaintenanceCostLineRow,
  MaintenancePlanEvaluationRow,
  MaintenancePlanRow,
  MaintenanceStepRow,
  MaintenanceWorkOrderRow,
  PartnerRow,
  WarehouseRow,
} from "../../lib/api-types";
import { AssetsMaintenanceBoard } from "../assets-maintenance-board";

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function order(overrides: Partial<MaintenanceWorkOrderRow> = {}): MaintenanceWorkOrderRow {
  return {
    id: "order-1",
    assetId: "asset-1",
    orderNo: "MO-2026-000042",
    problem: "Overheating on the line",
    problemAr: null,
    solution: null,
    solutionAr: null,
    priority: "MEDIUM",
    technicianEmployeeId: "emp-1",
    status: "REQUESTED",
    planId: null,
    plannedAt: null,
    startedAt: null,
    completedAt: null,
    laborTotal: "0",
    partsTotal: "0",
    externalTotal: "0",
    journalEntryId: null,
    note: null,
    noteAr: null,
    createdBy: null,
    createdAt: "2026-11-20T08:00:00Z",
    updatedAt: "2026-11-20T08:00:00Z",
    version: 1,
    ...overrides,
  };
}

function line(overrides: Partial<MaintenanceCostLineRow> = {}): MaintenanceCostLineRow {
  return {
    id: "line-1",
    workOrderId: "order-1",
    lineNo: 1,
    legType: "LABOR",
    employeeId: "emp-1",
    hours: "2",
    unitRate: "60",
    itemId: null,
    warehouseId: null,
    qty: null,
    partnerId: null,
    amount: "120",
    description: "Diagnosis",
    descriptionAr: null,
    issueUnitCost: null,
    issuedAt: null,
    note: null,
    noteAr: null,
    ...overrides,
  };
}

function step(overrides: Partial<MaintenanceStepRow> = {}): MaintenanceStepRow {
  return {
    id: "step-1",
    workOrderId: "order-1",
    sourceTaskId: null,
    seq: 1,
    title: "Check oil level",
    titleAr: null,
    instruction: null,
    instructionAr: null,
    result: null,
    resultNote: null,
    resultNoteAr: null,
    recordedAt: null,
    recordedBy: null,
    ...overrides,
  };
}

function plan(overrides: Partial<MaintenancePlanRow> = {}): MaintenancePlanRow {
  return {
    id: "plan-1",
    assetId: "asset-1",
    name: "Oil change every 90 days",
    nameAr: null,
    description: null,
    descriptionAr: null,
    triggerType: "CALENDAR",
    intervalDays: 90,
    nextDueDate: "2026-12-01",
    meterId: null,
    thresholdDelta: null,
    lastAnchorValue: null,
    lastGeneratedAt: null,
    isActive: true,
    note: null,
    noteAr: null,
    createdAt: "2026-11-20T08:00:00Z",
    updatedAt: "2026-11-20T08:00:00Z",
    version: 1,
    ...overrides,
  };
}

const ASSET: FixedAssetRow = {
  id: "asset-1",
  code: "A-100",
  name: "Generator",
  nameAr: "",
  categoryId: "cat-1",
  acquisitionDate: "2026-01-01",
  cost: "50000",
  salvageValue: "0",
  openingAccumulated: "0",
  usefulLifeMonths: 60,
  depreciationMethod: "STRAIGHT_LINE",
  totalEstimatedUnits: null,
  branchId: "branch-1",
  custodianUserId: null,
  status: "ACTIVE",
  sourceType: null,
  sourceId: null,
  warrantyExpiry: null,
  insuranceExpiry: null,
  licenseExpiry: null,
  inspectionExpiry: null,
  costCenterId: null,
  parentAssetId: null,
  note: null,
  noteAr: null,
  disposedAt: null,
  writtenOffAt: null,
  createdBy: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  version: 1,
};

const EMPLOYEE: EmployeeListRow = {
  id: "emp-1",
  code: "E-1",
  name: "Lina Al-Muhandisa",
  nameAr: null,
  nationalIdMasked: null,
  hireDate: "2026-01-01",
  terminationDate: null,
  terminationReason: null,
  contractType: "FULL_TIME",
  basicSalary: "0",
  salaryStructureId: null,
  branchId: null,
  costCenterId: null,
  projectId: null,
  bankMasked: { name: null, ibanTail: null, accountTail: null },
  status: "ACTIVE",
  note: null,
  noteAr: null,
  createdAt: "2026-01-01T00:00:00Z",
};

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof AssetsMaintenanceBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <AssetsMaintenanceBoard
        locale={locale}
        initialOrders={[order()]}
        ordersError={null}
        initialPlans={[plan()]}
        plansError={null}
        assets={[ASSET]}
        employees={[EMPLOYEE]}
        items={[]}
        warehouses={[] as readonly WarehouseRow[]}
        partners={[] as readonly PartnerRow[]}
        meters={[] as readonly AssetMeterRow[]}
        {...overrides}
      />
    </ToastProvider>,
  );
}

/** The workspace's three composed reads. */
function mockWorkspace(
  orderRow: MaintenanceWorkOrderRow,
  lines: readonly MaintenanceCostLineRow[] = [line()],
  steps: readonly MaintenanceStepRow[] = [step()],
) {
  bffFetchMock.mockImplementation(async (path: string) => {
    if (path === "assets/maintenance/orders/order-1") {
      return { ok: true, data: orderRow };
    }
    if (path === "assets/maintenance/orders/order-1/lines") {
      return { ok: true, data: lines };
    }
    if (path === "assets/maintenance/orders/order-1/steps") {
      return { ok: true, data: steps };
    }
    if (path.startsWith("assets/maintenance/orders")) {
      return { ok: true, data: [orderRow] };
    }
    return { ok: true, data: [] };
  });
}

describe("PHASE-049 W-20 — the maintenance board", () => {
  it("(a) the listing renders the engine's own shapes verbatim (the orderNo + the joins + the status/priority vocabulary)", () => {
    renderBoard("en");
    // The engine's own orderNo (mono, verbatim).
    expect(screen.getByText("MO-2026-000042")).toBeTruthy();
    // The presentation join (never a bare uuid) — the cell AND the asset
    // filter's own <option> both carry it (by design).
    expect(screen.getAllByText("A-100 · Generator").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Lina Al-Muhandisa")).toBeTruthy();
    // The machine's own stamp.
    expect(screen.getByText("2026-11-20T08:00:00Z")).toBeTruthy();
    // The status + the priority (scoped to the grid — the <option>s carry
    // the same vocabulary by design).
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("Requested")).toBeTruthy();
    expect(within(grid).getByText("Medium")).toBeTruthy();
  });

  it("(b) AR renders Arabic-first (the localized status + the AR labels)", () => {
    renderBoard("ar");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("مطلوب")).toBeTruthy();
    expect(within(grid).getByText("متوسطة")).toBeTruthy();
    // The pane switch + the card title both carry the pane label (by design).
    expect(screen.getAllByText("أوامر الصيانة").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("الخطط الوقائية")).toBeTruthy();
  });

  it("(c) the workspace composes the THREE reads and renders the engine's own totals verbatim", async () => {
    mockWorkspace(order({ status: "IN_PROGRESS", laborTotal: "120", partsTotal: "75.5", externalTotal: "0" }));
    renderBoard("en");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("assets/maintenance/orders/order-1");
      expect(bffFetchMock).toHaveBeenCalledWith("assets/maintenance/orders/order-1/lines");
      expect(bffFetchMock).toHaveBeenCalledWith("assets/maintenance/orders/order-1/steps");
    });
    await waitFor(() => {
      // The workspace title carries the engine's own orderNo.
      expect(screen.getByText("Work order MO-2026-000042")).toBeTruthy();
      // THE ENGINE'S OWN TOTALS — verbatim (zero client arithmetic). The
      // labor total AND the line's own amount both render the engine's
      // "120" (two surfaces, one figure).
      expect(screen.getAllByText("120.0000").length).toBe(2);
      expect(screen.getByText("75.5000")).toBeTruthy();
      // The line's own subject (the LABOR employee · hours @ rate).
      expect(screen.getByText("Lina Al-Muhandisa · 2 Hours @ 60")).toBeTruthy();
      // The checklist step with its unset result.
      expect(screen.getByText("Check oil level")).toBeTruthy();
      expect(screen.getByText("not recorded")).toBeTruthy();
    });
  });

  it("(d) the lifecycle bar rides the machine's own ladder (the plan transition's endpoint)", async () => {
    // A STATEFUL mock: the first workspace read returns REQUESTED; after
    // the plan transition the order reads back PLANNED (the machine's own
    // next state — the refresh's read).
    let planned = false;
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "assets/maintenance/orders/order-1/plan" && init?.method === "POST") {
        planned = true;
        return { ok: true, data: order({ status: "PLANNED", plannedAt: "2026-11-20T09:00:00Z" }) };
      }
      if (path === "assets/maintenance/orders/order-1") {
        return {
          ok: true,
          data: planned
            ? order({ status: "PLANNED", plannedAt: "2026-11-20T09:00:00Z" })
            : order({ status: "REQUESTED" }),
        };
      }
      if (path === "assets/maintenance/orders/order-1/lines") {
        return { ok: true, data: [] };
      }
      if (path === "assets/maintenance/orders/order-1/steps") {
        return { ok: true, data: [] };
      }
      if (path.startsWith("assets/maintenance/orders")) {
        return { ok: true, data: [order()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByText("Work order MO-2026-000042")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("assets/maintenance/orders/order-1/plan", {
        method: "POST",
        body: {},
      });
    });
    await waitFor(() => {
      // The transition toast carries the machine's own next state.
      expect(screen.getByText(/The order moved to “Planned”/)).toBeTruthy();
    });
  });

  it("(e) THE COMPLETION renders the engine's OWN INV-034 verdict (the reconciliation figures exactly as returned)", async () => {
    mockWorkspace(order({ status: "IN_PROGRESS", laborTotal: "120", partsTotal: "75.5", externalTotal: "30" }));
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "assets/maintenance/orders/order-1/complete" && init?.method === "POST") {
        return {
          ok: true,
          data: {
            order: order({ status: "COMPLETED", journalEntryId: "je-1", solution: "Replaced the belt", laborTotal: "120", partsTotal: "75.5", externalTotal: "30" }),
            journalEntryId: "je-1",
            reconciliation: {
              balanced: true,
              labor: "120",
              parts: "75.5",
              external: "30",
              sourceTotal: "225.5",
              glExpenseDebit: "225.5",
              difference: "0",
            },
            issueMoveIds: ["move-1"],
          },
        };
      }
      if (path === "assets/maintenance/orders/order-1") {
        return {
          ok: true,
          data:
            bffFetchMock.mock.calls.find((call) => call[0] === "assets/maintenance/orders/order-1/complete") !== undefined
              ? order({ status: "COMPLETED", journalEntryId: "je-1", solution: "Replaced the belt", laborTotal: "120", partsTotal: "75.5", externalTotal: "30" })
              : order({ status: "IN_PROGRESS", laborTotal: "120", partsTotal: "75.5", externalTotal: "30" }),
        };
      }
      if (path === "assets/maintenance/orders/order-1/lines") {
        return { ok: true, data: [line()] };
      }
      if (path === "assets/maintenance/orders/order-1/steps") {
        return { ok: true, data: [step({ result: "PASS", recordedAt: "2026-11-20T10:00:00Z" })] };
      }
      if (path.startsWith("assets/maintenance/orders")) {
        return { ok: true, data: [order()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByText("Work order MO-2026-000042")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    const dialog = screen.getByRole("dialog");
    // The required label renders "Solution *" (the FieldShell's own shape).
    fireEvent.change(within(dialog).getByLabelText("Solution *"), {
      target: { value: "Replaced the belt" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Complete & post" }));
    await waitFor(() => {
      // THE INV-034 CARD — the engine's own verdict figures, verbatim.
      expect(screen.getByText("INV-034 reconciliation")).toBeTruthy();
      // The source total AND the GL debit render the engine's own figure
      // (two surfaces, one number).
      expect(screen.getAllByText("225.5000").length).toBe(2);
      // The difference — the engine's own "0" rendered VERBATIM (the mono
      // cell's title carries the exact string).
      expect(screen.getByTitle("0")).toBeTruthy();
      expect(screen.getByText("true")).toBeTruthy(); // balanced
    });
  });

  it("(f) the typed refusal renders WITH ITS PAYLOAD (the orders read's refusal), never a generic error", () => {
    renderBoard("en", {
      initialOrders: null,
      ordersError: {
        code: "PLAN_WINDOW_OPEN",
        message: "an open order holds the trigger window",
        details: { planId: "plan-1", window: "2026-11-20" },
      },
    });
    const panel = screen.getByTestId("typed-refusal");
    expect(within(panel).getByText("PLAN_WINDOW_OPEN")).toBeTruthy();
    expect(within(panel).getByText(/open order holds the trigger window/)).toBeTruthy();
    expect(within(panel).getByText("planId")).toBeTruthy();
    expect(within(panel).getByText("window")).toBeTruthy();
  });

  it("(g) the status filter re-fetches through the BFF with the query param", async () => {
    bffFetchMock.mockImplementation(async () => ({ ok: true, data: [] }));
    renderBoard("en");
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "PLANNED" },
    });
    // Note: the filter selects; the refresh button applies.
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("assets/maintenance/orders?status=PLANNED");
    });
    // The listing settles to the honest empty notice.
    await waitFor(() => {
      expect(screen.getByText("No work orders yet.")).toBeTruthy();
    });
  });

  it("(h) the plans pane surfaces the engine's NAMED skips (BR-097's own report rows)", async () => {
    bffFetchMock.mockImplementation(async (path: string) => {
      if (path === "assets/plans/plan-1/tasks") {
        return { ok: true, data: [] };
      }
      if (path === "assets/plans/plan-1/evaluate") {
        return {
          ok: true,
          data: {
            planId: "plan-1",
            assetId: "asset-1",
            triggerType: "CALENDAR",
            generated: false,
            skipReason: "PLAN_NOT_DUE",
          } satisfies MaintenancePlanEvaluationRow,
        };
      }
      if (path === "assets/plans") {
        return { ok: true, data: [plan()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    // Switch to the plans pane (the data-slot switch — never Tabs).
    fireEvent.click(screen.getByRole("button", { name: "Preventive plans" }));
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("Oil change every 90 days")).toBeTruthy();
    expect(within(grid).getByText("Calendar")).toBeTruthy();
    expect(within(grid).getByText("90")).toBeTruthy();
    // Open the plan workspace and evaluate — the skip is NAMED.
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("assets/plans/plan-1/tasks");
    });
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("assets/plans/plan-1/evaluate", {
        method: "POST",
        body: {},
      });
    });
    await waitFor(() => {
      expect(screen.getByText(/skipped: plan not due yet/)).toBeTruthy();
    });
  });
});
