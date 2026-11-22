/**
 * PHASE-049 (W-21 — T-14) — the meters board's component tests (the
 * statutory-board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the meters listing renders the W-18 engine's own
 *   shapes VERBATIM — the asset join, the meter's own name/unit/lastValue
 *   snapshot, the odometer designation chip, the type vocabulary; the fleet
 *   register renders the SQL-derived day counts (the database's own
 *   arithmetic) with the sweep's 30/7/0 tone bands.
 * - THE RECORD ACT posts the exact body and renders the engine's OWN
 *   evaluation report — the NAMED skip (BR-097's vocabulary), never a
 *   generic error.
 * - THE R-10 ODOMETER DESIGNATION rides the PATCH {isOdometer} — the
 *   board opens the door, the engine decides.
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type {
  AssetMeterReadingRow,
  AssetMeterRow,
  FixedAssetRow,
  FleetLightRow,
  MaintenancePlanEvaluationRow,
  MaintenanceWorkOrderRow,
  RecordReadingResult,
} from "../../lib/api-types";
import { AssetsMetersBoard } from "../assets-meters-board";

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

function meter(overrides: Partial<AssetMeterRow> = {}): AssetMeterRow {
  return {
    id: "meter-1",
    assetId: "asset-1",
    name: "Trip meter",
    nameAr: null,
    type: "KM",
    unit: "km",
    isOdometer: true,
    lastValue: "123456",
    lastReadingAt: "2026-11-01T08:00:00Z",
    note: null,
    noteAr: null,
    createdBy: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-11-01T08:00:00Z",
    ...overrides,
  };
}

function reading(overrides: Partial<AssetMeterReadingRow> = {}): AssetMeterReadingRow {
  return {
    id: "reading-1",
    meterId: "meter-1",
    value: "123456",
    effectiveDate: "2026-11-01",
    source: "MANUAL",
    workOrderId: null,
    note: null,
    noteAr: null,
    createdBy: null,
    createdAt: "2026-11-01T08:00:00Z",
    ...overrides,
  };
}

function fleet(overrides: Partial<FleetLightRow> = {}): FleetLightRow {
  return {
    assetId: "asset-1",
    code: "A-100",
    name: "Generator",
    nameAr: "",
    status: "ACTIVE",
    categoryId: "cat-1",
    categoryCode: "GEN",
    categoryName: "Generators",
    branchCode: "RUH",
    branchName: "Riyadh",
    warrantyExpiry: "2026-11-27",
    warrantyDays: 5,
    insuranceExpiry: "2026-12-12",
    insuranceDays: 20,
    licenseExpiry: "2027-02-20",
    licenseDays: 90,
    inspectionExpiry: null,
    inspectionDays: null,
    odometerMeterId: "meter-1",
    odometerName: "Odometer",
    odometerUnit: "km",
    odometerValue: "123456",
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof AssetsMetersBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <AssetsMetersBoard
        locale={locale}
        initialMeters={[meter()]}
        metersError={null}
        initialFleet={[fleet()]}
        fleetError={null}
        assets={[ASSET]}
        {...overrides}
      />
    </ToastProvider>,
  );
}

/** The workspace's two composed reads (the readings log + the JOB pool). */
function mockMeterWorkspace(
  meterRow: AssetMeterRow,
  readings: readonly AssetMeterReadingRow[] = [reading()],
  jobOrders: readonly MaintenanceWorkOrderRow[] = [],
) {
  bffFetchMock.mockImplementation(async (path: string) => {
    if (path === "assets/meters/meter-1/readings") {
      return { ok: true, data: readings };
    }
    if (
      path ===
      "assets/maintenance/orders?assetId=asset-1&status=COMPLETED"
    ) {
      return { ok: true, data: jobOrders };
    }
    if (path === "assets/meters") {
      return { ok: true, data: [meterRow] };
    }
    return { ok: true, data: [] };
  });
}

describe("PHASE-049 W-21 — the meters board", () => {
  it("(a) the listing renders the engine's own shapes verbatim (the join + the odometer chip + the type vocabulary)", () => {
    renderBoard("en");
    // The presentation join (never a bare uuid) — the cell AND the asset
    // filter's own <option> both carry it (by design).
    expect(screen.getAllByText("A-100 · Generator").length).toBeGreaterThanOrEqual(1);
    // The meter's own fields (verbatim, mono).
    expect(screen.getByText("Trip meter")).toBeTruthy();
    expect(screen.getByText("km")).toBeTruthy();
    expect(screen.getByText("123456")).toBeTruthy();
    expect(screen.getByText("2026-11-01T08:00:00Z")).toBeTruthy();
    // The type vocabulary + the odometer designation chip (the column
    // header carries the same word by design — header + chip).
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("Kilometers")).toBeTruthy();
    expect(within(grid).getAllByText("Odometer").length).toBe(2);
  });

  it("(b) AR renders Arabic-first (the localized type + the odometer word + the pane switch)", () => {
    renderBoard("ar");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("كيلومتر")).toBeTruthy();
    // The odometer word: the column header AND the designation chip (both
    // by design).
    expect(within(grid).getAllByText("عداد المسافة").length).toBe(2);
    // The pane switch + the pane card both carry the pane label (by design).
    expect(screen.getAllByText("العدادات").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("سجل الأسطول")).toBeTruthy();
  });

  it("(c) THE RECORD ACT posts the exact body and renders the evaluation's NAMED skip", async () => {
    mockMeterWorkspace(meter({ isOdometer: false }));
    const recordResult: RecordReadingResult = {
      reading: reading({ id: "reading-2", value: "130000", effectiveDate: "2026-11-22" }),
      meter: meter({ isOdometer: false, lastValue: "130000", lastReadingAt: "2026-11-22T00:00:00Z" }),
      evaluations: [
        {
          planId: "plan-1",
          assetId: "asset-1",
          triggerType: "METER",
          generated: false,
          skipReason: "PLAN_NOT_DUE",
        } satisfies MaintenancePlanEvaluationRow,
        {
          planId: "plan-2",
          assetId: "asset-1",
          triggerType: "METER",
          generated: true,
          orderId: "order-9",
          orderNo: "MO-2026-000049",
        } satisfies MaintenancePlanEvaluationRow,
      ],
    };
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "assets/meters/meter-1/readings" && init?.method === "POST") {
        return { ok: true, data: recordResult };
      }
      if (path === "assets/meters/meter-1/readings") {
        return { ok: true, data: [reading()] };
      }
      if (path === "assets/maintenance/orders?assetId=asset-1&status=COMPLETED") {
        return { ok: true, data: [] };
      }
      if (path === "assets/meters") {
        return { ok: true, data: [meter({ isOdometer: false })] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("assets/meters/meter-1/readings");
    });
    // Open the record dialog and fill the engine's own shapes.
    fireEvent.click(screen.getByRole("button", { name: "Record reading" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Value *"), {
      target: { value: "130000" },
    });
    fireEvent.change(within(dialog).getByLabelText("Effective date *"), {
      target: { value: "2026-11-22" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record reading" }));
    // THE EXACT BODY — the engine's own contract (source MANUAL, no order).
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("assets/meters/meter-1/readings", {
        method: "POST",
        body: {
          value: "130000",
          effectiveDate: "2026-11-22",
          source: "MANUAL",
          note: null,
          noteAr: null,
        },
      });
    });
    // THE EVALUATION REPORT — the NAMED skip + the generated orderNo,
    // both the engine's own report rows.
    await waitFor(() => {
      expect(screen.getByText(/skipped: plan not due yet/)).toBeTruthy();
      expect(screen.getByText(/order MO-2026-000049 generated/)).toBeTruthy();
    });
  });

  it("(d) THE ODOMETER DESIGNATION rides the PATCH {isOdometer} (the R-10 door)", async () => {
    mockMeterWorkspace(meter({ isOdometer: false }));
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "assets/meters/meter-1" && init?.method === "PATCH") {
        return { ok: true, data: meter({ isOdometer: true }) };
      }
      if (path === "assets/meters/meter-1/readings") {
        return { ok: true, data: [reading()] };
      }
      if (path === "assets/maintenance/orders?assetId=asset-1&status=COMPLETED") {
        return { ok: true, data: [] };
      }
      if (path === "assets/meters") {
        return { ok: true, data: [meter({ isOdometer: false })] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en", { initialMeters: [meter({ isOdometer: false })] });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Designate as odometer" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Designate as odometer" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("assets/meters/meter-1", {
        method: "PATCH",
        body: { isOdometer: true },
      });
    });
    // The designation toast + the meter's own advanced snapshot.
    await waitFor(() => {
      expect(screen.getByText("Odometer designation updated.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Undesignate odometer" })).toBeTruthy();
    });
  });

  it("(e) the fleet register renders the SQL-derived days chips (the sweep's 30/7/0 tone bands)", () => {
    renderBoard("en");
    // Switch to the fleet pane (the data-slot switch — never Tabs).
    fireEvent.click(screen.getByRole("button", { name: "Fleet register" }));
    const grid = screen.getByRole("grid");
    // The engine's own dates (mono, verbatim) + the branch/category joins.
    expect(within(grid).getByText("A-100")).toBeTruthy();
    expect(within(grid).getByText("Generators")).toBeTruthy();
    expect(within(grid).getByText("Riyadh")).toBeTruthy();
    expect(within(grid).getByText("2026-11-27")).toBeTruthy();
    // THE SQL-DERIVED DAY COUNTS — the database's own arithmetic, with the
    // sweep's tone bands: 5 days (danger), 20 days (warning), 90 days
    // (neutral), and the honest dash for the missing inspection.
    expect(within(grid).getByText("5 days")).toBeTruthy();
    expect(within(grid).getByText("20 days")).toBeTruthy();
    expect(within(grid).getByText("90 days")).toBeTruthy();
    expect(within(grid).getAllByText("—").length).toBeGreaterThanOrEqual(1);
    // The odometer binding (value + unit).
    expect(within(grid).getByText("123456")).toBeTruthy();
    expect(within(grid).getByText("km")).toBeTruthy();
  });
});
